# Quiet Places

A relaxation app with 12 nature scenes (Sea, Forest and Animals). Every scene
shows a new **real photo** fetched live from Pexels, Unsplash or Wikimedia
Commons, and plays **real nature recordings** from Freesound that match the
photo: a loon photo comes with loon calls, a rocky coast with surf on rocks.

## On the iPad (web address)

Open **https://hans6837.github.io/Quiet-places-6837/** in Safari, then
**Share → Add to Home Screen → Add**. Tap **Settings → Photo keys**, paste your
Pexels and Unsplash keys, and tap **Save keys**. They are stored on the iPad
only.

### One-time setup on GitHub (already done if the address works)

1. **Turn on the web address:** repository **Settings → Pages**. Under
   "Branch", choose **main** and **/ (root)**, then tap **Save**. After a minute
   or two the address above works.
2. **Download the sounds:** the iPad can't run the download script, so GitHub
   does it.
   - **Settings → Secrets and variables → Actions → New repository secret**.
     Name it `FREESOUND_KEY`, paste your Freesound key as the value, and tap
     **Add secret**.
   - **Actions → Download sounds → Run workflow**. It takes about two minutes,
     saves the recordings into `sounds/`, and the web address picks them up
     shortly after. Its summary shows which recordings were chosen and why.

The recordings are CC0 or CC BY, so they may be shared publicly. The authors
and licences are listed in the app's **Credits** screen.

## On a computer

You need **Python 3** (free from python.org; Macs and most PCs already have it).

1. **Add your keys.** Open `config.js` in a text editor. If it isn't there yet,
   copy `config.example.js` to `config.js`; the start script also does this the
   first time. Paste your keys between the quotes:
   ```js
   pexelsKey: "…",
   unsplashAccessKey: "…",   // the "Access Key", not the Secret key
   freesoundKey: "…",
   ```
2. **Start it:**
   - **Mac:** double-click `Start Quiet Places (Mac).command`. The first time,
     macOS may block it: right-click it, choose **Open**, then **Open** again.
   - **Windows:** double-click `Start Quiet Places (Windows).bat`.
   - **Any system, from a terminal in this folder:** `python3 server.py`

   The first start downloads the recordings from Freesound, which takes about a
   minute. Your browser then opens at `http://127.0.0.1:8777/`. Keep the small
   terminal window open while you use the app, and close it to stop.
3. Click **Begin**.

To pick new recordings later, run `python3 server.py --sounds` (or
`python3 fetch_sounds.py --refresh`).

You can also double-click `index.html` to open it without the server. It still
works, but volumes aren't matched between scenes and photos come straight
from the APIs, so the start script is the better way.

## Using it

| | |
|---|---|
| **All / Sea / Forest / Animals** | choose a category |
| **New scene** (or `N`) | jump to another scene in the category |
| scene menu | choose a particular scene |
| volume slider, **Sleep** | sleep timer: the sound and the screen fade out over the last 2 minutes, then it stops (tap to wake) |
| **Settings** | change the photo every 30 s / 1 / 2 / 5 min, change the scene automatically, see the photo sources and API usage, clear the photo cache |
| **Credits** | every recording with its author and licence, plus the photo on screen |
| `Space` / `F` | pause / full screen |

The controls hide after 4 seconds without mouse movement. The photographer and
source stay visible in a corner, as the photo sites require.

## How it works

**Photos** (`js/photos.js`)
- Each scene has its own search terms (`js/scenes.js`). Every photo comes from
  a random source, term and result page.
- One search returns 30–40 results, which go into a pool for that scene, so
  the app sends only a few API requests per hour.
- The IDs of the last 500 shown photos are remembered and skipped.
- Only landscape photos at least 1200 px wide are used. Photos whose
  title or description mention people, buildings, text, boats, drawings and
  similar are skipped. Animal scenes also need the animal named, for example
  "loon" or *Gavia*.
- Wikimedia photos must be CC0, public domain, CC BY or CC BY-SA.
- The next photo is downloaded while the current one is on screen. Each photo
  slowly zooms and pans, and photos crossfade over 3 seconds.
- The last 30 photos shown are kept in the browser, spread across the scenes.
  If a rate limit is hit or the internet drops, the app shows saved photos of
  the *same* scene, so the sound still matches. If none are saved, it shows the
  painted version of the scene.
- Rate limits: Pexels allows 200 requests/hour and 20,000/month, and the app
  stops at 150/hour. Unsplash allows 50/hour for new ("demo") apps, and the app
  stops at 40. Wikimedia has no fixed limit, and the app stops at 120/hour.
  If a site answers "too many requests", that source pauses for an hour while
  the others carry on.

**Sounds** (`fetch_sounds.py`, `js/audio.js`)
- Each scene gets 3 to 5 recordings from Freesound, CC0 or CC BY only.
  `fetch_sounds.py` checks every recording by its metadata:
  - its length must be between 12–20 seconds and 4 minutes;
  - its name, tags and description must fit the scene, for example
    "rocks/cliffs" for the rocky coast, or "humpback/hydrophone" for the whales;
  - anything that mentions music, synths, voices, people, traffic, engines,
    planes, dogs or sound design is rejected.

  `sounds/REPORT.md` lists what was chosen and why the others were rejected.
- Playback: the app plays 45–110 seconds of one recording from a random point,
  then crossfades over 8 seconds into another recording of the same scene.
  Recordings never loop with an audible seam.
- Each recording's loudness is measured once and adjusted, so all scenes play
  at the same volume.
- Freesound allows 60 requests/minute and 2,000/day. A full download uses about
  40 requests. The files are Freesound's high-quality MP3 previews, which only
  need the simple API key.

## Files

```
index.html, css/, js/          the app
config.example.js → config.js  your API keys (config.js is git-ignored)
server.py                      tiny local server (Python standard library only)
fetch_sounds.py                downloads + checks the Freesound recordings
sounds/<scene>/*.mp3           the recordings (created on first start)
sounds/manifest.js             authors and licences (used by the Credits screen)
tests/                         python3 -m unittest discover tests
```

## Troubleshooting

- **Scenes are silent:** check that `freesoundKey` is set in `config.js`, then
  run `python3 server.py --sounds` and read what it prints.
- **Only painted scenes:** open **Settings → Photo sources**. "No key" means
  that key is missing in `config.js`. "Paused" means a rate limit was reached,
  and the source resumes by itself.
- **Port already in use:** the server picks the next free port and prints the
  address it used.
