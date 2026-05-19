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


def add_borrower(data: dict) -> int:
    cols = ", ".join(data.keys())
    placeholders = ", ".join(["?"] * len(data))
    with connect() as conn:
        cur = conn.execute(
            f"INSERT INTO borrowers ({cols}) VALUES ({placeholders})",
            tuple(data.values()),
        )
        return cur.lastrowid


def update_borrower(borrower_id: int, data: dict) -> None:
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


def delete_payment(payment_id: int) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM payments WHERE id = ?", (payment_id,))


def update_payment(payment_id: int, data: dict) -> None:
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
    """Return distinct non-empty values from a borrowers column, for autocomplete."""
    allowed = {"address", "guarantor_address", "vehicle_type", "showroom",
               "father_name", "guarantor_name"}
    if column not in allowed:
        return []
    with connect() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT {column} AS v FROM borrowers "
            f"WHERE {column} IS NOT NULL AND TRIM({column}) <> '' "
            f"ORDER BY {column} COLLATE NOCASE"
        ).fetchall()
        return [r["v"] for r in rows]


def last_payment_date(borrower_id: int) -> str | None:
    with connect() as conn:
        row = conn.execute(
            "SELECT MAX(payment_date) AS d FROM payments WHERE borrower_id = ?",
            (borrower_id,),
        ).fetchone()
        return row["d"] if row else None
