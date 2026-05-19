"""Finance Tracker - entry point.

Runs a local HTTP server that serves the web/ folder and exposes a /api/<method>
endpoint backed by api.API. Opens Edge in app-mode pointing at the local URL,
so it looks like a normal desktop app but has no .NET / pywebview / pythonnet
dependencies.
"""
import os
import sys
import json
import socket
import threading
import traceback
import webbrowser
import subprocess
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote


def _base_dir() -> str:
    if getattr(sys, "frozen", False):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def _log_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


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
            path = urlparse(self.path).path
            if path == "/" or path == "":
                path = "/index.html"
            # Serve files from web/ folder
            safe = os.path.normpath(path.lstrip("/")).replace("..", "")
            full = os.path.join(web_root, safe)
            if os.path.isfile(full):
                ext = os.path.splitext(full)[1].lower()
                ctype = CONTENT_TYPES.get(ext, "application/octet-stream")
                with open(full, "rb") as f:
                    self._send(200, f.read(), ctype)
            else:
                self._send(404, f"Not found: {path}")

        def do_POST(self):
            path = urlparse(self.path).path
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
                self._send(200, json.dumps(result, default=str),
                           "application/json; charset=utf-8")
            except Exception:
                tb = traceback.format_exc()
                self._send(500, json.dumps({"error": tb}),
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

    db.init_db()
    api = API()

    port = _free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), build_handler(api))
    threading.Thread(target=server.serve_forever, daemon=True).start()

    url = f"http://127.0.0.1:{port}/"
    _launch_browser(url)

    # Keep the process alive while the app window is open. We can't easily
    # detect when the browser window closes, so we just wait forever; the user
    # closes the app by closing the browser window AND ending the process from
    # the system tray / task manager. For simplicity we just block.
    try:
        threading.Event().wait()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log_path = os.path.join(_log_dir(), "error.log")
        with open(log_path, "w") as f:
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
