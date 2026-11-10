#!/usr/bin/env python3
"""
Download real nature recordings from Freesound for every scene.

    python3 fetch_sounds.py            download what's missing
    python3 fetch_sounds.py --refresh  choose recordings again from scratch

Reads the Freesound API key from config.js. For each scene it searches
Freesound, keeps only CC0 / CC BY recordings, and "listens" by metadata:
duration, name, tags and description must match the scene, and anything
mentioning music, voices, traffic or other human noise is rejected.
3–5 recordings per scene are saved as sounds/<scene>/<id>-<name>.mp3
(Freesound's high-quality MP3 previews), plus:

    sounds/manifest.js   list of files with author + licence (used by the app)
    sounds/REPORT.md     what was chosen, what was rejected and why

Freesound API limits: 60 requests/minute, 2,000/day. A full run uses
about 40 requests and waits ~1 s between them.
"""
import argparse
import datetime
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SOUNDS = os.path.join(HERE, "sounds")
API = os.environ.get("QP_FREESOUND_API", "https://freesound.org/apiv2")
UA = "QuietPlaces/1.0 (personal relaxation app)"
FIELDS = "id,name,tags,description,duration,license,username,previews,url,avg_rating,num_downloads"

# ---------------------------------------------------------------------------
# What each scene should sound like.
#   need   : at least one of these words must appear (name/tags/description)
#   need2  : …and at least one of these (optional)
#   avoid  : scene-specific words that mean "wrong kind of sound"
#   groups : try to include at least one recording of each group
# ---------------------------------------------------------------------------
SCENES = {
    "sunset-beach": dict(
        queries=["waves beach sand", "ocean waves shore", "gentle waves beach", "sea waves sandy beach"],
        need=["wave", "waves", "surf", "ocean", "sea"],
        need2=["beach", "sand", "sandy", "shore", "shoreline", "seashore"],
        avoid=["rock", "rocks", "rocky", "cliff", "cliffs", "pebble", "pebbles", "shingle", "storm", "thunder", "rain",
               "underwater", "hydrophone"],
    ),
    "moonlit-shore": dict(
        queries=["night waves shore", "water lapping shore", "calm sea night", "lake shore lapping"],
        need=["lapping", "lap", "laps", "ripples", "ripple", "waves", "wave"],
        need2=["shore", "shoreline", "beach", "lake", "sea", "night", "calm", "gentle", "lakeshore"],
        avoid=["storm", "thunder", "rain", "boat", "hull", "ship", "stream", "river", "creek", "waterfall", "crashing",
               "underwater", "hydrophone", "rocks", "rocky"],
    ),
    "rocky-coast": dict(
        queries=["waves rocks", "surf crashing rocks", "sea waves rocky coast", "waves cliffs"],
        need=["wave", "waves", "surf", "sea", "ocean", "swell", "breakers"],
        need2=["rock", "rocks", "rocky", "cliff", "cliffs", "crag", "boulders", "coast", "coastline"],
        avoid=["thunder", "rain", "underwater", "hydrophone", "sand", "sandy"],
    ),
    "lagoon": dict(
        queries=["water lapping", "calm sea gentle waves", "tropical beach calm water", "shallow water lapping"],
        need=["lapping", "lap", "ripples", "gentle", "calm", "small waves", "lagoon", "shallow"],
        need2=["water", "sea", "beach", "shore", "lagoon", "waves", "ocean"],
        avoid=["storm", "thunder", "rain", "boat", "hull", "ship", "stream", "river", "creek", "waterfall", "crashing",
               "underwater", "hydrophone", "rocks", "rocky", "drip", "dripping", "sink", "bath", "bathtub", "tap",
               "night", "lake", "pond", "crickets", "frogs"],
    ),
    "morning-pines": dict(
        queries=["wind pine forest birds", "forest morning birds wind", "pine trees wind birdsong", "dawn chorus forest"],
        need=["forest", "woods", "woodland", "pine", "pines", "trees", "conifer"],
        need2=["bird", "birds", "birdsong", "chirping", "songbird", "songbirds", "dawn chorus"],
        avoid=["rain", "stream", "river", "creek", "thunder", "storm", "night", "owl", "crickets", "frogs", "chainsaw"],
    ),
    "forest-stream": dict(
        queries=["forest stream", "creek stones water", "brook forest", "babbling brook"],
        need=["stream", "creek", "brook", "rill", "babbling", "river"],
        need2=["forest", "woods", "woodland", "stones", "rocks", "trickling", "babbling", "small", "mountain", "water"],
        avoid=["rain", "boat", "hydrophone", "underwater", "kayak", "swimming", "drain", "sewer", "pipe", "tap"],
    ),
    "forest-rain": dict(
        queries=["rain on leaves forest", "rain forest leaves", "gentle rain woods", "rain trees"],
        need=["rain", "rainfall", "raindrops", "drizzle", "shower"],
        need2=["leaves", "leaf", "forest", "woods", "woodland", "trees", "foliage"],
        avoid=["roof", "window", "umbrella", "tent", "car", "metal", "gutter", "tin", "porch", "awning", "skylight",
               "heavy thunder", "downpour city", "frog", "frogs", "coqui", "coqui-frogs", "insects"],
    ),
    "forest-night": dict(
        queries=["night forest crickets owl", "crickets night ambience", "owl night forest", "tawny owl night"],
        need=["night", "nocturnal", "crickets", "cricket", "owl", "owls", "katydid", "katydids"],
        need2=["cricket", "crickets", "owl", "owls", "insects", "katydid", "katydids"],
        avoid=["rain", "thunder", "storm", "city", "toy"],
        groups=[["cricket", "crickets", "katydid", "katydids", "insects"], ["owl", "owls"]],
    ),
    "loons": dict(
        queries=["common loon", "loon call lake", "loon wail", "gavia immer"],
        need=["loon", "loons", "gavia", "great northern diver"],
        avoid=["toy", "imitation", "looney", "loony", "cartoon", "rain", "thunder"],
        min_dur=12,
    ),
    "frog-pond": dict(
        queries=["spring peepers", "frogs pond night", "peepers frogs chorus", "frog chorus pond"],
        need=["frog", "frogs", "peeper", "peepers", "toad", "toads", "pseudacris", "hyla", "amphibian", "amphibians",
              "bullfrog"],
        avoid=["toy", "rain", "thunder", "game"],
        groups=[["peeper", "peepers", "pseudacris"], ["frog", "frogs", "bullfrog", "toad", "toads"]],
    ),
    "whales": dict(
        queries=["humpback whale song", "humpback whale hydrophone", "whale song underwater", "megaptera"],
        need=["humpback", "megaptera", "whale", "whales"],
        need2=["humpback", "megaptera", "hydrophone", "underwater", "song", "singing", "recording"],
        avoid=["toy", "alien", "monster", "creature", "spaceship", "ship", "boat", "sonar", "submarine"],
        min_dur=15,
        prefer=["humpback", "megaptera", "hydrophone"],
    ),
    "meadow": dict(
        queries=["black-capped chickadee", "white-throated sparrow", "chickadee song", "zonotrichia albicollis"],
        need=["chickadee", "chickadees", "poecile", "white-throated sparrow", "white throated sparrow", "zonotrichia"],
        avoid=["house sparrow", "passer domesticus", "city", "feeder squabble", "toy"],
        groups=[["chickadee", "chickadees", "poecile"], ["white-throated sparrow", "white throated sparrow", "zonotrichia"]],
        min_dur=12,
    ),
}

