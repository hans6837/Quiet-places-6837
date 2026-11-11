/*
 * Quiet Places — app controller: scenes, video rotation, controls, timers.
 */
(function () {
  "use strict";

  const $ = s => document.querySelector(s);
  const SCENES = window.QP_SCENES;
  const VIDEOS = window.QP_VIDEOS;
  const AUDIO = window.QP_AUDIO;
  const CFG = window.QUIET_PLACES_CONFIG || null;

  function load(k, d) { try { const v = localStorage.getItem("qp.set." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem("qp.set." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  const state = {
    category: load("category", "all"),
    sceneId: load("scene", null),
    photoInterval: load("photoInterval", 60),
    autoScene: load("autoScene", 0),
    volume: load("volume", 80),
    playing: false,
    token: 0,
    shownClip: null,
    photoTimer: null,
    autoTimer: null,
    sleepEnd: 0,
    sleeping: false
  };

  const sceneById = id => SCENES.find(s => s.id === id);
  const inCategory = (s, cat) => cat === "all" || s.category === cat;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const link = (href, text) => href ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text);

  // ------------------------------------------------------------ stage / photos
  const layers = Array.from(document.querySelectorAll(".layer"));
  let front = 0;
  const paintedCache = {};

  function painted(sceneId) {
    if (!paintedCache[sceneId]) {
      const w = Math.min(2400, Math.round(window.innerWidth * Math.min(2, devicePixelRatio || 1)));
      const h = Math.round(w * window.innerHeight / window.innerWidth);
      paintedCache[sceneId] = window.QP_PAINT(sceneId, w, h);
    }
    return paintedCache[sceneId];
  }

  function kenBurns(img, secs) {
    if (img._anim) img._anim.cancel();
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const r = (a, b) => a + Math.random() * (b - a);
    const zoomIn = Math.random() < 0.6;
    const s0 = zoomIn ? 1.0 : r(1.1, 1.16), s1 = zoomIn ? r(1.1, 1.16) : 1.0;
    const x0 = r(-2.5, 2.5), y0 = r(-1.5, 1.5), x1 = r(-2.5, 2.5), y1 = r(-1.5, 1.5);
    img._anim = img.animate([
      { transform: `scale(${s0}) translate(${x0}%, ${y0}%)` },
      { transform: `scale(${s1}) translate(${x1}%, ${y1}%)` }
    ], { duration: secs * 1000, easing: "ease-in-out", fill: "forwards" });
    if (!state.playing) img._anim.pause();
  }

  // Each layer holds either a playing video clip or the painted fallback image.
  function clearLayer(layer) {
    const v = layer.querySelector("video");
    if (v) { v._showing = false; try { v.pause(); } catch (e) {} v.removeAttribute("src"); v.load(); v.remove(); }
  }
  function display(clip, scene) {
    const back = 1 - front;
    const layer = layers[back], img = layer.querySelector("img");
    const oldLayer = layers[front];
    const oldClip = state.shownClip;
    clearLayer(layer);
    if (clip) {
      const el = clip.el;
      el.className = "clip"; el._showing = true;
      img.style.display = "none";
      layer.appendChild(el);
      try { el.currentTime = 0; } catch (e) { /* ignore */ }
      if (state.playing) { const p = el.play(); if (p && p.catch) p.catch(() => {}); }
    } else {
      img.style.display = "";
      img.src = painted(scene.id);
      kenBurns(img, state.photoInterval + 6);
    }
    layer.classList.add("visible");
    oldLayer.classList.remove("visible");
    front = back;
    state.shownClip = clip;
    if (clip) VIDEOS.shown(clip);
    setTimeout(() => {                      // after the 3 s crossfade: free the old clip
      if (layers[front] !== oldLayer) clearLayer(oldLayer);
      if (oldClip && oldClip.objectUrl) URL.revokeObjectURL(oldClip.objectUrl);
    }, 3500);
    renderCredit(clip, scene);
  }

  function renderCredit(clip, scene) {
    let html;
    if (!clip) html = `Painted scene · ${esc(scene.name)}`;
    else if (clip.source === "pixabay")
      html = `Video by ${link(clip.authorUrl, clip.author)} on ${link(clip.pageUrl, "Pixabay")}`;
    else
      html = `Video: ${link(clip.pageUrl, clip.author)} · ${link(clip.licenseUrl, clip.license)} · ${link(clip.pageUrl, "Wikimedia Commons")}`;
    if (clip && clip.fromCache) html += ` <span title="Played from the offline copy">· saved</span>`;
    $("#photo-credit").innerHTML = html;
    $("#credits-photo").innerHTML = html;
    if (!clip) setStatus(VIDEO_HELP());
    else setStatus(clip.fromCache ? "Offline or rate-limited — playing saved videos" : "");
  }

  function VIDEO_HELP() {
    if (navigator.onLine === false) return "Offline — showing the painted scene";
    return "No video available right now — showing the painted scene";
  }

  function setStatus(t) { $("#status").textContent = t || ""; }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise(res => setTimeout(() => res(undefined), ms))]);
  }

  async function goScene(id) {
    const scene = sceneById(id);
    const my = ++state.token;
    state.sceneId = id; save("scene", id);
    clearTimeout(state.photoTimer);
    if (state.prepared) { const old = state.prepared; state.prepared = null; old.then(release); }
    renderSceneLabels();
    setStatus("Finding a video…");

    const firstPhoto = VIDEOS.next(scene, null);
    const quick = await withTimeout(firstPhoto, 9000);
    if (my !== state.token) return;
    if (quick === undefined) {
      // Still loading: show the painted scene now, swap in the video when ready.
      display(null, scene);
      startSceneAudio(scene);
      firstPhoto.then(p => {
        if (my !== state.token) return;
        if (p) display(p, scene);
        schedulePhotos(my, scene);
      });
    } else {
      display(quick, scene);
      startSceneAudio(scene);
      schedulePhotos(my, scene);
    }
    resetAutoScene();
  }

  function startSceneAudio(scene) {
    if (!AUDIO.hasSounds(scene.id)) { $("#sound-credit").textContent = "No recordings downloaded for this scene yet"; }
    AUDIO.play(scene.id).catch(e => console.warn(e));
    if (!state.playing) AUDIO.pause();
  }

  // Stop a preloaded clip that will not be shown (frees memory and data).
  function release(clip) {
    if (!clip || clip === state.shownClip || !clip.el) return;
    clip.el._showing = false; clip.el.removeAttribute("src"); clip.el.load();
    if (clip.objectUrl) URL.revokeObjectURL(clip.objectUrl);
  }

  function schedulePhotos(my, scene) {
    clearTimeout(state.photoTimer);
    const currentKey = state.shownClip && state.shownClip.key;
    const prepared = VIDEOS.next(scene, currentKey); // preload while the current one plays
    state.prepared = prepared;
    const startedAt = Date.now();
    const wait = () => {
      if (my !== state.token) return;
      if (!state.playing) { state.photoTimer = setTimeout(wait, 1000); return; }
      prepared.then(p => {
        if (my !== state.token) { release(p); return; }
        // If nothing new could be loaded, keep the current clip (or painted scene).
        if (p && (!state.shownClip || p.key !== state.shownClip.key)) display(p, scene);
        else release(p);
        schedulePhotos(my, scene);
      });
    };
    state.photoTimer = setTimeout(wait, Math.max(5000, state.photoInterval * 1000 - (Date.now() - startedAt)));
  }

  // ------------------------------------------------------------ scenes / categories
  function renderCats() {
    $("#cats").innerHTML = window.QP_CATEGORIES.map(c =>
      `<button role="tab" data-cat="${c.id}" aria-selected="${c.id === state.category}">${c.name}</button>`).join("");
  }
  function renderSceneSelect() {
    $("#scene-select").innerHTML = SCENES.filter(s => inCategory(s, state.category))
      .map(s => `<option value="${s.id}" ${s.id === state.sceneId ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  }
  function renderSceneLabels() {
    const s = sceneById(state.sceneId);
    $("#scene-name").textContent = s.name;
    $("#scene-hear").textContent = s.hear;
    document.title = `${s.name} · Quiet Places`;
    renderSceneSelect();
  }
  function randomScene(excludeId) {
    const opts = SCENES.filter(s => inCategory(s, state.category) && s.id !== excludeId);
    return opts[(Math.random() * opts.length) | 0] || SCENES[0];
  }
  function setCategory(cat) {
    state.category = cat; save("category", cat);
    renderCats();
    const cur = sceneById(state.sceneId);
    if (!cur || !inCategory(cur, cat)) goScene(randomScene().id);
    else renderSceneSelect();
  }

  function resetAutoScene() {
    clearTimeout(state.autoTimer);
    if (state.autoScene > 0) state.autoTimer = setTimeout(() => { if (state.playing) goScene(randomScene(state.sceneId).id); else resetAutoScene(); }, state.autoScene * 60000);
  }

  // ------------------------------------------------------------ play / pause
  function setPlaying(on) {
    state.playing = on;
    $("#btn-play").textContent = on ? "❚❚" : "▶";
    layers.forEach(l => {
      const a = l.querySelector("img")._anim; if (a) on ? a.play() : a.pause();
      const v = l.querySelector("video");
      if (v && l.classList.contains("visible")) { if (on) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause(); }
    });
    if (on) AUDIO.resume(); else AUDIO.pause();
    poke();
  }

  // ------------------------------------------------------------ sleep timer
  let sleepTick = null, sleepFading = false;
  function setSleep(min) {
    clearInterval(sleepTick);
    AUDIO.resetSleep(); sleepFading = false; $("#dim").style.opacity = 0;
    state.sleepEnd = min > 0 ? Date.now() + min * 60000 : 0;
    $("#sleep-left").textContent = "";
    if (!state.sleepEnd) return;
    sleepTick = setInterval(() => {
      const left = state.sleepEnd - Date.now();
      const m = Math.max(0, Math.ceil(left / 60000));
      $("#sleep-left").textContent = left > 0 ? `${m} min left` : "";
      if (left <= 120000 && !sleepFading) {
        sleepFading = true;                       // gentle 2-minute fade-out
        AUDIO.sleepFade(Math.max(5, left / 1000));
        $("#dim").style.transition = `opacity ${Math.max(5, left / 1000)}s linear`;
        $("#dim").style.opacity = 0.85;
      }
      if (left <= 0) { clearInterval(sleepTick); fallAsleep(); }
    }, 1000);
  }
  function fallAsleep() {
    state.sleeping = true;
    setPlaying(false);
    $("#sleep-screen").hidden = false;
    $("#sleep").value = "0"; state.sleepEnd = 0;
  }
  function wake() {
    state.sleeping = false;
    $("#sleep-screen").hidden = true;
    $("#dim").style.transition = "opacity 2s"; $("#dim").style.opacity = 0;
    AUDIO.resetSleep(); sleepFading = false;
    setPlaying(true);
  }

  // ------------------------------------------------------------ hide controls while playing
  let idleTimer = null;
  function poke() {
    document.body.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const panelOpen = !$("#settings").hidden || !$("#credits").hidden;
      const hovering = document.querySelector(".controls:hover");
      if (state.playing && !panelOpen && !hovering && !document.body.classList.contains("not-started")) document.body.classList.add("idle");
      else poke();
    }, 4000);
  }

  // ------------------------------------------------------------ panels
  function openPanel(id) {
    ["#settings", "#credits"].forEach(p => { $(p).hidden = p !== id; });
    if (id === "#settings") renderSettings();
    if (id === "#credits") renderCredits();
    poke();
  }
  function closePanels() { $("#settings").hidden = true; $("#credits").hidden = true; poke(); }

  async function renderSettings() {
    const choices = [30, 60, 120, 300];
    const nearest = choices.reduce((a, b) => Math.abs(b - state.photoInterval) < Math.abs(a - state.photoInterval) ? b : a);
    $("#photo-interval").value = String(nearest);
    const k = window.QP_KEYS.get();
    $("#key-pixabay").value = k.pixabayKey;
    $("#auto-scene").value = String(state.autoScene);
    const st = VIDEOS.status();
    $("#source-status").innerHTML = Object.values(st).map(s => {
      let txt;
      if (!s.enabled) txt = `<span class="warn">no key yet</span>`;
      else if (s.pausedUntil) txt = `<span class="warn">paused until ${new Date(s.pausedUntil).toLocaleTimeString()}</span>`;
      else if (s.failures >= 4) txt = `<span class="bad">not responding</span>`;
      else txt = `<span class="ok">on</span>`;
      return `<tr><td>${esc(s.name)}</td><td>${txt}</td><td class="hint">${s.used}/${s.limit} requests this ${s.per}</td></tr>`;
    }).join("");
    const cached = await VIDEOS.cacheAll();
    $("#cache-count").textContent = `${cached.length} video${cached.length === 1 ? "" : "s"} saved for offline use.`;
    const man = window.QP_SOUNDS;
    if (!man) {
      $("#sound-status").innerHTML = `<p class="warn">No recordings downloaded yet. See the README: “Download the sounds”.</p>`;
    } else {
      const counts = SCENES.map(s => `${esc(s.name)}: ${(man.scenes[s.id] || []).length}`).join(" · ");
      $("#sound-status").innerHTML = `<p class="hint">${counts}</p><p class="hint">Downloaded ${esc((man.generated || "").slice(0, 10))}. ${AUDIO.usingWebAudio() ? "Volumes are matched between scenes." : "Opened as a file: start with the start script to match volumes between scenes."}</p>`;
    }
  }

  function renderCredits() {
    const man = window.QP_SOUNDS;
    if (!man) { $("#credits-sounds").innerHTML = `<p class="warn">No recordings downloaded yet.</p>`; return; }
    $("#credits-sounds").innerHTML = SCENES.map(s => {
      const items = man.scenes[s.id] || [];
      return `<div class="credit-scene"><h4>${esc(s.name)} <span class="hint">— ${esc(s.hear)}</span></h4><ul>` +
        (items.length ? items.map(it =>
          `<li>“${link(it.url, it.name)}” by ${link(`https://freesound.org/people/${encodeURIComponent(it.author)}/`, it.author)} — ${link(it.licenseUrl, it.license)}</li>`).join("")
          : `<li class="hint">none downloaded</li>`) + `</ul></div>`;
    }).join("");
  }

  // ------------------------------------------------------------ start screen notes
  function startNotes() {
    const notes = [];
    if (window.QP_KEYS.fromLink()) {
      notes.push('<span id="link-key-msg">Key saved on this iPad — checking it with Pixabay…</span>');
      window.QP_KEYS.testPixabay().then(r => {
        const el = document.getElementById("link-key-msg");
        if (el) el.innerHTML = r === "ok" ? "✅ Pixabay key saved on this iPad and working."
          : r === "rejected" ? "❌ Pixabay did not accept this key. Copy it again and use Settings → Video key."
          : "Key saved on this iPad (could not check it right now).";
      });
    }
    if (!CFG.pixabayKey && !window.QP_KEYS.fromLink()) notes.push("No Pixabay key yet — add it under <b>Settings → Video key</b> for many more videos. Until then, videos come from Wikimedia Commons only.");
    if (!window.QP_SOUNDS) notes.push("No recordings downloaded yet — scenes will be silent. See the README: “Download the sounds”.");
    if (location.protocol === "file:") notes.push("Opened as a file. It works, but for matched volumes use the start script.");
    $("#start-notes").innerHTML = notes.map(n => `<li>${n}</li>`).join("");
  }

  // ------------------------------------------------------------ wire up
  function init() {
    if (!sceneById(state.sceneId)) state.sceneId = randomScene().id;
    renderCats(); renderSceneLabels(); startNotes();
    // Painted preview behind the start screen
    layers[0].querySelector("img").src = painted(state.sceneId);
    layers[0].classList.add("visible");
    $("#volume").value = state.volume;

    $("#begin").addEventListener("click", () => {
      AUDIO.unlock();
      AUDIO.setVolume(state.volume / 100);
      document.body.classList.remove("not-started");
      state.playing = true;
      setPlaying(true);
      goScene(state.sceneId);
    });
    $("#cats").addEventListener("click", e => { const b = e.target.closest("button"); if (b) setCategory(b.dataset.cat); });
    $("#btn-new").addEventListener("click", () => goScene(randomScene(state.sceneId).id));
    $("#scene-select").addEventListener("change", e => goScene(e.target.value));
    $("#btn-play").addEventListener("click", () => setPlaying(!state.playing));
    $("#volume").addEventListener("input", e => { state.volume = +e.target.value; save("volume", state.volume); AUDIO.setVolume(state.volume / 100); });
    $("#sleep").addEventListener("change", e => setSleep(+e.target.value));
    $("#btn-settings").addEventListener("click", () => openPanel("#settings"));
    $("#btn-credits").addEventListener("click", () => openPanel("#credits"));
    document.querySelectorAll(".panel .close").forEach(b => b.addEventListener("click", closePanels));
    $("#photo-interval").addEventListener("change", e => {
      state.photoInterval = +e.target.value; save("photoInterval", state.photoInterval);
      if (!document.body.classList.contains("not-started")) schedulePhotos(state.token, sceneById(state.sceneId));
    });
    $("#auto-scene").addEventListener("change", e => { state.autoScene = +e.target.value; save("autoScene", state.autoScene); resetAutoScene(); });
    $("#save-keys").addEventListener("click", () => {
      const ok = window.QP_KEYS.save({ pixabayKey: $("#key-pixabay").value });
      $("#keys-msg").textContent = ok ? "Saved — restarting…" : "Could not save (private browsing?)";
      if (ok) setTimeout(() => location.reload(), 700);
    });
    $("#test-keys").addEventListener("click", async () => {
      if ($("#key-pixabay").value.replace(/\s+/g, "") !== (window.QP_KEYS.get().pixabayKey || "")) {
        $("#keys-msg").textContent = "Tap “Save key” first."; return;
      }
      $("#keys-msg").textContent = "Checking…";
      const r = await window.QP_KEYS.testPixabay();
      $("#keys-msg").textContent = r === "ok" ? "✅ Pixabay key works" : r === "rejected" ? "❌ Pixabay rejected this key" : r === "none" ? "No Pixabay key saved yet" : "Could not check right now";
    });
    $("#clear-cache").addEventListener("click", async () => { await VIDEOS.clearCache(); renderSettings(); });
    $("#btn-full").addEventListener("click", toggleFull);
    $("#sleep-screen").addEventListener("click", wake);
    AUDIO.onChange(item => {
      $("#sound-credit").innerHTML = `Sound: ${link(item.url, item.name)} by ${esc(item.author)} · ${link(item.licenseUrl, item.license)} · Freesound`;
    });

    ["mousemove", "mousedown", "touchstart", "keydown", "wheel"].forEach(ev => document.addEventListener(ev, poke, { passive: true }));
    document.addEventListener("keydown", e => {
      if (e.target.matches("input, select")) return;
      if (document.body.classList.contains("not-started")) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#begin").click(); } return; }
      if (e.key === " ") { e.preventDefault(); if (state.sleeping) wake(); else setPlaying(!state.playing); }
      else if (e.key === "n" || e.key === "N") goScene(randomScene(state.sceneId).id);
      else if (e.key === "f" || e.key === "F") toggleFull();
      else if (e.key === "Escape") closePanels();
    });
    window.addEventListener("online", () => setStatus(""));
  }

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {});
  }

  init();
  window.QP_APP = { state, goScene, setCategory }; // handy for testing
})();
