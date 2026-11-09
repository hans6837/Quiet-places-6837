/*
 * API keys typed into Settings on this device (e.g. the iPad) are saved in
 * this browser only and merged over config.js. Nothing is sent anywhere
 * except to the photo service the key belongs to.
 */
(function () {
  "use strict";
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("qp.keys") || "{}"); } catch (e) { saved = {}; }
  const fromFile = window.QUIET_PLACES_CONFIG || {};
  const cfg = Object.assign({ useWikimedia: true }, fromFile);
  ["pexelsKey", "unsplashAccessKey"].forEach(k => { if (saved[k]) cfg[k] = saved[k]; });
  cfg._hasConfigFile = !!window.QUIET_PLACES_CONFIG;
  window.QUIET_PLACES_CONFIG = cfg;
  window.QP_KEYS = {
    get: () => ({ pexelsKey: cfg.pexelsKey || "", unsplashAccessKey: cfg.unsplashAccessKey || "" }),
    save(keys) {
      const clean = {};
      ["pexelsKey", "unsplashAccessKey"].forEach(k => { clean[k] = String(keys[k] || "").trim(); });
      try { localStorage.setItem("qp.keys", JSON.stringify(clean)); } catch (e) { return false; }
      return true;
    }
  };
})();
