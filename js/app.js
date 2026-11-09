/*
 * Quiet Places — app controller: scenes, photo rotation, controls, timers.
 */
(function () {
  "use strict";

  const $ = s => document.querySelector(s);
  const SCENES = window.QP_SCENES;
  const PHOTOS = window.QP_PHOTOS;
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
    shownPhoto: null,
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

  function display(photo, scene) {
    const back = 1 - front;
    const layer = layers[back], img = layer.querySelector("img");
    const old = layers[front].querySelector("img");
    const oldPhoto = state.shownPhoto;
    img.src = photo ? photo.objectUrl : painted(scene.id);
    kenBurns(img, state.photoInterval + 6);
    layer.classList.add("visible");
    layers[front].classList.remove("visible");
    front = back;
    state.shownPhoto = photo;
    if (photo) PHOTOS.shown(photo);
    setTimeout(() => {
      if (oldPhoto && oldPhoto.isBlob && old.src === oldPhoto.objectUrl) { URL.revokeObjectURL(oldPhoto.objectUrl); }
    }, 4000);
    renderPhotoCredit(photo, scene);
  }

  function renderPhotoCredit(photo, scene) {
    let html;
    if (!photo) html = `Painted scene · ${esc(scene.name)}`;
    else if (photo.source === "unsplash")
      html = `Photo by ${link(photo.authorUrl, photo.author)} on ${link("https://unsplash.com/?utm_source=quiet_places&utm_medium=referral", "Unsplash")}`;
    else if (photo.source === "pexels")
      html = `Photo by ${link(photo.authorUrl, photo.author)} on ${link(photo.pageUrl, "Pexels")}`;
    else
      html = `${link(photo.pageUrl, photo.author)} · ${link(photo.licenseUrl, photo.license)} · ${link(photo.pageUrl, "Wikimedia Commons")}`;
    if (photo && photo.fromCache) html += ` <span title="Shown from the offline cache">· saved</span>`;
    $("#photo-credit").innerHTML = html;
    $("#credits-photo").innerHTML = html;
    if (!photo) setStatus(PHOTO_HELP());
    else setStatus(photo.fromCache ? "Offline or rate-limited — showing saved photos" : "");
  }

  function PHOTO_HELP() {
    const st = PHOTOS.status();
    const any = Object.values(st).some(s => s.enabled);
    if (!any) return "No photo sources set up — showing the painted scene";
    if (navigator.onLine === false) return "Offline — showing the painted scene";
    return "No photo available right now — showing the painted scene";
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
    renderSceneLabels();
    setStatus("Finding a photo…");

    const firstPhoto = PHOTOS.next(scene, null);
    const quick = await withTimeout(firstPhoto, 9000);
    if (my !== state.token) return;
    if (quick === undefined) {
      // Still loading: show the painted scene now, swap in the photo when ready.
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

  function schedulePhotos(my, scene) {
    clearTimeout(state.photoTimer);
    const currentKey = state.shownPhoto && state.shownPhoto.key;
    const prepared = PHOTOS.next(scene, currentKey); // preload while the current one shows
    const startedAt = Date.now();
    const wait = () => {
      if (my !== state.token) return;
      if (!state.playing) { state.photoTimer = setTimeout(wait, 1000); return; }
      prepared.then(p => {
        if (my !== state.token) return;
        // If nothing new could be loaded, keep the current photo (or painted scene).
        if (p && (!state.shownPhoto || p.key !== state.shownPhoto.key)) display(p, scene);
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
    layers.forEach(l => { const a = l.querySelector("img")._anim; if (a) on ? a.play() : a.pause(); });
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
    $("#key-pexels").value = k.pexelsKey; $("#key-unsplash").value = k.unsplashAccessKey;
    $("#auto-scene").value = String(state.autoScene);
    const st = PHOTOS.status();
    $("#source-status").innerHTML = Object.values(st).map(s => {
      let txt;
      if (!s.enabled) txt = `<span class="warn">no key in config.js</span>`;
      else if (s.pausedUntil) txt = `<span class="warn">paused until ${new Date(s.pausedUntil).toLocaleTimeString()}</span>`;
      else if (s.failures >= 4) txt = `<span class="bad">not responding</span>`;
      else txt = `<span class="ok">on</span>`;
      return `<tr><td>${esc(s.name)}</td><td>${txt}</td><td class="hint">${s.used}/${s.limit} requests this hour</td></tr>`;
    }).join("");
    const cached = await PHOTOS.cacheAll();
    $("#cache-count").textContent = `${cached.length} photo${cached.length === 1 ? "" : "s"} saved for offline use.`;
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
    if (!CFG.pexelsKey && !CFG.unsplashAccessKey) notes.push("No Pexels or Unsplash key yet — add them under <b>Settings → Photo keys</b>. Until then, photos come from Wikimedia Commons only.");
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
      const ok = window.QP_KEYS.save({ pexelsKey: $("#key-pexels").value, unsplashAccessKey: $("#key-unsplash").value });
      $("#keys-msg").textContent = ok ? "Saved — restarting…" : "Could not save (private browsing?)";
      if (ok) setTimeout(() => location.reload(), 700);
    });
    $("#clear-cache").addEventListener("click", async () => { await PHOTOS.clearCache(); renderSettings(); });
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
