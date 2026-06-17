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
from datetime import date, timedelta

import db

DEBOUNCE_SECS = 8.0          # wait this long after the last change before backing up
RETAIN_DAYS = 60             # keep this many daily snapshots; prune older dated copies
RETRY_SECS = 45.0            # if a backup can't reach the folder, retry this often

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


def _atomic_replace(tmp: str, path: str, attempts: int = 6) -> None:
    """os.replace(), but retry when a cloud client (OneDrive / Google Drive) has
    the destination momentarily locked for upload.

    Those locks are transient — while OneDrive/Drive uploads finance-autobackup.db
    it holds the file open, and Windows then fails the swap with WinError 5
    (Access denied) or 32 (in use). A few short retries clear almost all of them.
    """
    delay = 0.3
    for i in range(attempts):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if i == attempts - 1:
                raise
            time.sleep(delay)
            delay = min(delay * 1.6, 2.0)


def _backup_to(src_conn, path: str) -> None:
    """Write a consistent copy of src to `path` atomically."""
    tmp = path + ".tmp"
    dst = sqlite3.connect(tmp)
    try:
        with dst:
            src_conn.backup(dst)
    finally:
        dst.close()
    try:
        _atomic_replace(tmp, path)   # atomic swap — synced file is never half-written
    except OSError:
        # Cloud client kept the destination locked through every retry. Don't
        # leave the half-finished .tmp behind for it to upload as junk.
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _prune_old_dated(dest_dir: str, retain_days: int = RETAIN_DAYS) -> None:
    """Delete dated snapshots (finance-YYYY-MM-DD.db) older than retain_days.
    The rolling 'finance-autobackup.db' is never touched. Best-effort: anything
    we can't parse or delete is simply left alone, so pruning can never fail a
    backup."""
    cutoff = date.today() - timedelta(days=retain_days)
    try:
        names = os.listdir(dest_dir)
    except OSError:
        return
    for name in names:
        if not (name.startswith("finance-") and name.endswith(".db")):
            continue
        stamp = name[len("finance-"):-len(".db")]   # 'YYYY-MM-DD' for a dated copy
        try:
            d = date.fromisoformat(stamp)
        except ValueError:
            continue                                 # e.g. 'finance-autobackup.db'
        if d < cutoff:
            try:
                os.remove(os.path.join(dest_dir, name))
            except OSError:
                pass


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
            # Refresh the dated copy every time so it holds the LATEST state of
            # the day (not just the morning's first save).
            _backup_to(src, dated)
        finally:
            src.close()
        _prune_old_dated(dest_dir)   # keep the last RETAIN_DAYS daily snapshots
        return {"ok": True, "path": latest}
    except PermissionError:
        return {"ok": False, "error": "Backup folder was busy (OneDrive / Google "
                "Drive was syncing). It will try again automatically on the next change."}
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
                st = do_backup(folder)
                _record(st)
                if not st.get("ok"):
                    # The folder wasn't reachable — e.g. Google Drive's drive
                    # isn't mounted yet just after boot. Wait a bit and re-arm so
                    # the backup completes on its own once the folder reappears;
                    # the user needn't do anything. (The live DB is safe locally
                    # in the meantime.)
                    time.sleep(RETRY_SECS)
                    _dirty.set()
        except Exception as e:               # never let the worker die
            _record({"ok": False, "error": str(e)})
            time.sleep(5.0)
