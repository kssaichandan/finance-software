"""Finance Tracker — entry point."""
import os
import sys
import webview
import db
from api import API


def _base_dir() -> str:
    """Return the directory containing bundled files (works both frozen and dev)."""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def main():
    db.init_db()

    api = API()
    html_path = os.path.join(_base_dir(), "web", "index.html")

    window = webview.create_window(
        "Finance Tracker",
        url=html_path,
        js_api=api,
        width=1280,
        height=820,
        min_size=(960, 640),
    )
    api._window = window
    webview.start(debug=False)


if __name__ == "__main__":
    main()
