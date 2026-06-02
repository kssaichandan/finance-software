"""SQLite storage for the finance tracker."""
import sqlite3
import sys
from pathlib import Path


def _db_path() -> Path:
    if getattr(sys, "frozen", False):
        # Running as a PyInstaller bundle — store DB next to the .exe
        return Path(sys.executable).parent / "finance.db"
    return Path(__file__).parent / "finance.db"


DB_PATH = _db_path()


# Whitelists of columns allowed in dynamically-built INSERT/UPDATE statements.
# Without these, an attacker who already has the session token could inject
# arbitrary column names via the dict keys. Defense-in-depth.
_BORROWER_COLS = frozenset({
    "name", "father_name", "address", "phone", "phone2",
    "guarantor_name", "guarantor_phone", "guarantor_phone2", "guarantor_address",
    "vehicle_type", "vehicle_no", "engine_no", "chassis_no", "key_no", "serial_no",
    "book_ref", "showroom",
    "loan_amount", "interest_rate", "period_months", "installment_amount",
    "loan_date", "notes", "closed",
})
_PAYMENT_COLS = frozenset({
    "payment_date", "receipt_no", "amount", "installment_label", "notes", "payment_mode",
})
_PENALTY_COLS = frozenset({
    "charge_date", "receipt_no", "amount", "notes",
})
_SEIZING_COLS = frozenset({
    "seizing_date", "amount", "reason",
})


def _validate_cols(data: dict, allowed: frozenset, table: str) -> None:
    bad = [k for k in data.keys() if k not in allowed]
    if bad:
        raise ValueError(f"Disallowed column(s) for {table}: {bad}")


SCHEMA = """
CREATE TABLE IF NOT EXISTS borrowers (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    father_name         TEXT,
    address             TEXT,
    phone               TEXT,
    phone2              TEXT    DEFAULT '',
    guarantor_name      TEXT,
    guarantor_phone     TEXT,
    guarantor_phone2    TEXT    DEFAULT '',
    guarantor_address   TEXT,
    vehicle_type        TEXT,
    vehicle_no          TEXT,
    engine_no           TEXT,
    chassis_no          TEXT,
    key_no              TEXT,
    serial_no           TEXT,
    book_ref            TEXT    DEFAULT '',
    showroom            TEXT,
    loan_amount         REAL    NOT NULL,
    interest_rate       REAL    NOT NULL,
    period_months       INTEGER NOT NULL,
    installment_amount  REAL    NOT NULL,
    loan_date           TEXT    NOT NULL,
    notes               TEXT,
    closed              INTEGER NOT NULL DEFAULT 0,
    created_at          TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id         INTEGER NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
    payment_date        TEXT    NOT NULL,
    receipt_no          TEXT,
    amount              REAL    NOT NULL,
    installment_label   TEXT,
    notes               TEXT,
    payment_mode        TEXT    DEFAULT '',
    created_at          TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS penalties (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id         INTEGER NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
    charge_date         TEXT    NOT NULL,
    receipt_no          TEXT,
    amount              REAL    NOT NULL,
    notes               TEXT,
    created_at          TEXT    DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seizings (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    borrower_id         INTEGER NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
    seizing_date        TEXT    NOT NULL,
    amount              REAL    NOT NULL,
    reason              TEXT,
    created_at          TEXT    DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_borrower ON payments(borrower_id);
CREATE INDEX IF NOT EXISTS idx_penalties_borrower ON penalties(borrower_id);
CREATE INDEX IF NOT EXISTS idx_seizings_borrower ON seizings(borrower_id);
"""


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(SCHEMA)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(borrowers)").fetchall()]
        # Backfill columns that may be missing on databases created by older versions.
        if "book_ref" not in cols:
            conn.execute("ALTER TABLE borrowers ADD COLUMN book_ref TEXT DEFAULT ''")
        if "phone2" not in cols:
            conn.execute("ALTER TABLE borrowers ADD COLUMN phone2 TEXT DEFAULT ''")
        if "guarantor_phone2" not in cols:
            conn.execute("ALTER TABLE borrowers ADD COLUMN guarantor_phone2 TEXT DEFAULT ''")

        # payments.payment_mode — added in v1.28. We deliberately do NOT
        # backfill existing rows. Payments made before this feature existed
        # were a mix of cash / PhonePe / scanner with no way to know which,
        # so they stay blank and the UI shows nothing for them. Only new
        # payments added in v1.28+ carry an explicit mode.
        pay_cols = [r[1] for r in conn.execute("PRAGMA table_info(payments)").fetchall()]
        if "payment_mode" not in pay_cols:
            conn.execute("ALTER TABLE payments ADD COLUMN payment_mode TEXT DEFAULT ''")

        # One-time data fix: an earlier (un-released) v1.28 build wrongly
        # set every existing payment to 'Cash' on first run. Anyone whose DB
        # was touched by that build still has 'Cash' on those rows. Reset
        # them to blank, exactly once per DB (tracked via app_meta).
        conn.execute(
            "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)"
        )
        fixed = conn.execute(
            "SELECT 1 FROM app_meta WHERE key = 'payment_mode_clear_legacy_cash'"
        ).fetchone()
        if not fixed:
            conn.execute(
                "UPDATE payments SET payment_mode = '' WHERE payment_mode = 'Cash'"
            )
            conn.execute(
                "INSERT INTO app_meta (key, value) VALUES "
                "('payment_mode_clear_legacy_cash', '1')"
            )

        # Partial unique indexes — non-empty book_ref must be unique across
        # borrowers, and non-empty receipt_no must be unique within payments.
        # Wrapped in try/except so existing duplicates in old data do not
        # block startup; app-level checks will still block new duplicates.
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_book_ref "
                "ON borrowers(book_ref) "
                "WHERE book_ref IS NOT NULL AND TRIM(book_ref) != ''"
            )
        except sqlite3.Error:
            pass
        try:
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_payment_receipt "
                "ON payments(receipt_no) "
                "WHERE receipt_no IS NOT NULL AND TRIM(receipt_no) != ''"
            )
        except sqlite3.Error:
            pass


