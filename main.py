"""Finance Tracker — entry point."""
import os
import sys
import traceback


def _base_dir() -> str:
    if getattr(sys, "frozen", False):
        return sys._MEIPASS  # type: ignore[attr-defined]
    return os.path.dirname(os.path.abspath(__file__))


def _log_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def main():
    import webview
    import db
    from api import API

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
    try:
        main()
    except Exception:
        log_path = os.path.join(_log_dir(), "error.log")
        with open(log_path, "w") as f:
            traceback.print_exc(file=f)
        # Show error in a popup so the user can read it
        try:
            import ctypes
            msg = traceback.format_exc()
            ctypes.windll.user32.MessageBoxW(
                0,
                f"Finance Tracker crashed.\n\nError saved to:\n{log_path}\n\n{msg[:800]}",
                "Finance Tracker — Error",
                0x10,
            )
        except Exception:
            pass
        sys.exit(1)
