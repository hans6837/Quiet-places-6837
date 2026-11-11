/*
 * Quiet Places — your API keys.
 *
 * 1. Copy this file to "config.js" in the same folder (the start scripts do
 *    this for you the first time).
 * 2. Paste your keys between the quotes below. Leave a key empty to skip
 *    that source. Wikimedia Commons needs no key.
 *    On the iPad you can instead type the Pixabay key in the app: Settings → Video key.
 *
 * config.js is listed in .gitignore, so your keys stay on your computer.
 */
window.QUIET_PLACES_CONFIG = {
  pixabayKey: "",           // https://pixabay.com/api/docs/  (free; shown on that page when logged in)
  freesoundKey: "",         // https://freesound.org/apiv2/apply  ("Client secret/Api key")

  // Optional: turn Wikimedia Commons videos off.
  useWikimedia: true
};