def book_ref_conflict(book_ref: str, exclude_id: int | None = None) -> dict | None:
    """Return {id, name, book_ref} of any OTHER borrower already using this
    non-empty book_ref (case-insensitive). None if no conflict.
    Replaces the old book_ref_exists() — callers now get the conflicting
    borrower's name so the error message can point to it."""
    bref = (book_ref or "").strip()
    if not bref:
        return None
    sql = ("SELECT id, name, book_ref FROM borrowers "
           "WHERE LOWER(TRIM(book_ref)) = LOWER(?)")
    params: list = [bref]
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    with connect() as conn:
        row = conn.execute(sql, params).fetchone()
        return {"id": row["id"], "name": row["name"], "book_ref": row["book_ref"]} if row else None


def payment_receipt_conflict(receipt_no: str, exclude_id: int | None = None) -> dict | None:
    """Return details of any OTHER payment already using this non-empty
    receipt_no (case-insensitive): {id, borrower_id, borrower_name, book_ref,
    payment_date, amount, receipt_no}. None if no conflict."""
    r = (receipt_no or "").strip()
    if not r:
        return None
    sql = ("SELECT p.id, p.borrower_id, p.payment_date, p.amount, p.receipt_no, "
           "       b.name AS borrower_name, b.book_ref AS book_ref "
           "FROM payments p JOIN borrowers b ON b.id = p.borrower_id "
           "WHERE LOWER(TRIM(p.receipt_no)) = LOWER(?)")
    params: list = [r]
    if exclude_id is not None:
        sql += " AND p.id != ?"
        params.append(exclude_id)
    with connect() as conn:
        row = conn.execute(sql, params).fetchone()
        if not row:
            return None
        return {
            "id": row["id"], "borrower_id": row["borrower_id"],
            "borrower_name": row["borrower_name"], "book_ref": row["book_ref"] or "",
            "payment_date": row["payment_date"], "amount": float(row["amount"]),
            "receipt_no": row["receipt_no"],
        }


def add_borrower(data: dict) -> int:
    _validate_cols(data, _BORROWER_COLS, "borrowers")
    cols = ", ".join(data.keys())
    placeholders = ", ".join(["?"] * len(data))
    with connect() as conn:
        cur = conn.execute(
            f"INSERT INTO borrowers ({cols}) VALUES ({placeholders})",
            tuple(data.values()),
        )
        return cur.lastrowid


def update_borrower(borrower_id: int, data: dict) -> None:
    _validate_cols(data, _BORROWER_COLS, "borrowers")
    assignments = ", ".join(f"{k} = ?" for k in data.keys())
    with connect() as conn:
        conn.execute(
            f"UPDATE borrowers SET {assignments} WHERE id = ?",
            (*data.values(), borrower_id),
        )


def list_borrowers(include_closed: bool = True) -> list[sqlite3.Row]:
    sql = "SELECT * FROM borrowers"
    if not include_closed:
        sql += " WHERE closed = 0"
    sql += " ORDER BY created_at DESC"
    with connect() as conn:
        return conn.execute(sql).fetchall()


def get_borrower(borrower_id: int) -> sqlite3.Row | None:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM borrowers WHERE id = ?", (borrower_id,)
        ).fetchone()


def add_payment(borrower_id: int, payment_date: str, amount: float,
                receipt_no: str = "", installment_label: str = "",
                notes: str = "", payment_mode: str = "") -> int:
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO payments
               (borrower_id, payment_date, receipt_no, amount,
                installment_label, notes, payment_mode)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (borrower_id, payment_date, receipt_no, amount,
             installment_label, notes, payment_mode or ""),
        )
        return cur.lastrowid


