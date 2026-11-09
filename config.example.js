/*
 * Quiet Places — your API keys.
 *
 * 1. Copy this file to "config.js" in the same folder (the start scripts do
 *    this for you the first time).
 * 2. Paste your keys between the quotes below. Leave a key empty to skip
 *    that source. Wikimedia Commons needs no key.
 *
 * config.js is listed in .gitignore, so your keys stay on your computer.
 */
window.QUIET_PLACES_CONFIG = {
  pexelsKey: "",            // https://www.pexels.com/api/  (header: Authorization)
  unsplashAccessKey: "",    // https://unsplash.com/developers  ("Access Key", not the Secret)
  freesoundKey: "",         // https://freesound.org/apiv2/apply  ("Client secret/Api key")

  // Optional: turn photo sources on/off without deleting keys.
  useWikimedia: true
};
