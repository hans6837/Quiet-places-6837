/*
 * API keys typed into Settings on this device (e.g. the iPad) are saved in
 * this browser only and merged over config.js. Nothing is sent anywhere
 * except to the photo service the key belongs to.
 */
(function () {
  "use strict";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("qp.keys") || "{}"); } catch (e) { saved = {}; }

  // A key can also arrive in the link itself, e.g.
  //   https://…/Quiet-places-6837/#unsplash=YOUR_ACCESS_KEY
  // so on an iPad you can tap a link instead of copy-pasting. The key is
  // saved on this device and immediately removed from the address bar.
  let fromLink = false;
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ""));
    [["unsplash", "unsplashAccessKey"], ["pexels", "pexelsKey"]].forEach(([param, k]) => {
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
    if (/(^|[#&])(unsplash|pexels)=/.test(location.hash)) location.reload();
  });
  const fromFile = window.QUIET_PLACES_CONFIG || {};
  const cfg = Object.assign({ useWikimedia: true }, fromFile);
  ["pexelsKey", "unsplashAccessKey"].forEach(k => { if (saved[k]) cfg[k] = saved[k]; });
  cfg._hasConfigFile = !!window.QUIET_PLACES_CONFIG;
  window.QUIET_PLACES_CONFIG = cfg;
  window.QP_KEYS = {
    get: () => ({ pexelsKey: cfg.pexelsKey || "", unsplashAccessKey: cfg.unsplashAccessKey || "" }),
    save(keys) {
      const clean = {};
      ["pexelsKey", "unsplashAccessKey"].forEach(k => { clean[k] = String(keys[k] || "").replace(/\s+/g, ""); });
      try { localStorage.setItem("qp.keys", JSON.stringify(clean)); } catch (e) { return false; }
      return true;
    },
    fromLink: () => fromLink,
    // Ask Unsplash once whether the key works (one request).
    async testUnsplash() {
      if (!cfg.unsplashAccessKey) return "none";
      try {
        const r = await fetch("https://api.unsplash.com/photos?per_page=1",
          { headers: { Authorization: "Client-ID " + cfg.unsplashAccessKey, "Accept-Version": "v1" } });
        if (r.ok) return "ok";
        if (r.status === 401 || r.status === 403) return "rejected";
        return "unknown";
      } catch (e) { return "unknown"; }
    }
  };
})();