def add_payments_many(borrower_id: int, rows: list) -> list:
    """Insert several payments in ONE transaction. If any row fails, the whole
    batch is rolled back (the `with connect()` block does not commit on error)."""
    ids = []
    with connect() as conn:
        for r in rows:
            cur = conn.execute(
                "INSERT INTO payments (borrower_id, payment_date, receipt_no, "
                "amount, installment_label, notes, payment_mode) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (borrower_id, r["payment_date"], r.get("receipt_no", ""),
                 r["amount"], r.get("installment_label", ""), r.get("notes", ""),
                 r.get("payment_mode") or ""),
            )
            ids.append(cur.lastrowid)
    return ids


def list_payments(borrower_id: int) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM payments WHERE borrower_id = ? ORDER BY payment_date, id",
            (borrower_id,),
        ).fetchall()


def add_penalty(borrower_id: int, charge_date: str, amount: float,
                receipt_no: str = "", notes: str = "") -> int:
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO penalties
               (borrower_id, charge_date, receipt_no, amount, notes)
               VALUES (?, ?, ?, ?, ?)""",
            (borrower_id, charge_date, receipt_no, amount, notes),
        )
        return cur.lastrowid


def list_penalties(borrower_id: int) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM penalties WHERE borrower_id = ? ORDER BY charge_date, id",
            (borrower_id,),
        ).fetchall()


def sum_payments(borrower_id: int) -> float:
    with connect() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE borrower_id = ?",
            (borrower_id,),
        ).fetchone()
        return float(row["total"])


def sum_penalties(borrower_id: int) -> float:
    with connect() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM penalties WHERE borrower_id = ?",
            (borrower_id,),
        ).fetchone()
        return float(row["total"])


def all_payment_sums() -> dict[int, float]:
    """Return {borrower_id: total_paid} in one query. Avoids N+1 in summaries."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT borrower_id, COALESCE(SUM(amount), 0) AS total "
            "FROM payments GROUP BY borrower_id"
        ).fetchall()
        return {r["borrower_id"]: float(r["total"]) for r in rows}


def all_penalty_sums() -> dict[int, float]:
    """Return {borrower_id: total_penalties} in one query."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT borrower_id, COALESCE(SUM(amount), 0) AS total "
            "FROM penalties GROUP BY borrower_id"
        ).fetchall()
        return {r["borrower_id"]: float(r["total"]) for r in rows}


def all_receipts_by_borrower() -> dict[int, list[dict]]:
    """Return {borrower_id: [{payment_id, receipt_no, payment_date, amount,
    payment_mode, notes}, ...]} in one query. Only non-empty receipts are
    included. Used by the Borrowers page so the receipt search box can both
    filter the table AND show payment details for the match — no extra API
    round-trip needed. Even with thousands of payments the payload stays small
    (~100 bytes per row)."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT id, borrower_id, payment_date, amount, receipt_no, "
            "       payment_mode, notes FROM payments "
            "WHERE receipt_no IS NOT NULL AND TRIM(receipt_no) != ''"
        ).fetchall()
    out: dict[int, list[dict]] = {}
    for r in rows:
        out.setdefault(r["borrower_id"], []).append({
            "payment_id": r["id"],
            "receipt_no": r["receipt_no"],
            "payment_date": r["payment_date"],
            "amount": float(r["amount"]),
            "payment_mode": r["payment_mode"] or "",
            "notes": r["notes"] or "",
        })
    return out


