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
    "payment_date", "receipt_no", "amount", "installment_label", "notes",
})
_PENALTY_COLS = frozenset({
    "charge_date", "receipt_no", "amount", "notes",
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

CREATE INDEX IF NOT EXISTS idx_payments_borrower ON payments(borrower_id);
CREATE INDEX IF NOT EXISTS idx_penalties_borrower ON penalties(borrower_id);
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


def book_ref_exists(book_ref: str, exclude_id: int | None = None) -> bool:
    """True if any OTHER borrower already has this non-empty book_ref."""
    bref = (book_ref or "").strip()
    if not bref:
        return False
    sql = "SELECT 1 FROM borrowers WHERE TRIM(book_ref) = ?"
    params: list = [bref]
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    with connect() as conn:
        return conn.execute(sql, params).fetchone() is not None


def payment_receipt_exists(receipt_no: str, exclude_id: int | None = None) -> bool:
    """True if any OTHER payment already has this non-empty receipt_no."""
    r = (receipt_no or "").strip()
    if not r:
        return False
    sql = "SELECT 1 FROM payments WHERE TRIM(receipt_no) = ?"
    params: list = [r]
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    with connect() as conn:
        return conn.execute(sql, params).fetchone() is not None


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
                notes: str = "") -> int:
    with connect() as conn:
        cur = conn.execute(
            """INSERT INTO payments
               (borrower_id, payment_date, receipt_no, amount, installment_label, notes)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (borrower_id, payment_date, receipt_no, amount, installment_label, notes),
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
                "amount, installment_label, notes) VALUES (?, ?, ?, ?, ?, ?)",
                (borrower_id, r["payment_date"], r.get("receipt_no", ""),
                 r["amount"], r.get("installment_label", ""), r.get("notes", "")),
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
    """Delete a borrower and all their payments/penalties (CASCADE via FK)."""
    with connect() as conn:
        conn.execute("DELETE FROM borrowers WHERE id = ?", (borrower_id,))


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
