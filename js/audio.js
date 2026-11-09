/*
 * Soundscape engine.
 *
 * Each scene has 3–5 real recordings (sounds/manifest.js). We never loop a
 * file with a hard seam: we play a stretch of one recording (45–110 s, from a
 * random point), then crossfade over 8 s into another recording of the same
 * scene (or another part of the same one). That keeps it seamless and
 * non-repetitive.
 *
 * Loudness: each recording is measured once (gated RMS, cached) and given a
 * gain so all scenes sit at the same level. A soft limiter guards the end.
 *
 * Served from the local server, playback goes through Web Audio. Opened as a
 * plain file, browsers block Web Audio analysis of local files, so we fall
 * back to <audio>.volume (still crossfaded, but without loudness matching).
 */
(function () {
  "use strict";

  let XFADE = 8;                // seconds between recordings
  const SCENE_XFADE = 4;        // seconds when switching scenes
  let SEG_MIN = 45, SEG_MAX = 110;
  const TARGET_DB = -24;        // target gated RMS level
  const webAudioOK = location.protocol.startsWith("http");

  let ctx = null, master = null, limiter = null;
  let masterVolume = 0.8, sleepFactor = 1;
  const gains = (() => { try { return JSON.parse(localStorage.getItem("qp.gains") || "{}"); } catch (e) { return {}; } })();

  function manifest() { return (window.QP_SOUNDS && window.QP_SOUNDS.scenes) || {}; }
  function filesFor(sceneId) { return manifest()[sceneId] || []; }

  function ensureCtx() {
    if (!webAudioOK || ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6; limiter.knee.value = 6; limiter.ratio.value = 12;
      limiter.attack.value = 0.01; limiter.release.value = 0.3;
      master = ctx.createGain();
      master.gain.value = masterVolume;
      master.connect(limiter).connect(ctx.destination);
    } catch (e) { ctx = null; }
  }

  // ---------------------------------------------------------- loudness
  async function measure(file) {
    if (gains[file] != null) return gains[file];
    if (!ctx) return 1;
    try {
      const buf = await (await fetch(file)).arrayBuffer();
      const audio = await ctx.decodeAudioData(buf);
      const ch = audio.getChannelData(0);
      const block = Math.floor(audio.sampleRate * 0.4);
      const levels = [];
      for (let i = 0; i + block <= ch.length; i += block) {
        let sum = 0;
        for (let j = i; j < i + block; j += 4) sum += ch[j] * ch[j];
        levels.push(sum / (block / 4));
      }
      // Gate out near-silence so pauses between loon calls don't count.
      const loud = levels.filter(v => v > 1e-7).sort((a, b) => a - b);
      const keep = loud.slice(Math.floor(loud.length * 0.3));
      const ms = keep.length ? keep.reduce((a, b) => a + b, 0) / keep.length : 0;
      const db = ms > 0 ? 10 * Math.log10(ms) : TARGET_DB;
      const g = Math.min(4, Math.max(0.15, Math.pow(10, (TARGET_DB - db) / 20)));
      gains[file] = +g.toFixed(3);
      try { localStorage.setItem("qp.gains", JSON.stringify(gains)); } catch (e) { /* ignore */ }
      return g;
    } catch (e) {
      console.warn("[audio] could not measure", file, e);
      return 1;
    }
  }

  // ---------------------------------------------------------- one playing recording
  class Voice {
    constructor(item, norm) {
      this.item = item;
      this.norm = norm;
      this.level = 0;          // 0..1 fade level
      this.el = new Audio();
      this.el.preload = "auto";
      this.el.src = item.file;
      this.el.loop = true;     // safety only; we always crossfade away earlier
      if (ctx) {
        this.node = ctx.createMediaElementSource(this.el);
        this.gain = ctx.createGain();
        this.gain.gain.value = 0;
        this.node.connect(this.gain).connect(master);
      } else {
        this.el.volume = 0;
      }
    }
    async start(offset) {
      await new Promise((res) => {
        if (this.el.readyState >= 1) return res();
        this.el.addEventListener("loadedmetadata", res, { once: true });
        this.el.addEventListener("error", res, { once: true });
        setTimeout(res, 8000);
      });
      try { this.el.currentTime = offset || 0; } catch (e) { /* ignore */ }
      try { await this.el.play(); } catch (e) { console.warn("[audio] play blocked", e.message); }
    }
    fadeTo(level, secs) {
      this.level = level;
      if (ctx) {
        const g = this.gain.gain, now = ctx.currentTime;
        const to = level * this.norm;
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
        else { const v = g.value; g.cancelScheduledValues(now); g.setValueAtTime(v, now); }
        g.linearRampToValueAtTime(to, now + Math.max(0.05, secs));
      } else {
        clearInterval(this.timer);
        const start = this.el.volume, steps = Math.max(1, Math.round(secs * 20));
        let i = 0;
        this.timer = setInterval(() => {
          i++;
          const t = i / steps;
          const target = Math.min(1, level * masterVolume * sleepFactor);
          this.el.volume = Math.max(0, Math.min(1, start + (target - start) * t));
          if (i >= steps) clearInterval(this.timer);
        }, 50);
      }
    }
    refreshVolume() { if (!ctx) this.el.volume = Math.min(1, this.level * masterVolume * sleepFactor); }
    stop() {
      clearInterval(this.timer);
      try { this.el.pause(); } catch (e) { /* ignore */ }
      this.el.removeAttribute("src"); this.el.load();
      if (this.node) { try { this.node.disconnect(); this.gain.disconnect(); } catch (e) { /* ignore */ } }
    }
  }

  // ---------------------------------------------------------- scene soundscape
  class Soundscape {
    constructor(sceneId) {
      this.sceneId = sceneId;
      this.items = filesFor(sceneId);
      this.voice = null;
      this.lastIdx = -1;
      this.stopped = false;
      this.paused = false;
    }
    pick() {
      const n = this.items.length;
      let i = (Math.random() * n) | 0;
      if (n > 1 && i === this.lastIdx) i = (i + 1 + ((Math.random() * (n - 1)) | 0)) % n;
      this.lastIdx = i;
      return this.items[i];
    }
    async startVoice(fadeSecs) {
      const item = this.pick();
      const norm = await measure(item.file);
      if (this.stopped) return;
      const v = new Voice(item, norm);
      const dur = item.duration || 60;
      const seg = Math.min(SEG_MIN + Math.random() * (SEG_MAX - SEG_MIN), Math.max(10, dur - XFADE - 1));
      const latestStart = Math.max(0, dur - seg - XFADE - 1);
      const offset = Math.random() * latestStart;
      await v.start(offset);
      if (this.stopped) { v.stop(); return; }
      const old = this.voice;
      this.voice = v;
      v.fadeTo(1, fadeSecs);
      if (old) { old.fadeTo(0, fadeSecs); setTimeout(() => old.stop(), fadeSecs * 1000 + 300); }
      this.current = item;
      if (Soundscape.onChange) Soundscape.onChange(item);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.advance(), seg * 1000);
    }
    advance() {
      if (this.stopped) return;
      if (this.paused) { this.timer = setTimeout(() => this.advance(), 2000); return; }
      this.startVoice(XFADE);
    }
    begin(fadeSecs) { if (this.items.length) return this.startVoice(fadeSecs); return Promise.resolve(); }
    fadeOutAndStop(secs) {
      this.stopped = true;
      clearTimeout(this.timer);
      const v = this.voice;
      if (v) { v.fadeTo(0, secs); setTimeout(() => v.stop(), secs * 1000 + 300); }
    }
    pause() { this.paused = true; if (this.voice) this.voice.el.pause(); }
    resume() { this.paused = false; if (this.voice) this.voice.el.play().catch(() => {}); }
    refreshVolume() { if (this.voice) this.voice.refreshVolume(); }
  }

  let current = null;

  const API = {
    hasSounds(sceneId) { return filesFor(sceneId).length > 0; },
    unlock() {
      ensureCtx();
      if (ctx && ctx.state === "suspended") ctx.resume();
    },
    async play(sceneId) {
      ensureCtx();
      if (current && current.sceneId === sceneId && !current.stopped) return;
      const old = current;
      current = new Soundscape(sceneId);
      // Measure the new scene's files in the background (first time only).
      filesFor(sceneId).forEach(f => measure(f.file));
      if (old) old.fadeOutAndStop(SCENE_XFADE);
      await current.begin(old ? SCENE_XFADE : 3);
    },
    pause() { if (current) current.pause(); if (ctx) ctx.suspend(); },
    resume() { if (ctx) ctx.resume(); if (current) current.resume(); },
    setVolume(v) {
      masterVolume = v;
      if (master) master.gain.setTargetAtTime(v * sleepFactor, ctx.currentTime, 0.1);
      if (current) current.refreshVolume();
    },
    // Sleep fade: factor 1 -> 0 over secs.
    sleepFade(secs) {
      return new Promise(resolve => {
        const steps = Math.max(1, secs * 10);
        let i = 0;
        clearInterval(API._sleepTimer);
        API._sleepTimer = setInterval(() => {
          i++;
          sleepFactor = Math.max(0, 1 - i / steps);
          API.setVolume(masterVolume);
          if (i >= steps) { clearInterval(API._sleepTimer); resolve(); }
        }, 100);
      });
    },
    resetSleep() { clearInterval(API._sleepTimer); sleepFactor = 1; API.setVolume(masterVolume); },
    nowPlaying() { return current && current.current; },
    usingWebAudio() { return !!ctx; },
    // for automated tests
    _debug() {
      const v = current && current.voice;
      return v && { scene: current.sceneId, file: v.item.file, time: v.el.currentTime, paused: v.el.paused,
        gain: v.gain ? v.gain.gain.value : v.el.volume, norm: v.norm, ctx: ctx && ctx.state, master: master ? master.gain.value : null };
    },
    _tune(o) { if (o.segMin) SEG_MIN = o.segMin; if (o.segMax) SEG_MAX = o.segMax; if (o.xfade) XFADE = o.xfade; }
  };
  Soundscape.onChange = null;
  API.onChange = fn => { Soundscape.onChange = fn; };
  window.QP_AUDIO = API;
})();
