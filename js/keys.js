/*
 * API keys typed into Settings on this device (e.g. the iPad) are saved in
 * this browser only and merged over config.js. Nothing is sent anywhere
 * except to the video service the key belongs to.
 */
(function () {
  "use strict";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("qp.keys") || "{}"); } catch (e) { saved = {}; }

  // A key can also arrive in the link itself, e.g.
  //   https://…/Quiet-places-6837/#pixabay=YOUR_PIXABAY_KEY
  // so on an iPad you can tap a link instead of copy-pasting. The key is
  // saved on this device and immediately removed from the address bar.
  let fromLink = false;
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    [["pixabay", "pixabayKey"]].forEach(([param, k]) => {
      const v = (h.get(param) || "").replace(/\s+/g, "");
      if (v) { saved[k] = v; fromLink = true; }
    });
    if (fromLink) {
      localStorage.setItem("qp.keys", JSON.stringify(saved));
      history.replaceState(null, "", location.pathname + location.search);
    }
  } catch (e) { /* ignore */ }
  // A key link opened while the app is already showing: start again so it is used.
  window.addEventListener("hashchange", () => {
    if (/(^|[#&])pixabay=/.test(location.hash)) location.reload();
  });
  const fromFile = window.QUIET_PLACES_CONFIG || {};
  const cfg = Object.assign({ useWikimedia: true }, fromFile);
  ["pixabayKey"].forEach(k => { if (saved[k]) cfg[k] = saved[k]; });
  cfg._hasConfigFile = !!window.QUIET_PLACES_CONFIG;
  window.QUIET_PLACES_CONFIG = cfg;
  window.QP_KEYS = {
    get: () => ({ pixabayKey: cfg.pixabayKey || "" }),
    save(keys) {
      const clean = {};
      ["pixabayKey"].forEach(k => { clean[k] = String(keys[k] || "").replace(/\s+/g, ""); });
      try { localStorage.setItem("qp.keys", JSON.stringify(clean)); } catch (e) { return false; }
      return true;
    },
    fromLink: () => fromLink,
    // Ask Pixabay once whether the key works (one request).
    async testPixabay() {
      if (!cfg.pixabayKey) return "none";
      try {
        const r = await fetch("https://pixabay.com/api/videos/?per_page=3&q=forest&key=" + encodeURIComponent(cfg.pixabayKey));
        if (r.ok) return "ok";
        if (r.status === 400 || r.status === 401 || r.status === 403) return "rejected";
        return "unknown";
      } catch (e) { return "unknown"; }
    }
  };
})();
