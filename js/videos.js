/*
 * Live video supply: real nature video clips from Pixabay and Wikimedia Commons.
 *
 *  - Rotates randomly between search terms, sources and result pages.
 *  - Keeps a per-scene pool of candidates, so one search feeds many clips.
 *  - Remembers recently shown clip IDs and skips them.
 *  - Landscape clips only; skips anything whose title/tags mention people,
 *    buildings, text, drawings… Animal scenes must name the animal.
 *  - The next clip is loaded into the hidden (back) player before it is shown.
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
    "interview", "lecture", "presentation", "documentary", "fire", "fires", "burn", "burning", "prescribed",
    "wildfire", "smoke", "logging", "loggers?", "trucks?", "tractors?", "machines?", "machinery", "construction", "vlog",
    "report", "training", "utv", "atv", "tram", "trains?", "railway", "typhoon", "hurricane", "flood", "flooding",
    "tsunami", "protest", "chip", "quantum", "sonification", "horses?", "cattle", "cows?", "sheep", "farm", "ranch",
    "barrier", "dam", "camera trap", "trail ?cam", "webcam", "screen recording", "slideshow", "slide show",
    "photo", "photos", "photograph", "still image", "time series", "trailers?", "movies?", "episode", "tv",
    "television", "songs?-\\d+", "full tune", "music video", "lyrics", "karaoke", "sound of", "audio", "podcast", "spectrogram"
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
    // Wikimedia asks every client to identify itself (browsers: Api-User-Agent).
    const headers = src === "wikimedia" && !useProxy ? { "Api-User-Agent": "QuietPlaces/1.0 (https://github.com/hans6837/Quiet-places-6837)" } : {};
    try { res = await fetch(url, { signal: to.signal, headers }); } finally { to.done(); }
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

  // Choose a version no bigger than full HD: 4K files (often 50-100 MB)
  // stall on Wi-Fi and are no sharper on an iPad.
  function pickRendition(v) {
    const list = ["large", "medium", "small", "tiny"].map(k => v[k]).filter(r => r && r.url && r.width);
    const fits = list.filter(r => r.width <= 1920);
    const best = fits.sort((a, b) => b.width - a.width)[0] || list.sort((a, b) => a.width - b.width)[0];
    return best || null;
  }
  function mapPixabay(data) {
    return (data.hits || []).map(h => {
      const v = h.videos || {};
      const pick = pickRendition(v);
      const small = v.small && v.small.url ? v.small : (v.tiny && v.tiny.url ? v.tiny : null);
      if (!pick) return null;
      return {
        key: "pixabay:" + h.id, source: "pixabay", sourceName: "Pixabay",
        url: pick.url, cacheUrl: small && small.url, width: pick.width, height: pick.height, duration: h.duration,
        text: [h.tags, (h.pageURL || "").split("/videos/")[1] || ""].join(" ").replace(/[-/,]/g, " "),
        topic: [h.tags, ((h.pageURL || "").split("/videos/")[1] || "").replace(/-\d+\/?$/, "")].join(" ").replace(/[-/,]/g, " "),
        title: h.tags || "",
        author: h.user, authorUrl: h.user && h.user_id ? `https://pixabay.com/users/${encodeURIComponent(h.user)}-${h.user_id}/` : h.pageURL,
        pageUrl: h.pageURL, license: "Pixabay Content License", licenseUrl: "https://pixabay.com/service/license-summary/"
      };
    }).filter(Boolean);
  }
  function mapWikimedia(data) {
    const out = [];
    for (const pg of Object.values((data.query && data.query.pages) || {})) {
      const vi = pg.videoinfo && pg.videoinfo[0];
      if (!vi) continue;
      const md = vi.extmetadata || {};
      const lic = stripHtml(md.LicenseShortName && md.LicenseShortName.value);
      if (!/^(cc0|cc[- ]?zero|public domain|pd\b|cc[- ]by(-sa)?\b)/i.test(lic) || /\b(nc|nd)\b/i.test(lic)) continue;
      // Skip "videos" that are really a still picture with sound: they are
      // tiny for their length (real footage needs far more data per second).
      if (vi.size && vi.duration && vi.size / vi.duration < 60000) continue;
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
        topic: [title, stripHtml(md.ObjectName && md.ObjectName.value)].join(" "),
        title,
        author: stripHtml(md.Artist && md.Artist.value).slice(0, 80) || "Unknown author", authorUrl: vi.descriptionurl,
        pageUrl: vi.descriptionurl, license: lic, licenseUrl: md.LicenseUrl && md.LicenseUrl.value
      });
    }
    return out;
  }

  const SOURCES = {
    pixabay: {
      name: "Pixabay",
      enabled: () => !!CFG.pixabayKey,
      async search(scene, term) {
        const page = pickPage("pixabay", term, 5);
        const q = new URLSearchParams({ key: CFG.pixabayKey, q: term, video_type: "film", safesearch: "true",
          per_page: "40", page: String(page), order: Math.random() < 0.7 ? "popular" : "latest" });
        if (scene.pixabayCategory) q.set("category", scene.pixabayCategory);
        const ck = "pixabay|" + (scene.pixabayCategory || "") + "|" + term + "|" + page + "|" + q.get("order");
        let data = cachedResponse(ck);
        if (!data) { data = await api("pixabay", "/api/videos/?" + q); storeResponse(ck, data); }
        if (data.totalHits != null) setPages("pixabay", term, Math.ceil(Math.min(data.totalHits, 200) / 40));
        return mapPixabay(data);
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
        return mapWikimedia(data);
      }
    }
  };

  function acceptable(scene, v) {
    if (!v.url || !v.width || !v.height) return false;
    if (v.width < v.height * 1.3) return false;                 // landscape only
    if (v.height < 360) return false;                           // sharp enough
    if (v.duration != null && v.duration < 6) return false;     // not a blink
    const text = v.text || "", topic = v.topic || text;
    if (BAD.test(text)) return false;
    // The scene's own rules. What the clip is ABOUT (Pixabay tags, Wikimedia
    // title) must contain every "need" pattern; nothing anywhere in its
    // description may match "none" — long descriptions only ever exclude.
    if ((scene.need || []).some(re => !re.test(topic))) return false;
    if (scene.none && scene.none.test(text)) return false;
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
      const meta = Object.assign({}, clip); delete meta.el; delete meta.objectUrl; delete meta.fromCache;
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
  // Load a clip into one of the app's two (already unlocked) video players
  // and wait until it can play. A newer load into the same player wins.
  function loadInto(el, src) {
    return new Promise((resolve, reject) => {
      const token = (el._token || 0) + 1; el._token = token;
      el._showing = false;
      let settled = false;
      const finish = (ok, why) => {
        if (settled) return; settled = true; clearTimeout(t);
        el.removeEventListener("loadeddata", onOk); el.removeEventListener("canplay", onOk); el.removeEventListener("error", onErr);
        if (el._token !== token) return reject(new Error("superseded"));
        ok ? resolve(el) : reject(new Error(why));
      };
      const onOk = () => finish(true);
      const onErr = () => finish(false, "video failed");
      const t = setTimeout(() => finish(false, "video timeout"), 30000);
      el.addEventListener("loadeddata", onOk); el.addEventListener("canplay", onOk); el.addEventListener("error", onErr);
      el.muted = true; el.loop = true;
      el.src = src;
      el.load();
      // iPads only buffer when asked to play; muted inline play is allowed.
      const p = el.play();
      if (p && p.then) p.then(() => { if (!el._showing && el._token === token) el.pause(); }).catch(() => {});
    });
  }

  async function load(clip, el) {
    await loadInto(el, clip.url);
    if (el.videoWidth && el.videoWidth < el.videoHeight * 1.2) throw new Error("not landscape");
    return Object.assign({}, clip, { el });
  }

  async function fromCache(scene, excludeKey, el) {
    const all = (await cacheAll()).filter(r => r.sceneId === scene.id && r.key !== excludeKey);
    if (!all.length) return null;
    all.sort((a, b) => a.ts - b.ts);
    const r = all[0];
    tx("readwrite", s => { r.ts = Date.now(); s.put(r); });
    const objectUrl = URL.createObjectURL(r.blob);
    try {
      await loadInto(el, objectUrl);
      return Object.assign({}, r.meta, { el, objectUrl, fromCache: true });
    } catch (e) { URL.revokeObjectURL(objectUrl); return null; }
  }

  /** Next clip for a scene, loaded into the given player; null if none.
   *  isCurrent(): false once the app no longer wants this clip (scene changed),
   *  so an old search never takes the player away from a newer one. */
  async function next(scene, currentKey, el, isCurrent) {
    const live = () => !isCurrent || isCurrent();
    for (let attempt = 0; attempt < 6; attempt++) {
      if (!live()) return null;
      const pool = pools[scene.id] || (pools[scene.id] = []);
      if (pool.length < 2 && navigator.onLine !== false) {
        const ok = await refill(scene);
        if (!ok && !pool.length) break;
      }
      const cand = pool.shift();
      if (!cand) break;
      if (!live()) { pool.unshift(cand); return null; }
      if (recentSet.has(cand.key)) continue;
      try { return await load(cand, el); }
      catch (e) {
        if (e.message === "superseded") return null;     // another load took this player
        console.warn("[videos] skip", cand.key, e.message);
      }
    }
    if (!live()) return null;
    return fromCache(scene, currentKey, el);
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

  window.QP_VIDEOS = { next, shown, status, clearCache, cacheAll, _acceptable: acceptable, _BAD: BAD,
    _map: { pixabay: mapPixabay, wikimedia: mapWikimedia } };   // for tests
})();
