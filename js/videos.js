/*
 * Live video supply: real nature video clips from Pixabay and Wikimedia Commons.
 *
 *  - Rotates randomly between search terms, sources and result pages.
 *  - Keeps a per-scene pool of candidates, so one search feeds many clips.
 *  - Remembers recently shown clip IDs and skips them.
 *  - Landscape clips only; skips anything whose title/tags mention people,
 *    buildings, text, drawings… Animal scenes must name the animal.
 *  - The next clip is loaded in a hidden <video> before it is shown.
 *  - Saves recent clips (IndexedDB) so the app keeps working offline.
 *
 * Licences: Pixabay Content License (free, no attribution required, but we
 * credit anyway as their API asks); Wikimedia Commons: CC0, public domain,
 * CC BY, CC BY-SA only.
 *
 * Rate limits: Pixabay 100 requests/minute and asks that search results be
 * cached for 24 hours (we do); Wikimedia asks for polite use (we cap at 120/h).
 */
(function () {
  "use strict";

  const CFG = window.QUIET_PLACES_CONFIG || {};
  const CACHE_MAX = 12;               // clips saved for offline use
  const CACHE_MAX_BYTES = 25e6;       // don't save huge files
  const RECENT_MAX = 400;
  const HOUR = 3600 * 1000, DAY = 24 * HOUR;
  const LIMITS = { pixabay: 90 /* per minute */, wikimedia: 120 /* per hour */ };
  const WINDOWS = { pixabay: 60 * 1000, wikimedia: HOUR };

  const BAD = new RegExp("\\b(" + [
    "person", "persons", "people", "man", "men", "woman", "women", "girl", "girls", "boy", "boys", "child",
    "children", "kid", "kids", "baby", "couple", "family", "tourists?", "surfers?", "surfing", "swimmers?",
    "swimming pool", "hikers?", "walkers?", "walking", "crowd", "portrait", "selfie", "hands?", "feet", "foot",
    "legs?", "silhouettes?", "lady", "guy", "model", "fisherman", "fishing", "diver?s? suit", "snorkel\\w*", "scuba",
    "kayak\\w*", "canoe\\w*", "boats?", "ships?", "yacht", "sail\\w*", "buildings?", "house", "houses", "hotel",
    "resort", "cabin", "city", "town", "village", "skyline", "street", "road", "car", "cars", "traffic", "bridge",
    "pier", "jetty", "dock", "harbou?r", "lighthouse", "church", "tower", "castle", "ruins?", "fence", "bench",
    "umbrella", "parasol", "chair", "tent", "text", "sign", "signs", "logo", "quote", "words?", "letters?",
    "typography", "map", "diagram", "chart", "graph", "illustration", "drawing", "painting", "animation",
    "animated", "cartoon", "render", "rendering", "3d", "cgi", "vector", "motion graphics?", "intro", "title",
    "countdown", "green ?screen", "chroma", "overlay", "particles?", "abstract", "loop background", "museum",
    "zoo", "aquarium", "captive", "dead", "carcass", "stranded", "wedding", "yoga", "drone shot of city",
    "screenshot", "collage", "timelapse city", "food", "dish", "pet", "dog", "cat", "aerial city", "news",
    "interview", "lecture", "presentation", "documentary"
  ].join("|") + ")\\b", "i");

  // ------------------------------------------------------------ storage
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  let recent = lsGet("qp.vrecent", []);
  const recentSet = new Set(recent);
  function markShown(key) {
    if (recentSet.has(key)) recent = recent.filter(k => k !== key);
    recent.push(key); recentSet.add(key);
    while (recent.length > RECENT_MAX) recentSet.delete(recent.shift());
    lsSet("qp.vrecent", recent);
  }

  // ------------------------------------------------------------ rate limiting
  const rate = lsGet("qp.vrate", {});
  function rateState(src) {
    const now = Date.now();
    const s = rate[src] || (rate[src] = { start: now, count: 0, blockedUntil: 0 });
    if (now - s.start > WINDOWS[src]) { s.start = now; s.count = 0; }
    return s;
  }
  function canCall(src) { const s = rateState(src); return Date.now() >= s.blockedUntil && s.count < LIMITS[src]; }
  function noteCall(src) { rateState(src).count++; lsSet("qp.vrate", rate); }
  function block(src, untilMs, why) {
    rateState(src).blockedUntil = untilMs; lsSet("qp.vrate", rate);
    console.warn(`[videos] ${src} paused until ${new Date(untilMs).toLocaleTimeString()} (${why})`);
  }

  // ------------------------------------------------------------ API access
  const HOSTS = { pixabay: "https://pixabay.com", wikimedia: "https://commons.wikimedia.org" };
  let useProxy = false;
  const proxyReady = (location.protocol.startsWith("http") && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)
    ? fetch("/proxy/health", { cache: "no-store" }).then(r => { useProxy = r.ok; }).catch(() => {})
    : Promise.resolve());

  function timeout(ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return { signal: ac.signal, done: () => clearTimeout(t) };
  }

  // Pixabay asks apps to cache search results for 24 hours.
  const respCache = lsGet("qp.vresp", {});
  function cachedResponse(k) { const r = respCache[k]; return r && Date.now() - r.t < DAY ? r.d : null; }
  function storeResponse(k, d) {
    respCache[k] = { t: Date.now(), d };
    const keys = Object.keys(respCache);
    if (keys.length > 60) keys.sort((a, b) => respCache[a].t - respCache[b].t).slice(0, keys.length - 60).forEach(x => delete respCache[x]);
    lsSet("qp.vresp", respCache);
  }

  async function api(src, path) {
    await proxyReady;
    if (!canCall(src)) throw new Error(`${src}: local rate budget used up`);
    const url = (useProxy ? `/proxy/${src}` : HOSTS[src]) + path;
    const to = timeout(15000);
    noteCall(src);
    let res;
    try { res = await fetch(url, { signal: to.signal }); } finally { to.done(); }
    if (res.status === 429) { block(src, Date.now() + HOUR, "HTTP 429 Too Many Requests"); throw new Error(`${src}: rate limited`); }
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      if (src === "pixabay") { block(src, Date.now() + 6 * HOUR, `HTTP ${res.status} – check the Pixabay key`); throw new Error("pixabay: key rejected"); }
    }
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return res.json();
  }

  const stripHtml = s => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const bigScreen = () => Math.max(screen.width, screen.height) * Math.min(2, window.devicePixelRatio || 1) > 2200;

  const pages = lsGet("qp.vpages", {});
  function pickPage(src, term, cap) {
    const known = pages[src + "|" + term];
    const max = Math.max(1, Math.min(cap, known || 2));
    return 1 + Math.floor(Math.random() * max);
  }
  function setPages(src, term, n) { pages[src + "|" + term] = Math.max(1, n); lsSet("qp.vpages", pages); }

  // Which video formats can this browser play?
  const probe = document.createElement("video");
  const canPlay = type => !!(type && probe.canPlayType(type).replace(/no/, ""));

  const SOURCES = {
    pixabay: {
      name: "Pixabay",
      enabled: () => !!CFG.pixabayKey,
      async search(scene, term) {
        const page = pickPage("pixabay", term, 5);
        const q = new URLSearchParams({ key: CFG.pixabayKey, q: term, video_type: "film", safesearch: "true",
          per_page: "40", page: String(page), order: Math.random() < 0.5 ? "popular" : "latest" });
        const ck = "pixabay|" + term + "|" + page + "|" + q.get("order");
        let data = cachedResponse(ck);
        if (!data) { data = await api("pixabay", "/api/videos/?" + q); storeResponse(ck, data); }
        if (data.totalHits != null) setPages("pixabay", term, Math.ceil(Math.min(data.totalHits, 200) / 40));
        return (data.hits || []).map(h => {
          const v = h.videos || {};
          const pick = (bigScreen() && v.large && v.large.url) ? v.large : (v.medium && v.medium.url ? v.medium : (v.large && v.large.url ? v.large : v.small));
          const small = v.small && v.small.url ? v.small : (v.tiny && v.tiny.url ? v.tiny : null);
          if (!pick || !pick.url) return null;
          return {
            key: "pixabay:" + h.id, source: "pixabay", sourceName: "Pixabay",
            url: pick.url, cacheUrl: small && small.url, width: pick.width, height: pick.height, duration: h.duration,
            text: [h.tags, (h.pageURL || "").split("/videos/")[1] || ""].join(" ").replace(/[-/,]/g, " "),
            title: h.tags || "",
            author: h.user, authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : h.pageURL,
            pageUrl: h.pageURL, license: "Pixabay Content License", licenseUrl: "https://pixabay.com/service/license-summary/"
          };
        }).filter(Boolean);
      }
    },
    wikimedia: {
      name: "Wikimedia Commons",
      enabled: () => CFG.useWikimedia !== false,
      async search(scene, term) {
        const page = pickPage("wikimedia", term, 4);
        const q = new URLSearchParams({
          action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6",
          gsrsearch: term + " filetype:video", gsrlimit: "40", gsroffset: String((page - 1) * 40),
          prop: "videoinfo", viprop: "url|size|mime|extmetadata|derivatives",
          viextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ImageDescription|Categories|ObjectName"
        });
        const data = await api("wikimedia", "/w/api.php?" + q);
        setPages("wikimedia", term, data.continue ? page + 1 : page);
        const out = [];
        for (const pg of Object.values((data.query && data.query.pages) || {})) {
          const vi = pg.videoinfo && pg.videoinfo[0];
          if (!vi) continue;
          const md = vi.extmetadata || {};
          const lic = stripHtml(md.LicenseShortName && md.LicenseShortName.value);
          if (!/^(cc0|cc[- ]?zero|public domain|pd\b|cc[- ]by(-sa)?\b)/i.test(lic) || /\b(nc|nd)\b/i.test(lic)) continue;
          // Choose a playable version around 720p (derivatives are Commons' transcodes).
          const options = (vi.derivatives || []).filter(d => d.src && d.width && canPlay(d.type))
            .sort((a, b) => Math.abs(a.height - 720) - Math.abs(b.height - 720));
          let chosen = options[0];
          if (!chosen && canPlay(vi.mime)) chosen = { src: vi.url, width: vi.width, height: vi.height };
          if (!chosen) continue;
          const smallest = options.slice().sort((a, b) => a.height - b.height).find(d => d.height >= 360);
          const title = pg.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " ");
          out.push({
            key: "wikimedia:" + pg.pageid, source: "wikimedia", sourceName: "Wikimedia Commons",
            url: chosen.src, cacheUrl: smallest && smallest.src, width: chosen.width || vi.width, height: chosen.height || vi.height,
            duration: vi.duration,
            text: [title, stripHtml(md.ObjectName && md.ObjectName.value), stripHtml(md.ImageDescription && md.ImageDescription.value).slice(0, 400),
              stripHtml(md.Categories && md.Categories.value).replace(/\|/g, " ")].join(" "),
            title,
            author: stripHtml(md.Artist && md.Artist.value).slice(0, 80) || "Unknown author", authorUrl: vi.descriptionurl,
            pageUrl: vi.descriptionurl, license: lic, licenseUrl: md.LicenseUrl && md.LicenseUrl.value
          });
        }
        return out;
      }
    }
  };

  function acceptable(scene, v) {
    if (!v.url || !v.width || !v.height) return false;
    if (v.width < v.height * 1.3) return false;                 // landscape only
    if (v.height < 360) return false;                           // sharp enough
    if (v.duration != null && v.duration < 6) return false;     // not a blink
    if (BAD.test(v.text || "")) return false;
    if (scene.mustMatch && !scene.mustMatch.test(v.text || "")) return false;
    return true;
  }

  // ------------------------------------------------------------ pools
  const pools = {}, seenInPool = {}, failures = {};
  function availableSources() {
    return Object.keys(SOURCES).filter(s => SOURCES[s].enabled() && canCall(s) && (failures[s] || 0) < 4);
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function refill(scene) {
    // Prefer Pixabay (much bigger nature-video library) when it has a key.
    let srcs = shuffle(availableSources());
    if (srcs.includes("pixabay") && Math.random() < 0.75) srcs = ["pixabay"].concat(srcs.filter(s => s !== "pixabay"));
    for (const src of srcs) {
      const terms = (scene.videoTerms || scene.terms).concat(src === "wikimedia" ? scene.wikiTerms || [] : []);
      const term = terms[(Math.random() * terms.length) | 0];
      try {
        const found = await SOURCES[src].search(scene, term);
        failures[src] = 0;
        const seen = seenInPool[scene.id] || (seenInPool[scene.id] = new Set());
        const fresh = found.filter(v => !recentSet.has(v.key) && !seen.has(v.key) && acceptable(scene, v));
        fresh.forEach(v => { seen.add(v.key); v.sceneId = scene.id; });
        if (!found.length) setPages(src, term, 1);
        if (fresh.length) {
          const pool = pools[scene.id] || (pools[scene.id] = []);
          pool.push(...shuffle(fresh).slice(0, 8));
          shuffle(pool);
          return true;
        }
      } catch (e) {
        failures[src] = (failures[src] || 0) + 1;
        console.warn("[videos]", e.message || e);
      }
    }
    return false;
  }

  // ------------------------------------------------------------ offline cache (IndexedDB)
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open("quiet-places", 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (d.objectStoreNames.contains("photos")) d.deleteObjectStore("photos");   // photos are gone
          if (!d.objectStoreNames.contains("videos")) d.createObjectStore("videos", { keyPath: "key" });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(d => d && new Promise((resolve) => {
      try {
        const t = d.transaction("videos", mode);
        const r = fn(t.objectStore("videos"));
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = t.onabort = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }
  async function cacheAll() { return (await tx("readonly", s => s.getAll())) || []; }
  async function cachePut(clip) {
    const src = clip.cacheUrl || clip.url;
    try {
      const to = timeout(60000);
      const r = await fetch(src, { mode: "cors", signal: to.signal }).finally(to.done);
      if (!r.ok) return;
      const len = +r.headers.get("content-length");
      if (len && len > CACHE_MAX_BYTES) return;
      const blob = await r.blob();
      if (!blob.type.startsWith("video/") || blob.size > CACHE_MAX_BYTES) return;
      const meta = Object.assign({}, clip); delete meta.el; delete meta.objectUrl;
      await tx("readwrite", s => s.put({ key: clip.key, sceneId: clip.sceneId, meta, blob, ts: Date.now() }));
      const all = await cacheAll();
      const drop = [];
      while (all.length - drop.length > CACHE_MAX) {           // keep every scene represented
        const left = all.filter(r => !drop.includes(r.key));
        const per = {};
        left.forEach(r => { per[r.sceneId] = (per[r.sceneId] || 0) + 1; });
        const busiest = Object.keys(per).sort((a, b) => per[b] - per[a])[0];
        drop.push(left.filter(r => r.sceneId === busiest).sort((a, b) => a.ts - b.ts)[0].key);
      }
      if (drop.length) await tx("readwrite", s => { drop.forEach(k => s.delete(k)); });
    } catch (e) { /* offline copy is optional */ }
  }

  // ------------------------------------------------------------ loading
  // Load a clip in a hidden, muted <video> and wait until it can play.
  function prepareElement(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement("video");
      el.muted = true; el.defaultMuted = true; el.playsInline = true;
      el.setAttribute("muted", ""); el.setAttribute("playsinline", ""); el.setAttribute("webkit-playsinline", "");
      el.loop = true; el.preload = "auto";   // no crossOrigin: plain playback needs no CORS
      let settled = false;
      const done = (ok, why) => {
        if (settled) return; settled = true; clearTimeout(t);
        el.oncanplay = el.onloadeddata = el.onerror = null;
        if (ok) resolve(el); else { el.removeAttribute("src"); el.load(); reject(new Error(why)); }
      };
      const t = setTimeout(() => done(false, "video timeout"), 30000);
      el.onloadeddata = el.oncanplay = () => done(true);
      el.onerror = () => done(false, "video failed");
      el.src = src;
      el.load();
      // iPads only buffer when asked to play; muted inline play is allowed.
      const p = el.play(); if (p && p.then) p.then(() => { if (!el._showing) el.pause(); }).catch(() => {});
    });
  }

  async function load(clip) {
    const el = await prepareElement(clip.url);
    if (el.videoWidth && el.videoWidth < el.videoHeight * 1.2) { el.removeAttribute("src"); el.load(); throw new Error("not landscape"); }
    return Object.assign({}, clip, { el });
  }

  async function fromCache(scene, excludeKey) {
    const all = (await cacheAll()).filter(r => r.sceneId === scene.id && r.key !== excludeKey);
    if (!all.length) return null;
    all.sort((a, b) => a.ts - b.ts);
    const r = all[0];
    tx("readwrite", s => { r.ts = Date.now(); s.put(r); });
    const objectUrl = URL.createObjectURL(r.blob);
    try {
      const el = await prepareElement(objectUrl);
      return Object.assign({}, r.meta, { el, objectUrl, fromCache: true });
    } catch (e) { URL.revokeObjectURL(objectUrl); return null; }
  }

  /** Next clip for a scene, loaded and ready to play; null -> painted scene. */
  async function next(scene, currentKey) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const pool = pools[scene.id] || (pools[scene.id] = []);
      if (pool.length < 2 && navigator.onLine !== false) {
        const ok = await refill(scene);
        if (!ok && !pool.length) break;
      }
      const cand = pool.shift();
      if (!cand) break;
      if (recentSet.has(cand.key)) continue;
      try { return await load(cand); }
      catch (e) { console.warn("[videos] skip", cand.key, e.message); }
    }
    return fromCache(scene, currentKey);
  }

  function shown(clip) {
    if (clip.fromCache) return;
    markShown(clip.key);
    // Save a small copy for offline use, after it has started (low priority).
    setTimeout(() => cachePut(clip), 15000);
  }

  function status() {
    const out = {};
    for (const s of Object.keys(SOURCES)) {
      const st = rateState(s);
      out[s] = {
        name: SOURCES[s].name, enabled: SOURCES[s].enabled(), used: st.count, limit: LIMITS[s],
        per: s === "pixabay" ? "minute" : "hour",
        pausedUntil: st.blockedUntil > Date.now() ? st.blockedUntil : 0, failures: failures[s] || 0
      };
    }
    return out;
  }

  async function clearCache() {
    await tx("readwrite", s => s.clear());
    recent = []; recentSet.clear(); lsSet("qp.vrecent", recent);
  }

  window.QP_VIDEOS = { next, shown, status, clearCache, cacheAll, _acceptable: acceptable, _BAD: BAD };
})();
