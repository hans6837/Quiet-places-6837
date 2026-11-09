/*
 * Live photo supply: Pexels, Unsplash and Wikimedia Commons.
 *
 *  - Rotates randomly between search terms, sources and result pages.
 *  - Keeps a per-scene pool of candidates, so one search request feeds many
 *    photos (keeps us far below every rate limit).
 *  - Remembers recently shown photo IDs and skips them.
 *  - Filters out portrait images and anything whose title/description
 *    mentions people, buildings, text, drawings…
 *  - Caches the last 30 shown photos (IndexedDB) for offline / rate-limit use.
 *
 * Rate limits (checked Nov 2026, see README):
 *   Pexels    200 requests/hour, 20,000/month  -> we cap ourselves at 150/h
 *   Unsplash  50 requests/hour in "Demo" mode   -> we cap at 40/h
 *             (5,000/h once the app is approved for production)
 *   Wikimedia no fixed limit for reads, asks for polite use -> we cap at 120/h
 */
(function () {
  "use strict";

  const CFG = window.QUIET_PLACES_CONFIG || {};
  const UTM = "utm_source=quiet_places&utm_medium=referral";
  const CACHE_MAX = 30;
  const RECENT_MAX = 500;
  const HOUR = 3600 * 1000;

  const LIMITS = { pexels: 150, unsplash: 40, wikimedia: 120 };

  // Things we don't want to see in a calm nature photo.
  const BAD = new RegExp("\\b(" + [
    "person", "persons", "people", "man", "men", "woman", "women", "girl", "girls", "boy", "boys", "child",
    "children", "kid", "kids", "baby", "couple", "family", "tourists?", "surfers?", "swimmers?", "swimming pool",
    "hikers?", "walkers?", "crowd", "portrait", "selfie", "hands?", "feet", "foot", "legs?", "silhouettes?",
    "lady", "guy", "model", "fisherman", "diver?s? suit", "snorkel\\w*", "scuba", "kayak\\w*", "canoe\\w*", "boats?",
    "ships?", "yacht", "sail\\w*", "buildings?", "house", "houses", "hotel", "resort", "cabin", "city", "town",
    "village", "skyline", "street", "road", "car", "cars", "bridge", "pier", "jetty", "dock", "lighthouse",
    "church", "tower", "castle", "ruins?", "fence", "bench", "umbrella", "parasol", "chair", "tent", "text",
    "sign", "signs", "logo", "quote", "words?", "letters?", "typography", "map", "diagram", "chart", "graph",
    "illustration", "drawing", "painting", "paintings", "engraving", "lithograph", "watercolou?r", "art",
    "artwork", "render", "rendering", "3d", "cgi", "cartoon", "vector", "clipart", "stamp", "coin", "poster",
    "book", "plate", "museum", "specimen", "skeleton", "taxiderm\\w*", "stuffed", "zoo", "aquarium", "captive",
    "dead", "carcass", "stranded", "wedding", "yoga", "drone", "aerial view of city", "screenshot", "collage",
    "infographic", "food", "dish", "pet", "dog", "cat"
  ].join("|") + ")\\b", "i");

  // ------------------------------------------------------------ storage
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  let recent = lsGet("qp.recent", []);
  const recentSet = new Set(recent);
  function markShown(key) {
    if (recentSet.has(key)) recent = recent.filter(k => k !== key);
    recent.push(key); recentSet.add(key);
    while (recent.length > RECENT_MAX) recentSet.delete(recent.shift());
    lsSet("qp.recent", recent);
  }

  // ------------------------------------------------------------ rate limiting
  const rate = lsGet("qp.rate", {});
  function rateState(src) {
    const now = Date.now();
    const s = rate[src] || (rate[src] = { start: now, count: 0, blockedUntil: 0 });
    if (now - s.start > HOUR) { s.start = now; s.count = 0; }
    return s;
  }
  function canCall(src, reserve) {
    const s = rateState(src);
    return Date.now() >= s.blockedUntil && s.count < LIMITS[src] - (reserve || 0);
  }
  function noteCall(src) { rateState(src).count++; lsSet("qp.rate", rate); }
  function block(src, untilMs, why) {
    rateState(src).blockedUntil = untilMs;
    lsSet("qp.rate", rate);
    console.warn(`[photos] ${src} paused until ${new Date(untilMs).toLocaleTimeString()} (${why})`);
  }
  function readRateHeaders(src, res) {
    const rem = parseInt(res.headers.get("x-ratelimit-remaining"), 10);
    if (!isNaN(rem) && rem <= 2) {
      const reset = parseInt(res.headers.get("x-ratelimit-reset"), 10); // Pexels: unix seconds
      const until = !isNaN(reset) && reset > 1e9 ? reset * 1000 : Date.now() + HOUR;
      block(src, until, `only ${rem} requests left`);
    }
  }

  // ------------------------------------------------------------ API access
  // When the app runs from its own little server (recommended), API calls go
  // through /proxy/... so Wikimedia gets a proper User-Agent and we can read
  // the rate-limit headers. Opened as a plain file, it calls the APIs directly.
  const HOSTS = { pexels: "https://api.pexels.com", unsplash: "https://api.unsplash.com", wikimedia: "https://commons.wikimedia.org" };
  let useProxy = false;
  const proxyReady = (location.protocol.startsWith("http")
    ? fetch("/proxy/health", { cache: "no-store" }).then(r => { useProxy = r.ok; }).catch(() => {})
    : Promise.resolve());

  function timeout(ms) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return { signal: ac.signal, done: () => clearTimeout(t) };
  }

  async function api(src, path, headers) {
    await proxyReady;
    if (!canCall(src)) throw new Error(`${src}: local rate budget used up`);
    const url = (useProxy ? `/proxy/${src}` : HOSTS[src]) + path;
    const to = timeout(15000);
    noteCall(src);
    let res;
    try { res = await fetch(url, { headers, signal: to.signal }); } finally { to.done(); }
    readRateHeaders(src, res);
    if (res.status === 429) { block(src, Date.now() + HOUR, "HTTP 429 Too Many Requests"); throw new Error(`${src}: rate limited`); }
    if (res.status === 401 || res.status === 403) { block(src, Date.now() + 6 * HOUR, `HTTP ${res.status} – check the API key`); throw new Error(`${src}: key rejected`); }
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return res.json();
  }

  const stripHtml = s => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const screenW = () => Math.min(2560, Math.round(Math.max(screen.width, screen.height) * Math.min(2, window.devicePixelRatio || 1)));

  // Page bookkeeping: how many result pages each (source, term) has.
  const pages = lsGet("qp.pages", {});
  function pickPage(src, term, cap) {
    const known = pages[src + "|" + term];
    const max = Math.max(1, Math.min(cap, known || 3));
    return 1 + Math.floor(Math.random() * max);
  }
  function setPages(src, term, n) { pages[src + "|" + term] = Math.max(1, n); lsSet("qp.pages", pages); }

  const SOURCES = {
    pexels: {
      name: "Pexels",
      enabled: () => !!CFG.pexelsKey,
      async search(scene, term) {
        const page = pickPage("pexels", term, 15);
        const q = new URLSearchParams({ query: term, orientation: "landscape", size: "large", per_page: "40", page: String(page) });
        const data = await api("pexels", "/v1/search?" + q, { Authorization: CFG.pexelsKey });
        if (data.total_results != null) setPages("pexels", term, Math.ceil(data.total_results / 40));
        const w = screenW();
        return (data.photos || []).map(p => ({
          key: "pexels:" + p.id, source: "pexels", sourceName: "Pexels",
          url: `${p.src.original}?auto=compress&cs=tinysrgb&w=${w}`,
          width: p.width, height: p.height,
          text: [p.alt, (p.url || "").split("/photo/")[1] || ""].join(" ").replace(/[-/]/g, " "),
          title: p.alt || "",
          author: p.photographer, authorUrl: p.photographer_url,
          pageUrl: p.url, license: "Pexels License", licenseUrl: "https://www.pexels.com/license/"
        }));
      }
    },
    unsplash: {
      name: "Unsplash",
      enabled: () => !!CFG.unsplashAccessKey,
      async search(scene, term) {
        const page = pickPage("unsplash", term, 10);
        const q = new URLSearchParams({ query: term, orientation: "landscape", per_page: "30", page: String(page), content_filter: "high" });
        const data = await api("unsplash", "/search/photos?" + q, { Authorization: "Client-ID " + CFG.unsplashAccessKey, "Accept-Version": "v1" });
        if (data.total_pages != null) setPages("unsplash", term, data.total_pages);
        const w = screenW();
        return (data.results || []).map(p => ({
          key: "unsplash:" + p.id, source: "unsplash", sourceName: "Unsplash",
          url: `${p.urls.raw}&w=${w}&q=80&fm=jpg&fit=max`,
          width: p.width, height: p.height,
          text: [p.alt_description, p.description, p.slug, (p.tags || []).map(t => t.title).join(" ")].join(" ").replace(/-/g, " "),
          title: p.alt_description || p.description || "",
          author: p.user && p.user.name, authorUrl: p.user && `${p.user.links.html}?${UTM}`,
          pageUrl: `${p.links.html}?${UTM}`, license: "Unsplash License", licenseUrl: "https://unsplash.com/license",
          downloadLocation: p.links.download_location
        }));
      }
    },
    wikimedia: {
      name: "Wikimedia Commons",
      enabled: () => CFG.useWikimedia !== false,
      async search(scene, term) {
        const page = pickPage("wikimedia", term, 8);
        const q = new URLSearchParams({
          action: "query", format: "json", origin: "*", generator: "search", gsrnamespace: "6",
          gsrsearch: term + " filetype:bitmap", gsrlimit: "40", gsroffset: String((page - 1) * 40),
          prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(screenW()),
          iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ImageDescription|Categories|ObjectName"
        });
        const data = await api("wikimedia", "/w/api.php?" + q, {});
        setPages("wikimedia", term, data.continue ? page + 2 : page);
        const out = [];
        for (const pg of Object.values((data.query && data.query.pages) || {})) {
          const ii = pg.imageinfo && pg.imageinfo[0];
          if (!ii || ii.mime !== "image/jpeg") continue;
          const md = ii.extmetadata || {};
          const lic = stripHtml(md.LicenseShortName && md.LicenseShortName.value);
          // Only freely reusable licences: CC0, public domain, CC BY, CC BY-SA.
          if (!/^(cc0|cc[- ]?zero|public domain|pd\b|cc[- ]by(-sa)?\b)/i.test(lic) || /\b(nc|nd)\b/i.test(lic)) continue;
          const title = pg.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/_/g, " ");
          out.push({
            key: "wikimedia:" + pg.pageid, source: "wikimedia", sourceName: "Wikimedia Commons",
            url: ii.thumburl || ii.url, width: ii.width, height: ii.height,
            text: [title, stripHtml(md.ObjectName && md.ObjectName.value), stripHtml(md.ImageDescription && md.ImageDescription.value).slice(0, 400),
              stripHtml(md.Categories && md.Categories.value).replace(/\|/g, " ")].join(" "),
            title,
            author: stripHtml(md.Artist && md.Artist.value).slice(0, 80) || "Unknown author", authorUrl: ii.descriptionurl,
            pageUrl: ii.descriptionurl, license: lic, licenseUrl: md.LicenseUrl && md.LicenseUrl.value
          });
        }
        return out;
      }
    }
  };

  function acceptable(scene, p) {
    if (!p.url || !p.width || !p.height) return false;
    if (p.width < p.height * 1.2) return false;          // landscape only
    if (p.width < 1200) return false;                     // sharp enough for full screen
    if (BAD.test(p.text || "")) return false;             // people, buildings, text…
    if (scene.mustMatch && !scene.mustMatch.test(p.text || "")) return false;
    return true;
  }

  // ------------------------------------------------------------ pools
  const pools = {};        // sceneId -> candidates
  const seenInPool = {};   // sceneId -> Set of keys already pooled this session
  const failures = {};     // source -> consecutive failures

  function availableSources() {
    return Object.keys(SOURCES).filter(s => SOURCES[s].enabled() && canCall(s) && (failures[s] || 0) < 4);
  }

  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

  async function refill(scene) {
    const srcs = shuffle(availableSources());
    for (const src of srcs) {
      const terms = src === "wikimedia" ? scene.wikiTerms.concat(scene.terms) : scene.terms;
      const term = terms[(Math.random() * terms.length) | 0];
      try {
        const found = await SOURCES[src].search(scene, term);
        failures[src] = 0;
        const seen = seenInPool[scene.id] || (seenInPool[scene.id] = new Set());
        const fresh = found.filter(p => !recentSet.has(p.key) && !seen.has(p.key) && acceptable(scene, p));
        fresh.forEach(p => { seen.add(p.key); p.sceneId = scene.id; });
        if (!found.length) setPages(src, term, 1);
        if (fresh.length) {
          // Keep a mix: only take a handful per search so sources/terms interleave.
          const pool = pools[scene.id] || (pools[scene.id] = []);
          pool.push(...shuffle(fresh).slice(0, 8));
          shuffle(pool);
          return true;
        }
      } catch (e) {
        failures[src] = (failures[src] || 0) + 1;
        console.warn("[photos]", e.message || e);
      }
    }
    return false;
  }

  // ------------------------------------------------------------ cache (IndexedDB)
  let dbp = null;
  function db() {
    if (!dbp) dbp = new Promise((resolve) => {
      try {
        const req = indexedDB.open("quiet-places", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("photos", { keyPath: "key" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(d => d && new Promise((resolve) => {
      try {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = t.onabort = () => resolve(null);
      } catch (e) { resolve(null); }
    }));
  }
  async function cacheAll() { return (await tx("photos", "readonly", s => s.getAll())) || []; }
  async function cachePut(photo, blob) {
    const meta = Object.assign({}, photo); delete meta.objectUrl; delete meta.blob;
    await tx("photos", "readwrite", s => s.put({ key: photo.key, sceneId: photo.sceneId, meta, blob, ts: Date.now() }));
    const all = await cacheAll();
    const drop = [];
    // Over the limit: drop the oldest photo of the scene that has the most saved,
    // so every scene keeps a few photos for offline use.
    while (all.length - drop.length > CACHE_MAX) {
      const left = all.filter(r => !drop.includes(r.key));
      const per = {};
      left.forEach(r => { per[r.sceneId] = (per[r.sceneId] || 0) + 1; });
      const busiest = Object.keys(per).sort((a, b) => per[b] - per[a])[0];
      const oldest = left.filter(r => r.sceneId === busiest).sort((a, b) => a.ts - b.ts)[0];
      drop.push(oldest.key);
    }
    if (drop.length) await tx("photos", "readwrite", s => { drop.forEach(k => s.delete(k)); });
  }
  async function cacheTouch(key) {
    await tx("photos", "readwrite", s => {
      const g = s.get(key);
      g.onsuccess = () => { if (g.result) { g.result.ts = Date.now(); s.put(g.result); } };
    });
  }

  // ------------------------------------------------------------ loading
  function decodeImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      const t = setTimeout(() => { img.src = ""; reject(new Error("image timeout")); }, 30000);
      img.onload = () => { clearTimeout(t); (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => resolve(img)); };
      img.onerror = () => { clearTimeout(t); reject(new Error("image failed")); };
      img.src = src;
    });
  }

  async function load(photo) {
    // Fetch as a blob so it can be cached; if the CDN refuses CORS, fall back
    // to a plain <img> (shown fine, just not cached).
    let src = photo.url, blob = null;
    try {
      const to = timeout(30000);
      const r = await fetch(photo.url, { mode: "cors", signal: to.signal }).finally(to.done);
      if (r.ok) {
        const b = await r.blob();
        if (b.type.startsWith("image/") && b.size > 20000) { blob = b; src = URL.createObjectURL(b); }
      }
    } catch (e) { /* fall through */ }
    const img = await decodeImage(src);
    if (img.naturalWidth < img.naturalHeight * 1.15) throw new Error("not landscape");
    return Object.assign({}, photo, { objectUrl: src, isBlob: !!blob, blob });
  }

  async function fromCache(scene, excludeKey) {
    const all = (await cacheAll()).filter(r => r.sceneId === scene.id && r.key !== excludeKey);
    if (!all.length) return null;
    all.sort((a, b) => a.ts - b.ts); // least recently shown first
    const r = all[0];
    cacheTouch(r.key);
    return Object.assign({}, r.meta, { objectUrl: URL.createObjectURL(r.blob), isBlob: true, fromCache: true, blob: null });
  }

  /**
   * Get the next photo for a scene, fully downloaded and decoded.
   * Returns null when nothing (live or cached) is available -> painted scene.
   */
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
      catch (e) { console.warn("[photos] skip", cand.key, e.message); }
    }
    return fromCache(scene, currentKey);
  }

  function shown(photo) {
    if (photo.fromCache) return;
    markShown(photo.key);
    if (photo.blob) cachePut(photo, photo.blob);   // cache only photos that were really shown
    // Unsplash asks apps to report "use" of a photo via download_location.
    if (photo.source === "unsplash" && photo.downloadLocation && canCall("unsplash", 10)) {
      const path = photo.downloadLocation.replace(HOSTS.unsplash, "");
      api("unsplash", path, { Authorization: "Client-ID " + CFG.unsplashAccessKey, "Accept-Version": "v1" }).catch(() => {});
    }
  }

  function status() {
    const out = {};
    for (const s of Object.keys(SOURCES)) {
      const st = rateState(s);
      out[s] = {
        name: SOURCES[s].name, enabled: SOURCES[s].enabled(), used: st.count, limit: LIMITS[s],
        pausedUntil: st.blockedUntil > Date.now() ? st.blockedUntil : 0, failures: failures[s] || 0
      };
    }
    return out;
  }

  async function clearCache() {
    await tx("photos", "readwrite", s => s.clear());
    recent = []; recentSet.clear(); lsSet("qp.recent", recent);
  }

  window.QP_PHOTOS = { next, shown, status, clearCache, cacheAll, _acceptable: acceptable, _BAD: BAD };
})();