# Never in a calm nature soundscape.
BANNED = [
    "music", "musical", "song structure", "melody", "melodic", "instrument", "instrumental", "guitar", "piano", "flute",
    "synth", "synthesizer", "synthesized", "synthetic", "pad", "drone", "beat", "beats", "drum", "drums", "chord",
    "voice", "voices", "vocal", "vocals", "speech", "talk", "talking", "speaking", "spoken", "narration", "narrator",
    "whisper", "whispering", "singer", "people", "person", "man", "men", "woman", "women", "child", "children", "kid",
    "kids", "baby", "crowd", "laugh", "laughing", "laughter", "cough", "sneeze", "human", "humans", "footsteps",
    "footstep", "steps", "walking", "breathing", "breath", "whistling", "imitating", "imitation", "traffic", "car",
    "cars", "road", "highway", "motorway", "freeway", "street", "city", "urban", "town", "engine", "motor", "motorboat",
    "airplane", "aeroplane", "plane", "aircraft", "jet", "helicopter", "train", "railway", "siren", "horn", "honk",
    "dog", "dogs", "bark", "barking", "radio", "tv", "television", "construction", "machine", "machinery",
    "generator", "lawnmower", "chainsaw", "church", "bell", "bells", "chime", "chimes", "sound design", "sounddesign",
    "designed", "processed", "reverse", "reversed", "pitched", "remix", "meditation music", "ambient music",
    "binaural beats", "hz", "sine", "tone", "white noise", "pink noise", "brown noise", "asmr", "game", "cartoon",
    "horror", "scary", "creepy", "fake", "simulated", "foley", "mouth", "microphone test", "mic test", "gunshot",
    "gun", "shots", "fireworks", "phone", "mobile", "notification", "ringtone", "electronic", "glitch",
    "motors", "outboard", "outboard-motors", "boats", "diving", "scuba", "snorkel", "snorkeling", "bubbles", "gutter",
    "gutters", "house", "harbour", "harbor", "pier", "dock", "marina", "port",
]
NEGATIONS = re.compile(r"(no|not|without|free of|free from|away from|absence of|zero|minimal|minimum|little|hardly any)\W+(?:\w+\W+){0,3}$")


