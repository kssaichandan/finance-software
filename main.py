"""Finance Tracker - entry point.

Runs a local HTTP server that serves the web/ folder and exposes a /api/<method>
endpoint backed by api.API. Opens Edge in app-mode pointing at the local URL,
so it looks like a normal desktop app but has no .NET / pywebview / pythonnet
dependencies.
"""
import os
import sys
import time
import json
import socket
import secrets
import threading
import traceback
import webbrowser
import subprocess
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


# Updated by every request and every heartbeat. If no activity for
# IDLE_TIMEOUT seconds (browser window closed), the process exits.
LAST_ACTIVITY = time.time()
IDLE_TIMEOUT = 30.0  # seconds (heartbeat is every 5s; tolerate brief stalls)

# Fresh per-process random token. Embedded into index.html when served, and
# required on every API/heartbeat request. Protects against CSRF and against
# random other processes hitting our local API.
SESSION_TOKEN = secrets.token_urlsafe(24)


def _touch() -> None:
    global LAST_ACTIVITY
    LAST_ACTIVITY = time.time()


def _base_dir() -> str:
    if getattr(sys, "frozen", False):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def _log_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _log_exception() -> None:
    """Append the current traceback to error.log next to the app (best-effort).
    Written with utf-8 so non-ASCII (e.g. Indic names in a message) can't make
    the logging itself fail."""
    try:
        log_path = os.path.join(_log_dir(), "error.log")
        with open(log_path, "a", encoding="utf-8", errors="replace") as f:
            f.write("\n" + "=" * 60 + "\n")
            f.write(time.strftime("%Y-%m-%d %H:%M:%S") + "\n")
            traceback.print_exc(file=f)
    except Exception:
        pass


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg":  "image/svg+xml",
    ".png":  "image/png",
    ".jpg":  "image/jpeg",
    ".ico":  "image/x-icon",
}


def build_handler(api):
    web_root = os.path.join(_base_dir(), "web")

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_a, **_kw):
            pass  # silence default access log

        def _send(self, status, body, content_type="text/plain; charset=utf-8"):
            if isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            _touch()
            path = urlparse(self.path).path
            if path == "/" or path == "":
                path = "/index.html"
            # Serve files from web/ folder. Resolve to an absolute path and
            # confirm it sits inside web_root (defense against any path
            # traversal trickery — e.g. drive letters on Windows).
            safe = os.path.normpath(path.lstrip("/")).lstrip(os.sep).lstrip("/")
            full = os.path.abspath(os.path.join(web_root, safe))
            web_root_abs = os.path.abspath(web_root)
            if (full != web_root_abs and
                not full.startswith(web_root_abs + os.sep)):
                self._send(404, "Not found")
                return
            if os.path.isfile(full):
                ext = os.path.splitext(full)[1].lower()
                ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
                with open(full, "rb") as f:
                    body = f.read()
                # Inject the session token into index.html so the frontend
                # can attach it to every API request.
                if ext == ".html":
                    inject = (
                        f'<script>window.SESSION_TOKEN = "{SESSION_TOKEN}";'
                        f'</script></head>'
                    ).encode("utf-8")
                    body = body.replace(b"</head>", inject, 1)
                self._send(200, body, ctype)
            else:
                self._send(404, f"Not found: {path}")

        def do_POST(self):
            path = urlparse(self.path).path
            # All POSTs must carry the per-session token. Protects against
            # cross-site requests from other websites you may visit while
            # the app is open, and against random other local processes.
            # secrets.compare_digest avoids timing leaks. Auth check runs
            # BEFORE _touch() so an unauthenticated request cannot keep the
            # server alive indefinitely.
            sent = self.headers.get("X-Session-Token", "")
            try:
                ok = secrets.compare_digest(sent, SESSION_TOKEN)
            except TypeError:
                ok = False  # non-ASCII header → fail closed, never crash
            if not ok:
                self._send(403, "Forbidden")
                return
            _touch()
            # Heartbeat: page is still open, keep server alive
            if path == "/heartbeat":
                self._send(200, b"ok", "text/plain")
                return
            if not path.startswith("/api/"):
                self._send(404, "Not found")
                return
            method_name = path[len("/api/"):]
            method = getattr(api, method_name, None)
            if not callable(method):
                self._send(404, f"No such API method: {method_name}")
                return
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length) if length else b"[]"
                args = json.loads(raw.decode("utf-8")) if raw else []
                if not isinstance(args, list):
                    args = [args]
                result = method(*args)
                try:
                    body = json.dumps(result, default=str, allow_nan=False)
                except ValueError:
                    # NaN/Infinity slipped into the result — refuse to emit
                    # invalid JSON (which would break the whole page).
                    self._send(400, json.dumps(
                        {"error": "The result contained invalid numbers."}),
                        "application/json; charset=utf-8")
                    return
                self._send(200, body, "application/json; charset=utf-8")
            except Exception:
                # Log full detail locally; return only a generic message so we
                # never leak file paths / stack traces to the client or the UI.
                _log_exception()
                self._send(500, json.dumps(
                    {"error": "Something went wrong on the server. See error.log."}),
                    "application/json; charset=utf-8")

    return Handler


