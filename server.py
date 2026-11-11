#!/usr/bin/env python3
"""
Quiet Places — tiny local server (Python 3.8+, no extra packages).

    python3 server.py            start the app and open it in your browser
    python3 server.py --sounds   (re)download the nature recordings from Freesound first
    python3 server.py --no-browser --port 8777

What it does:
  * serves this folder on http://127.0.0.1:<port>/ (only reachable from this computer)
  * supports HTTP Range requests, so the audio player can start recordings mid-way
  * /proxy/<pixabay|wikimedia>/... forwards video-search API calls to
    those three hosts only (adds a proper User-Agent for Wikimedia, passes
    rate-limit headers back to the app)
  * on first start: creates config.js from config.example.js, and downloads the
    recordings if a Freesound key is set and none are downloaded yet
"""
import argparse
import http.server
import os
import re
import shutil
import socket
import socketserver
import sys
import threading
import urllib.error
import urllib.request
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
UA = "QuietPlaces/1.0 (personal relaxation app; local use)"
UPSTREAM = {
    "pixabay": "https://pixabay.com",
    "wikimedia": "https://commons.wikimedia.org",
}
# For automated tests only: point a source at a mock server, e.g. QP_UPSTREAM_PIXABAY=http://127.0.0.1:9912
UPSTREAM = {k: os.environ.get("QP_UPSTREAM_" + k.upper(), v) for k, v in UPSTREAM.items()}
FORWARD_REQ = ("authorization", "accept-version")
FORWARD_RES = ("content-type", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset")


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map,
                          **{".js": "text/javascript", ".mp3": "audio/mpeg", ".css": "text/css"})

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def log_message(self, fmt, *args):  # keep the terminal quiet
        if os.environ.get("QP_VERBOSE"):
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        if not self.path.startswith("/proxy/"):
            self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    # ---------------------------------------------------------------- proxy
    def do_GET(self):
        if self.path == "/proxy/health":
            return self._send(200, b"ok", "text/plain")
        if self.path.startswith("/proxy/"):
            return self._proxy()
        if self.headers.get("Range"):
            return self._range()
        return super().do_GET()

    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _proxy(self):
        rest = self.path[len("/proxy/"):]
        src, _, tail = rest.partition("/")
        base = UPSTREAM.get(src)
        if not base:
            return self._send(404, b"unknown source", "text/plain")
        # Only plain API paths: no host switching tricks.
        if "://" in tail or tail.startswith("/") or ".." in tail:
            return self._send(400, b"bad path", "text/plain")
        req = urllib.request.Request(base + "/" + tail, headers={"User-Agent": UA, "Api-User-Agent": UA})
        for h in FORWARD_REQ:
            if self.headers.get(h):
                req.add_header(h, self.headers[h])
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body, code, hdrs = r.read(), r.status, r.headers
        except urllib.error.HTTPError as e:
            body, code, hdrs = e.read(), e.code, e.headers
        except Exception as e:  # network down etc.
            return self._send(502, str(e).encode(), "text/plain")
        extra = {k: hdrs[k] for k in FORWARD_RES[1:] if hdrs.get(k)}
        self._send(code, body, hdrs.get("Content-Type", "application/json"), extra)

    # ---------------------------------------------------------------- byte ranges (audio seeking)
    def _range(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        m = re.match(r"bytes=(\d*)-(\d*)", self.headers["Range"] or "")
        if not m or (not m.group(1) and not m.group(2)):
            return super().do_GET()
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
        else:
            start, end = max(0, size - int(m.group(2))), size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            left = end - start + 1
            try:
                while left > 0:
                    chunk = f.read(min(65536, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def free_port(preferred):
    for p in [preferred] + list(range(preferred + 1, preferred + 30)):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return 0


def ensure_config():
    cfg = os.path.join(HERE, "config.js")
    if not os.path.exists(cfg):
        shutil.copy(os.path.join(HERE, "config.example.js"), cfg)
        print("Created config.js — open it in a text editor and paste your API keys.")
    return cfg


def main():
    ap = argparse.ArgumentParser(description="Start Quiet Places")
    ap.add_argument("--port", type=int, default=8777)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--sounds", action="store_true", help="download / refresh the Freesound recordings first")
    args = ap.parse_args()

    ensure_config()
    sys.path.insert(0, HERE)
    import fetch_sounds  # noqa: E402
    have_manifest = os.path.exists(os.path.join(HERE, "sounds", "manifest.js"))
    if args.sounds or not have_manifest:
        key = fetch_sounds.read_key()
        if key:
            print("Downloading nature recordings from Freesound (one time, about a minute)…")
            try:
                fetch_sounds.run(key, refresh=args.sounds)
            except Exception as e:
                print("Could not download recordings:", e)
        elif not have_manifest:
            print("No Freesound key in config.js yet — scenes will be silent until you add one and restart.")

    port = free_port(args.port)
    httpd = Server(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/"
    print(f"\nQuiet Places is running at {url}")
    print("Keep this window open while you use the app. Press Ctrl+C to stop.\n")
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped. Sleep well.")


if __name__ == "__main__":
    main()