def word_re(words):
    return re.compile(r"(?<![a-z])(" + "|".join(re.escape(w) for w in sorted(words, key=len, reverse=True)) + r")(?![a-z])")


BANNED_RE = word_re(BANNED)


def read_key():
    env = re.sub(r"\s+", "", os.environ.get("FREESOUND_KEY", ""))  # ignore stray spaces / line breaks
    path = os.path.join(HERE, "config.js")
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as f:
        m = re.search(r"freesoundKey\s*:\s*[\"']([^\"']*)[\"']", f.read())
    return (m.group(1).strip() if m else "") or env


_last_call = [0.0]
PACE = 2.0  # seconds between API calls: ~30/minute, well under Freesound's 60/minute


def api_get(path, params, key):
    params = dict(params, token=key)
    url = f"{API}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(4):
        wait = PACE - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                try:
                    pause = min(120, max(5, int(e.headers.get("Retry-After") or 30)))
                except ValueError:
                    pause = 30
                print(f"   Freesound asks us to slow down — waiting {pause} s…")
                time.sleep(pause)
                continue
            if e.code in (401, 403):
                raise SystemExit(
                    "Freesound rejected the API key (HTTP %d). Use the long 'Client secret/Api key' from "
                    "https://freesound.org/apiv2/apply (not the shorter 'Client id'), in config.js or the "
                    "FREESOUND_KEY secret." % e.code)
            if e.code == 400 and attempt == 0:
                raise
            print(f"   Freesound answered HTTP {e.code} — retrying…")
            time.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"   network problem ({e}) — retrying…")
            time.sleep(2 ** attempt)
    raise RuntimeError("Freesound did not answer after several tries")


def licence(url):
    u = (url or "").lower()
    if "publicdomain/zero" in u or "cc0" in u:
        return "CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"
    m = re.search(r"/licenses/by/(\d\.\d)", u)
    if m:
        return f"CC BY {m.group(1)}", f"https://creativecommons.org/licenses/by/{m.group(1)}/"
    return None, None


def banned_hit(text):
    for m in BANNED_RE.finditer(text):
        before = text[max(0, m.start() - 40):m.start()]
        if NEGATIONS.search(before):
            continue  # "no traffic", "without voices" …
        return m.group(1)
    return None


def check(sound, spec):
    """Return (ok, reason, score). The metadata 'listen-check'."""
    name = (sound.get("name") or "").lower()
    tags = [t.lower().replace("_", " ") for t in sound.get("tags") or []]
    desc = re.sub(r"<[^>]+>", " ", sound.get("description") or "").lower()
    text = " ".join([name, " ".join(tags), desc]).replace("-", " ")
    text_h = " ".join([name, " ".join(tags), desc])  # with hyphens, for "white-throated"
    dur = float(sound.get("duration") or 0)

    lic, _ = licence(sound.get("license"))
    if not lic:
        return False, f"licence not CC0/CC BY ({sound.get('license')})", 0
    if dur < spec.get("min_dur", 20):
        return False, f"too short ({dur:.0f} s)", 0
    if dur > 240:
        return False, f"too long ({dur:.0f} s)", 0
    hit = banned_hit(text)
    if hit:
        return False, f"mentions '{hit}'", 0
    both = text + " " + text_h
    if not word_re(spec["need"]).search(both):
        return False, "doesn't mention " + "/".join(spec["need"][:4]), 0
    if spec.get("need2") and not word_re(spec["need2"]).search(both):
        return False, "doesn't mention " + "/".join(spec["need2"][:4]), 0
    av = word_re(spec["avoid"]).search(both) if spec.get("avoid") else None
    if av:
        return False, f"wrong kind of sound ('{av.group(1)}')", 0

    score = 2.0 * float(sound.get("avg_rating") or 0) + math.log10(1 + float(sound.get("num_downloads") or 0))
    tagtext = " ".join(tags)
    if "field recording" in tagtext or "fieldrecording" in tagtext or "field-recording" in tagtext:
        score += 2
    score += sum(1.0 for w in spec["need"] if word_re([w]).search(tagtext))
    score += sum(2.0 for w in spec.get("prefer", []) if word_re([w]).search(both))
    if dur >= 60:
        score += 1.5
    return True, "ok", score


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s[:40] or "sound"


