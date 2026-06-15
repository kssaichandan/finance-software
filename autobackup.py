"""Automatic, safe, debounced backup of finance.db to a user-chosen folder
(e.g. a OneDrive / Google Drive synced folder, so it ends up in the cloud).

Design:
  * The LIVE database stays local. We only ever write *consistent snapshots*
    into the sync folder, using SQLite's online-backup API, so the synced file
    can never be half-written / corrupt (the classic "SQLite in Dropbox" bug).
  * After each change the app calls mark_dirty(). A background worker waits for
    a short quiet gap (so a batch of edits = one backup) and then writes:
      - finance-autobackup.db        (rolling "latest", overwritten each time)
      - finance-YYYY-MM-DD.db        (one dated copy per day, for rollback)
  * Files are written to a .tmp then os.replace()'d into place — atomic, so the
    cloud client only ever uploads a complete file.
"""
import os
import sqlite3
import threading
import time
from datetime import date

import db

DEBOUNCE_SECS = 8.0          # wait this long after the last change before backing up

_dirty = threading.Event()
_lock = threading.Lock()
_last_change = 0.0
_last_status = {"ok": None, "when": "", "path": "", "error": ""}


def mark_dirty() -> None:
    """Call after any data change. Schedules a backup once edits go quiet."""
    global _last_change
    with _lock:
        _last_change = time.monotonic()
    _dirty.set()


def settings():
    """(enabled: bool, folder: str) from app settings."""
    enabled = db.get_setting("autobackup_enabled", "0") == "1"
    folder = db.get_setting("autobackup_dir", "")
    return enabled, folder


def status() -> dict:
    return dict(_last_status)


def _backup_to(src_conn, path: str) -> None:
    """Write a consistent copy of src to `path` atomically."""
    tmp = path + ".tmp"
    dst = sqlite3.connect(tmp)
    try:
        with dst:
            src_conn.backup(dst)
    finally:
        dst.close()
    os.replace(tmp, path)   # atomic swap — the synced file is never half-written


def do_backup(dest_dir: str) -> dict:
    """Write the rolling-latest + per-day snapshot into dest_dir. Status dict."""
    if not dest_dir:
        return {"ok": False, "error": "No backup folder set."}
    try:
        os.makedirs(dest_dir, exist_ok=True)
        latest = os.path.join(dest_dir, "finance-autobackup.db")
        dated = os.path.join(dest_dir, f"finance-{date.today().isoformat()}.db")
        src = db.connect()
        try:
            _backup_to(src, latest)
            if not os.path.exists(dated):
                _backup_to(src, dated)
        finally:
            src.close()
        return {"ok": True, "path": latest}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _record(st: dict) -> None:
    global _last_status
    _last_status = {
        "ok": st.get("ok"),
        "when": time.strftime("%Y-%m-%d %H:%M:%S"),
        "path": st.get("path", ""),
        "error": st.get("error", ""),
    }


def backup_now() -> dict:
    """Force a backup right now to the configured folder (used by the UI button
    and right after the user enables/saves the setting)."""
    enabled, folder = settings()
    if not folder:
        return {"ok": False, "error": "No backup folder set."}
    st = do_backup(folder)
    _record(st)
    return st


def backup_to(folder: str) -> dict:
    """Back up to an arbitrary folder WITHOUT changing saved settings. Used by
    the manual 'Back up now' button so it can't quietly change the configured
    (password-protected) folder."""
    st = do_backup(folder or "")
    _record(st)
    return st


def run_worker() -> None:
    """Background loop: when dirty and quiet for DEBOUNCE_SECS, back up."""
    while True:
        try:
            _dirty.wait()                       # sleep until something changes
            while True:                          # wait for the edits to settle
                with _lock:
                    quiet = time.monotonic() - _last_change
                if quiet >= DEBOUNCE_SECS:
                    break
                time.sleep(1.0)
            _dirty.clear()
            enabled, folder = settings()
            if enabled and folder:
                _record(do_backup(folder))
        except Exception as e:               # never let the worker die
            _record({"ok": False, "error": str(e)})
            time.sleep(5.0)