def _launch_browser(url):
    """Try to open in Edge app-mode for a desktop-app feel.
    Fall back to default browser if Edge isn't there."""
    edge_paths = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    edge = next((p for p in edge_paths if os.path.isfile(p)), None) or shutil.which("msedge")
    if edge:
        try:
            subprocess.Popen([edge, f"--app={url}", "--window-size=1280,820"])
            return
        except OSError:
            pass
    webbrowser.open(url)


def main():
    import db
    from api import API

    try:
        db.init_db()
    except Exception:
        _log_exception()
        try:
            import ctypes
            ctypes.windll.user32.MessageBoxW(
                0,
                "Finance Tracker could not open its data file (finance.db).\n\n"
                "It may be open in another copy of the app, on a synced folder "
                "(OneDrive / Google Drive), read-only, or damaged.\n\n"
                "Close any other copies, move the folder off OneDrive, and try again.",
                "Finance Tracker - Data file error",
                0x10,
            )
        except Exception:
            pass
        sys.exit(1)
    api = API()

    port = _free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), build_handler(api))
    threading.Thread(target=server.serve_forever, daemon=True).start()

    url = f"http://127.0.0.1:{port}/"
    _launch_browser(url)

    # Watchdog: exit when the browser window stops sending heartbeats.
    # Frontend pings /heartbeat every 5s; if we see no activity for IDLE_TIMEOUT
    # seconds, assume the window was closed and shut the process down.
    # Grace period at startup so the page has time to load and start pinging.
    _touch()  # reset clock at startup
    grace_until = time.time() + 15.0
    last_tick = time.monotonic()
    try:
        while True:
            time.sleep(3)
            now_mono = time.monotonic()
            # If far more than our 3s nap elapsed, the machine was suspended
            # (laptop sleep). Don't count that gap as idle — treat the resume as
            # fresh activity so we don't kill a window the user still has open.
            if now_mono - last_tick > 30:
                last_tick = now_mono
                _touch()
                grace_until = time.time() + 5.0
                continue
            last_tick = now_mono
            now = time.time()
            if now < grace_until:
                continue
            if now - LAST_ACTIVITY > IDLE_TIMEOUT:
                # Browser closed (or never opened) — exit cleanly.
                return
    except KeyboardInterrupt:
        return


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log_path = os.path.join(_log_dir(), "error.log")
        with open(log_path, "w", encoding="utf-8", errors="replace") as f:
            traceback.print_exc(file=f)
        try:
            import ctypes
            msg = traceback.format_exc()
            ctypes.windll.user32.MessageBoxW(
                0,
                f"Finance Tracker crashed.\n\nError saved to:\n{log_path}\n\n{msg[:800]}",
                "Finance Tracker - Error",
                0x10,
            )
        except Exception:
            pass
        sys.exit(1)