def choose(cands, spec, used=(), n_max=5):
    """Best 3-5, at most 2 per author, one of each group if possible.
    Recordings already used by another scene are only taken if needed to reach 3."""
    fresh = [c for c in cands if c["id"] not in used]
    cands = sorted(fresh, key=lambda c: -c["_score"]) + \
        sorted([c for c in cands if c["id"] in used], key=lambda c: -c["_score"])
    n_fresh = len(fresh)
    chosen, per_user = [], {}

    def take(c):
        if c in chosen or per_user.get(c["username"], 0) >= 2:
            return False
        chosen.append(c)
        per_user[c["username"]] = per_user.get(c["username"], 0) + 1
        return True

    for group in spec.get("groups", []):
        g = word_re(group)
        for c in cands:
            if g.search(c["_text"]) and take(c):
                break
    for i, c in enumerate(cands):
        if len(chosen) >= n_max or (i >= n_fresh and len(chosen) >= 3):
            break
        take(c)
    return chosen[:n_max]


def download(url, dest):
    print(f"     downloading {os.path.basename(dest)}")
    tmp = dest + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                f.write(chunk)
        if os.path.getsize(tmp) < 10000:
            raise RuntimeError("file too small")
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def run(key, refresh=False, only=None):
    os.makedirs(SOUNDS, exist_ok=True)
    manifest_path = os.path.join(SOUNDS, "manifest.js")
    old = {}
    if os.path.exists(manifest_path):
        try:
            txt = open(manifest_path, encoding="utf-8").read()
            old = json.loads(txt[txt.index("{"):txt.rindex("}") + 1]).get("scenes", {})
        except Exception:
            old = {}

    scenes_out, report = {}, ["# Freesound selection report", "",
                              f"Generated {datetime.datetime.now():%Y-%m-%d %H:%M}. Only CC0 and CC BY recordings; "
                              "checked by duration, name, tags and description.", ""]
    started = time.time()
    deadline = float(os.environ.get("QP_DEADLINE_MIN") or 0) * 60  # 0 = no limit
    for scene_id, spec in SCENES.items():
        if deadline and time.time() - started > deadline:
            print(f" … time is up for this run; {scene_id} and the scenes after it are left for the next run")
            for rest in list(SCENES)[list(SCENES).index(scene_id):]:
                scenes_out.setdefault(rest, [it for it in old.get(rest, []) if os.path.exists(os.path.join(HERE, it["file"]))])
            break
        if only and scene_id not in only:
            scenes_out[scene_id] = old.get(scene_id, [])
            continue
        existing = []
        for it in old.get(scene_id, []):
            path = os.path.join(HERE, it["file"])
            if not os.path.exists(path):
                continue
            # Only look for forbidden words here: the stored name and tags are shorter
            # than the full description the recording was originally checked against.
            text = " ".join([it.get("name") or "", " ".join(it.get("tags") or [])]).lower().replace("_", " ")
            bad = banned_hit(text.replace("-", " ")) or banned_hit(text)
            av = word_re(spec["avoid"]).search(text) if spec.get("avoid") else None
            why = f"mentions '{bad}'" if bad else (f"wrong kind of sound ('{av.group(1)}')" if av else "")
            if not why:
                existing.append(it)
            else:
                print(f"   removing '{it.get('name')}' from {scene_id}: {why}")
                os.remove(path)
        if len(existing) >= 3 and not refresh:
            print(f" ✓ {scene_id}: {len(existing)} recordings already downloaded")
            scenes_out[scene_id] = existing
            report += [f"## {scene_id}", "", "Kept existing selection.", ""]
            continue

        print(f" … {scene_id}: searching", flush=True)
        try:
            items, ok, rejected = search_scene(scene_id, spec, key, scenes_out)
        except SystemExit:
            raise
        except Exception as e:
            print(f" ! {scene_id}: skipped this time ({e}); run the download again later")
            scenes_out[scene_id] = existing
            write_manifest(manifest_path, {**old, **scenes_out})
            continue
        scenes_out[scene_id] = items
        write_manifest(manifest_path, {**old, **scenes_out})
        flag = "✓" if len(items) >= 3 else "!"
        print(f" {flag} {scene_id}: {len(items)} recordings ({len(ok)} passed the check, {len(rejected)} rejected)", flush=True)

        report += [f"## {scene_id}", "", "**Chosen**", ""]
        report += [f"- [{i['name']}]({i['url']}) by {i['author']} — {i['license']}, {i['duration']:.0f} s" for i in items] or ["- (none)"]
        report += ["", "**Rejected (first 15)**", ""]
        report += [f"- {s.get('name')} ({s.get('username')}): {why}" for s, why in rejected[:15]] or ["- (none)"]
        report.append("")

    write_manifest(manifest_path, {**old, **scenes_out})
    with open(os.path.join(SOUNDS, "REPORT.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(report) + "\n")
    short = [s for s, v in scenes_out.items() if len(v) < 3]
    if short:
        print(" ! Fewer than 3 recordings for:", ", ".join(short), "— see sounds/REPORT.md")
    print(" Done. Credits are in the app (Credits button) and in sounds/manifest.js.")
    return scenes_out


def write_manifest(manifest_path, scenes_out):
    manifest = {"generated": datetime.datetime.now().isoformat(timespec="seconds"), "source": "freesound.org",
                "scenes": scenes_out}
    with open(manifest_path, "w", encoding="utf-8") as f:
        f.write("/* Generated by fetch_sounds.py — the recordings, their authors and licences. */\n")
        f.write("window.QP_SOUNDS = " + json.dumps(manifest, indent=1, ensure_ascii=False) + ";\n")


def search_scene(scene_id, spec, key, scenes_out):
    if True:
        seen, ok, rejected = set(), [], []
        lic_filter = '(license:"Creative Commons 0" OR license:"Attribution")'
        for q in spec["queries"]:
            params = {"query": q, "fields": FIELDS, "page_size": 60,
                      "filter": f"duration:[{spec.get('min_dur', 20)} TO 240] {lic_filter}"}
            try:
                data = api_get("/search/text/", params, key)
            except urllib.error.HTTPError:
                params.pop("filter")  # filter syntax refused — rely on our own checks
                data = api_get("/search/text/", params, key)
            for s in data.get("results", []):
                if s["id"] in seen:
                    continue
                seen.add(s["id"])
                good, why, score = check(s, spec)
                if good:
                    s["_score"] = score
                    s["_text"] = " ".join([s.get("name", ""), " ".join(s.get("tags") or []),
                                           s.get("description") or ""]).lower()
                    ok.append(s)
                else:
                    rejected.append((s, why))
            if len(ok) >= 12:
                break

        used = {it["id"] for v in scenes_out.values() for it in v}
        picks = choose(ok, spec, used)
        folder = os.path.join(SOUNDS, scene_id)
        os.makedirs(folder, exist_ok=True)
        # Freesound sends each file slowly, so download a scene's files at the same time.
        jobs = []
        for s in picks:
            prev = (s.get("previews") or {}).get("preview-hq-mp3")
            if not prev:
                continue
            fname = f"{s['id']}-{slug(s['name'])}.mp3"
            rel = f"sounds/{scene_id}/{fname}"
            jobs.append((s, prev, rel, os.path.join(HERE, rel)))

        def fetch(job):
            s, prev, rel, dest = job
            if not os.path.exists(dest):
                download(prev, dest)
            return job

        items = []
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = [pool.submit(fetch, j) for j in jobs]
            for job, fut in zip(jobs, futures):
                s, prev, rel, dest = job
                try:
                    fut.result()
                except Exception as e:
                    rejected.append((s, f"download failed: {e}"))
                    continue
                lic, lic_url = licence(s["license"])
                items.append({
                    "file": rel, "id": s["id"], "name": s["name"], "author": s["username"],
                    "license": lic, "licenseUrl": lic_url, "url": s.get("url") or f"https://freesound.org/s/{s['id']}/",
                    "duration": round(float(s["duration"]), 1),
                    "tags": (s.get("tags") or [])[:12],
                })
        # tidy files we no longer use
        keep = {os.path.basename(i["file"]) for i in items}
        for fn in os.listdir(folder):
            if fn.endswith(".mp3") and fn not in keep:
                os.remove(os.path.join(folder, fn))
        return items, ok, rejected


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--refresh", action="store_true", help="choose all recordings again")
    ap.add_argument("--scene", action="append", help="only this scene (repeatable)")
    args = ap.parse_args()
    key = read_key()
    if not key:
        sys.exit("No Freesound key found. Put it in config.js (freesoundKey) and try again.")
    run(key, refresh=args.refresh, only=args.scene)


if __name__ == "__main__":
    main()