def all_last_payment_dates() -> dict[int, str]:
    """Return {borrower_id: max(payment_date)} in one query."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT borrower_id, MAX(payment_date) AS d "
            "FROM payments GROUP BY borrower_id"
        ).fetchall()
        return {r["borrower_id"]: r["d"] for r in rows if r["d"] is not None}


def delete_payment(payment_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM payments WHERE id = ?", (payment_id,))


def update_payment(payment_id: int, data: dict) -> None:
    _validate_cols(data, _PAYMENT_COLS, "payments")
    assignments = ", ".join(f"{k} = ?" for k in data.keys())
    with connect() as conn:
        conn.execute(
            f"UPDATE payments SET {assignments} WHERE id = ?",
            (*data.values(), payment_id),
        )


def delete_penalty(penalty_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM penalties WHERE id = ?", (penalty_id,))


def update_penalty(penalty_id: int, data: dict) -> None:
    _validate_cols(data, _PENALTY_COLS, "penalties")
    assignments = ", ".join(f"{k} = ?" for k in data.keys())
    with connect() as conn:
        conn.execute(
            f"UPDATE penalties SET {assignments} WHERE id = ?",
            (*data.values(), penalty_id),
        )


def delete_borrower(borrower_id: int) -> None:
    """Delete a borrower and all their payments/penalties/seizings (CASCADE via FK)."""
    with connect() as conn:
        conn.execute("DELETE FROM borrowers WHERE id = ?", (borrower_id,))


# ── Password protection (v1.29) ──────────────────────────────────────
# A simple delete-action guard. Stores PBKDF2-HMAC-SHA256 of the password
# in the existing app_meta table. Hash and salt are kept hex-encoded so
# they read cleanly in DB Browser. Python stdlib only.
import hashlib
import os as _os
import secrets as _secrets

_PBKDF2_ITERS = 120_000
_PBKDF2_SALT_BYTES = 16


def _meta_get(conn, key: str) -> str | None:
    conn.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)")
    row = conn.execute("SELECT value FROM app_meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def _meta_set(conn, key: str, value: str) -> None:
    conn.execute("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)")
    conn.execute(
        "INSERT INTO app_meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _meta_delete(conn, key: str) -> None:
    conn.execute("DELETE FROM app_meta WHERE key = ?", (key,))


def has_password() -> bool:
    with connect() as conn:
        return _meta_get(conn, "password_hash") is not None


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, _PBKDF2_ITERS
    ).hex()


def verify_password(password: str) -> bool:
    """Constant-time compare. Returns False if no password is set."""
    with connect() as conn:
        salt_hex = _meta_get(conn, "password_salt")
        hash_hex = _meta_get(conn, "password_hash")
    if not salt_hex or not hash_hex:
        return False
    try:
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    candidate = _hash_password(password or "", salt)
    return _secrets.compare_digest(candidate, hash_hex)


def set_password(new_password: str) -> None:
    """Set/replace the delete password. No length minimum is enforced at this
    layer — the API layer handles validation and prompts for current password
    on change."""
    salt = _os.urandom(_PBKDF2_SALT_BYTES)
    h = _hash_password(new_password, salt)
    with connect() as conn:
        _meta_set(conn, "password_salt", salt.hex())
        _meta_set(conn, "password_hash", h)


def reset_password() -> None:
    """Wipe the password rows. Used by the in-app Reset Password button."""
    with connect() as conn:
        _meta_delete(conn, "password_salt")
        _meta_delete(conn, "password_hash")


def add_seizing(borrower_id: int, seizing_date: str, amount: float,
                reason: str = "") -> int:
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO seizings
               (borrower_id, seizing_date, amount, reason)
               VALUES (?, ?, ?, ?)""",
            (borrower_id, seizing_date, amount, reason),
        )
        return cur.lastrowid


def list_seizings(borrower_id: int) -> list[sqlite3.Row]:
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM seizings WHERE borrower_id = ? ORDER BY seizing_date, id",
            (borrower_id,),
        ).fetchall()


def sum_seizings(borrower_id: int) -> float:
    with connect() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) AS total FROM seizings WHERE borrower_id = ?",
            (borrower_id,),
        ).fetchone()
        return float(row["total"])


def all_seizing_sums() -> dict[int, float]:
    """Return {borrower_id: total_seizings} in one query."""
    with connect() as conn:
        rows = conn.execute(
            "SELECT borrower_id, COALESCE(SUM(amount), 0) AS total "
            "FROM seizings GROUP BY borrower_id"
        ).fetchall()
        return {r["borrower_id"]: float(r["total"]) for r in rows}


def delete_seizing(seizing_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM seizings WHERE id = ?", (seizing_id,))


def update_seizing(seizing_id: int, data: dict) -> None:
    _validate_cols(data, _SEIZING_COLS, "seizings")
    assignments = ", ".join(f"{k} = ?" for k in data.keys())
    with connect() as conn:
        conn.execute(
            f"UPDATE seizings SET {assignments} WHERE id = ?",
            (*data.values(), seizing_id),
        )


def distinct_values(column: str) -> list[str]:
    """Return distinct non-empty values from a borrowers column, for autocomplete.
    Whitespace-only and trimmed-duplicate values are merged (e.g. 'Mumbai' and
    'Mumbai ' count as one)."""
    allowed = {"address", "guarantor_address", "vehicle_type", "showroom",
               "father_name", "guarantor_name"}
    if column not in allowed:
        return []
    with connect() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT TRIM({column}) AS v FROM borrowers "
            f"WHERE {column} IS NOT NULL AND TRIM({column}) <> '' "
            f"ORDER BY v COLLATE NOCASE"
        ).fetchall()
        return [r["v"] for r in rows]


def last_payment_date(borrower_id: int) -> str | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT MAX(payment_date) AS d FROM payments WHERE borrower_id = ?",
            (borrower_id,),
        ).fetchone()
        return row["d"] if row else None
