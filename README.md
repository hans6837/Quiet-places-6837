# Quiet Places

A relaxation app with 12 nature scenes (Sea, Forest and Animals). Every scene
plays **real nature video clips** fetched live from Pixabay or Wikimedia
Commons, and plays **real nature recordings** from Freesound that match the
video: a loon video comes with loon calls, a rocky coast with surf on rocks.

## On the iPad (web address)

Open **https://hans6837.github.io/Quiet-places-6837/** in Safari, then
**Share → Add to Home Screen → Add**. Tap **Settings → Video key**, paste your
free Pixabay key, and tap **Save key**. It is stored on the iPad
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
   pixabayKey: "…",          // free: https://pixabay.com/api/docs/ (shown when logged in)
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
works, but volumes aren't matched between scenes and videos come straight
from the APIs, so the start script is the better way.

## Using it

| | |
|---|---|
| **All / Sea / Forest / Animals** | choose a category |
| **New scene** (or `N`) | jump to another scene in the category |
| scene menu | choose a particular scene |
| volume slider, **Sleep** | sleep timer: the sound and the screen fade out over the last 2 minutes, then it stops (tap to wake) |
| **Settings** | change the video every 30 s / 1 / 2 / 5 min, change the scene automatically, Pixabay key, see the video sources and API usage, clear saved videos |
| **Credits** | every recording with its author and licence, plus the video on screen |
| `Space` / `F` | pause / full screen |

The controls hide after 4 seconds without mouse movement. The video's author and
source stay visible in a corner.

## How it works

**Videos** (`js/videos.js`)
- Real nature video clips from **Pixabay** (Pixabay Content License, free to
  use; needs a free key) and **Wikimedia Commons** (CC0, public domain, CC BY,
  CC BY-SA only; no key). No photos.
- Each scene has its own search terms (`js/scenes.js`). Every clip comes from a
  random source, term and result page; the IDs of the last 400 clips shown are
  remembered and skipped.
- Only landscape clips of at least 6 seconds are used. Clips whose tags or
  title mention people, buildings, boats, text, animation and similar are
  skipped. Animal scenes also need the animal named (e.g. "loon").
- Clips play muted (the sound is the matched Freesound recording), full screen,
  looping until the next one. The next clip loads in the background, and clips
  crossfade over 3 seconds.
- Up to 12 recent clips are saved in the browser, spread across the scenes. If
  a limit is hit or the internet drops, a saved clip of the *same* scene plays,
  so the sound still matches. With nothing saved, the painted scene is shown.
- Limits: Pixabay allows 100 requests/minute and asks that searches be cached
  for 24 hours (the app does both); Wikimedia is capped at 120/hour.

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
- **Only painted scenes:** open **Settings → Video sources**. "No key" means
  that key is missing in `config.js`. "Paused" means a rate limit was reached,
  and the source resumes by itself.
- **Port already in use:** the server picks the next free port and prints the
  address it used.
