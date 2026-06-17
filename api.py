"""Python API exposed to the JavaScript frontend over local HTTP."""
import calendar
import csv
import math
import os
import sqlite3
from datetime import date, datetime
from pathlib import Path

import db
import models
import autobackup


# ── Shared input validation ──────────────────────────────────────────
def _valid_iso_date(s) -> bool:
    """True only for a real calendar date in 'YYYY-MM-DD' form. Rejects
    '2026-02-31' and friends, which the frontend regex can otherwise accept."""
    try:
        datetime.strptime(str(s), "%Y-%m-%d")
        return True
    except (ValueError, TypeError):
        return False


def _clean_amount(v, field: str = "Amount", allow_zero: bool = False) -> float:
    """Coerce to a finite, positive (or non-negative) float. Rejects NaN/Inf,
    blank, and negatives so they can never reach the DB and poison totals."""
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be a number.")
    if not math.isfinite(x):
        raise ValueError(f"{field} must be a real number.")
    if x < 0 or (x == 0 and not allow_zero):
        raise ValueError(f"{field} must be greater than 0.")
    return x


def _csv_safe(v) -> str:
    """Neutralise CSV / spreadsheet formula injection. A cell that opens with
    = + - @ (or a control char) is prefixed with a quote so Excel/LibreOffice
    treat it as text, not a formula."""
    s = "" if v is None else str(v)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def _validate_borrower_core(data: dict):
    """Validate + coerce the numeric/date core of a borrower payload in place.
    Returns an error message string, or None if everything is OK."""
    if not _valid_iso_date(data.get("loan_date")):
        return "Loan Date is not a real calendar date."
    try:
        data["loan_amount"] = _clean_amount(data["loan_amount"], "Principal amount")
        data["installment_amount"] = _clean_amount(data["installment_amount"], "Installment amount")
    except ValueError as e:
        return str(e)
    try:
        rate = float(data["interest_rate"])
    except (TypeError, ValueError, KeyError):
        return "Interest rate must be a number."
    if not math.isfinite(rate) or rate < 0:
        return "Interest rate must be 0 or more."
    data["interest_rate"] = rate
    try:
        period = int(data["period_months"])
    except (TypeError, ValueError, KeyError):
        return "Period must be a whole number of months."
    if period < 1:
        return "Period must be at least 1 month."
    data["period_months"] = period
    return None


def _delete_guard(password):
    """Server-side enforcement of the delete password. Returns an error dict if
    a password is set and the supplied one is missing/wrong, else None. Without
    this, the password gate would be browser-only and trivially bypassable."""
    if db.has_password() and not db.verify_password(password or ""):
        return {"success": False, "error": "Wrong delete password."}
    return None


def _month_label(ym: str) -> str:
    """'2026-06' -> 'Jun 2026'."""
    try:
        y, m = int(ym[:4]), int(ym[5:7])
        return f"{calendar.month_abbr[m]} {y}"
    except (ValueError, IndexError):
        return ym


def _recent_months(today: date, n: int) -> list[str]:
    """The last n 'YYYY-MM' keys ending with today's month, oldest first."""
    out, yy, mm = [], today.year, today.month
    for _ in range(n):
        out.append(f"{yy:04d}-{mm:02d}")
        mm -= 1
        if mm == 0:
            mm, yy = 12, yy - 1
    out.reverse()
    return out


def _loan_interest_ratios(summaries) -> dict:
    """borrower_id -> interest/payable. Flat interest is baked into payable, so
    this fraction of each collected rupee is the interest (profit) portion."""
    ratio = {}
    for s in summaries:
        interest_b = max(0.0, s.total_payable - s.loan_amount)
        ratio[s.borrower_id] = (interest_b / s.total_payable) if s.total_payable > 0 else 0.0
    return ratio


def _month_breakdown(ym: str, ratio: dict, payment_rows) -> dict:
    """Earnings for a single 'YYYY-MM': collection split into interest/principal,
    plus by-payment-mode and by-showroom breakdowns for that month."""
    collected = interest = 0.0
    count = 0
    by_mode: dict[str, float] = {}
    by_sh: dict[str, float] = {}
    for r in payment_rows:
        if (r["d"] or "")[:7] != ym:
            continue
        amt = float(r["amount"])
        collected += amt
        interest += amt * ratio.get(r["bid"], 0.0)
        count += 1
        mode = (r["mode"] or "").strip() or "Unspecified"
        by_mode[mode] = by_mode.get(mode, 0.0) + amt
        sh = (r["showroom"] or "").strip() or "(No showroom)"
        by_sh[sh] = by_sh.get(sh, 0.0) + amt
    return {
        "month": ym,
        "label": _month_label(ym),
        "collected": collected,
        "interest": interest,
        "principal": max(0.0, collected - interest),
        "penalties": db.sum_in_month("penalties", "charge_date", ym),
        "seizings": db.sum_in_month("seizings", "seizing_date", ym),
        "payments_count": count,
        "by_mode": sorted(({"mode": k, "amount": v} for k, v in by_mode.items()),
                          key=lambda x: -x["amount"]),
        "by_showroom": sorted(({"showroom": k, "amount": v} for k, v in by_sh.items()),
                              key=lambda x: -x["amount"]),
    }


def _row(r) -> dict | None:
    if r is None:
        return None
    return {k: r[k] for k in r.keys()}


def _receipt_conflict_msg(typed_receipt: str, conflict: dict) -> str:
    """Format a helpful duplicate-receipt error pointing at the existing
    payment's borrower / amount / date so the user knows which record to check."""
    from datetime import datetime as _dt
    try:
        pd = _dt.strptime(conflict["payment_date"], "%Y-%m-%d").strftime("%d-%m-%y")
    except Exception:
        pd = conflict["payment_date"]
    name = conflict["borrower_name"] or "(unknown)"
    book = f" book {conflict['book_ref']}" if conflict.get("book_ref") else ""
    return (f"Receipt No '{typed_receipt}' is already used in a payment for "
            f"{name}{book} (₹{int(round(conflict['amount']))} on {pd}).")


def _summary(s: models.LoanSummary) -> dict:
    return {
        "borrower_id": s.borrower_id,
        "name": s.name,
        "phone": s.phone,
        "vehicle_no": s.vehicle_no,
        "father_name": s.father_name,
        "guarantor_name": s.guarantor_name,
        "address": s.address,
        "showroom": s.showroom,
        "vehicle_type": s.vehicle_type,
        "loan_date": s.loan_date.strftime("%Y-%m-%d"),
        "loan_amount": s.loan_amount,
        "interest_rate": s.interest_rate,
        "period_months": s.period_months,
        "installment_amount": s.installment_amount,
        "total_payable": s.total_payable,
        "total_paid": s.total_paid,
        "total_penalties": s.total_penalties,
        "total_seizings": s.total_seizings,
        "remaining": s.remaining,
        "expected_paid_by_today": s.expected_paid_by_today,
        "overdue_amount": s.overdue_amount,
        "days_overdue": s.days_overdue,
        "months_elapsed": s.months_elapsed,
        "expected_installments": s.expected_installments,
        "last_payment_date": s.last_payment_date,
        "closed": s.closed,
        "status_label": s.status_label,
        "is_overdue": s.is_overdue,
        "is_advance": s.is_advance,
        "book_ref": s.book_ref,
        "receipts": s.receipts,
    }


class API:
    def __init__(self):
        pass

    # ---- Dashboard -------------------------------------------------------

    def get_dashboard_data(self) -> dict:
        summaries = models.all_summaries()
        overdue = sorted(
            [s for s in summaries if s.is_overdue],
            key=lambda s: -s.overdue_amount,
        )
        total_overdue_amount = sum(s.overdue_amount for s in overdue)
        total_active = sum(1 for s in summaries if not s.closed)
        total_loans = len(summaries)
        return {
            "overdue": [_summary(s) for s in overdue],
            "total_overdue_count": len(overdue),
            "total_overdue_amount": total_overdue_amount,
            "total_active": total_active,
            "total_loans": total_loans,
            "today": date.today().strftime("%Y-%m-%d"),
        }

    # ---- All Borrowers ---------------------------------------------------

    def get_all_borrowers(self) -> list:
        summaries = models.all_summaries()

        def sort_key(s):
            if s.closed:
                return (3, 0)
            if s.is_overdue:
                return (0, -s.overdue_amount)
            if s.is_advance:
                return (2, 0)
            return (1, 0)

        summaries.sort(key=sort_key)
        return [_summary(s) for s in summaries]

    # ---- Borrower detail -------------------------------------------------

    def get_borrower_detail(self, borrower_id: int) -> dict | None:
        b = db.get_borrower(borrower_id)
        if not b:
            return None
        s = models.compute_summary(b)
        payments = [_row(p) for p in db.list_payments(borrower_id)]
        penalties = [_row(p) for p in db.list_penalties(borrower_id)]
        seizings = [_row(p) for p in db.list_seizings(borrower_id)]
        return {
            "borrower": _row(b),
            "summary": _summary(s),
            "payments": payments,
            "penalties": penalties,
            "seizings": seizings,
        }

    # ---- Add / edit borrower ---------------------------------------------

    def add_borrower(self, data: dict) -> dict:
        try:
            err = _validate_borrower_core(data)
            if err:
                return {"success": False, "error": err}
            bref = (data.get("book_ref") or "").strip()
            if bref:
                conflict = db.book_ref_conflict(bref)
                if conflict:
                    return {"success": False, "conflict_borrower_id": conflict["id"],
                            "error": (f"Book No / S.No '{bref}' is already used by "
                                      f"{conflict['name']} (book {conflict['book_ref']}).")}
            bid = db.add_borrower(data)
            return {"success": True, "id": bid}
        except sqlite3.IntegrityError:
            return {"success": False,
                    "error": "Book No / S.No is already in use by another borrower."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_borrower(self, borrower_id: int, data: dict) -> dict:
        try:
            err = _validate_borrower_core(data)
            if err:
                return {"success": False, "error": err}
            bref = (data.get("book_ref") or "").strip()
            if bref:
                conflict = db.book_ref_conflict(bref, exclude_id=int(borrower_id))
                if conflict:
                    return {"success": False, "conflict_borrower_id": conflict["id"],
                            "error": (f"Book No / S.No '{bref}' is already used by "
                                      f"{conflict['name']} (book {conflict['book_ref']}).")}
            db.update_borrower(borrower_id, data)
            return {"success": True}
        except sqlite3.IntegrityError:
            return {"success": False,
                    "error": "Book No / S.No is already in use by another borrower."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_borrower(self, borrower_id: int, password: str = "") -> dict:
        try:
            guard = _delete_guard(password)
            if guard:
                return guard
            db.delete_borrower(int(borrower_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_suggestions(self) -> dict:
        """Return distinct previously-entered values per field, for autocomplete."""
        return {
            "address":            db.distinct_values("address"),
            "guarantor_address":  db.distinct_values("guarantor_address"),
            "vehicle_type":       db.distinct_values("vehicle_type"),
            "showroom":           db.distinct_values("showroom"),
            "father_name":        db.distinct_values("father_name"),
            "guarantor_name":     db.distinct_values("guarantor_name"),
        }

    def close_loan(self, borrower_id: int) -> dict:
        try:
            # Clear the reopened override so it can auto-close normally again.
            db.update_borrower(borrower_id, {"closed": 1, "reopened": 0})
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def reopen_loan(self, borrower_id: int) -> dict:
        try:
            # Set reopened so the fully-paid auto-close rule won't immediately
            # re-close it. Without this, re-open is a silent no-op on paid loans.
            db.update_borrower(borrower_id, {"closed": 0, "reopened": 1})
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Payments & penalties --------------------------------------------

    def add_payment(self, data: dict) -> dict:
        try:
            if not _valid_iso_date(data.get("payment_date")):
                return {"success": False, "error": "Payment date is not a real calendar date."}
            amount = _clean_amount(data.get("amount"), "Payment amount")
            receipt = (data.get("receipt_no") or "").strip()
            if receipt:
                conflict = db.payment_receipt_conflict(receipt)
                if conflict:
                    return {"success": False,
                            "conflict_borrower_id": conflict["borrower_id"],
                            "conflict_payment_id": conflict["id"],
                            "error": _receipt_conflict_msg(receipt, conflict)}
            pid = db.add_payment(
                borrower_id=int(data["borrower_id"]),
                payment_date=data["payment_date"],
                amount=amount,
                receipt_no=receipt,
                installment_label=data.get("installment_label", ""),
                notes=data.get("notes", ""),
                payment_mode=data.get("payment_mode", ""),
                showroom=data.get("showroom", ""),
            )
            return {"success": True, "id": pid}
        except sqlite3.IntegrityError:
            return {"success": False, "error": "That Receipt No is already used by another payment."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_payments_batch(self, borrower_id: int, payments: list) -> dict:
        """Add several payments at once. Validates ALL entries first; if any
        check fails nothing is inserted. The DB insert itself is one
        transaction, so it is also all-or-nothing."""
        try:
            bid = int(borrower_id)
            if not payments:
                return {"success": False, "error": "No payments to add."}
            seen: set = set()
            cleaned = []
            for idx, p in enumerate(payments, 1):
                try:
                    amount = _clean_amount(p.get("amount"), f"Payment {idx} amount")
                except ValueError as e:
                    return {"success": False, "error": str(e)}
                if not _valid_iso_date(p.get("payment_date")):
                    return {"success": False,
                            "error": f"Payment {idx}: date is not a real calendar date."}
                receipt = (p.get("receipt_no") or "").strip()
                if receipt:
                    low = receipt.lower()
                    if low in seen:
                        return {"success": False,
                                "error": f"Payment {idx}: Receipt No '{receipt}' "
                                         f"is repeated within this batch."}
                    conflict = db.payment_receipt_conflict(receipt)
                    if conflict:
                        return {"success": False,
                                "conflict_borrower_id": conflict["borrower_id"],
                                "conflict_payment_id": conflict["id"],
                                "error": f"Payment {idx}: " +
                                         _receipt_conflict_msg(receipt, conflict)}
                    seen.add(low)
                cleaned.append({
                    "payment_date": p["payment_date"],
                    "amount": amount,
                    "receipt_no": receipt,
                    "installment_label": p.get("installment_label", ""),
                    "notes": p.get("notes", ""),
                    "payment_mode": p.get("payment_mode", ""),
                    "showroom": p.get("showroom", ""),
                })
            ids = db.add_payments_many(bid, cleaned)
            return {"success": True, "ids": ids, "count": len(ids)}
        except sqlite3.IntegrityError:
            return {"success": False, "error": "A Receipt No in this batch is already used by another payment."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_penalty(self, data: dict) -> dict:
        try:
            if not _valid_iso_date(data.get("charge_date")):
                return {"success": False, "error": "Charge date is not a real calendar date."}
            amount = _clean_amount(data.get("amount"), "Penalty amount")
            pid = db.add_penalty(
                borrower_id=int(data["borrower_id"]),
                charge_date=data["charge_date"],
                amount=amount,
                receipt_no=data.get("receipt_no", ""),
                notes=data.get("notes", ""),
            )
            return {"success": True, "id": pid}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_payment(self, payment_id: int, password: str = "") -> dict:
        try:
            guard = _delete_guard(password)
            if guard:
                return guard
            db.delete_payment(int(payment_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_payment(self, payment_id: int, data: dict) -> dict:
        try:
            if "payment_date" in data and not _valid_iso_date(data.get("payment_date")):
                return {"success": False, "error": "Payment date is not a real calendar date."}
            data["amount"] = _clean_amount(data.get("amount"), "Payment amount")
            receipt = (data.get("receipt_no") or "").strip()
            if receipt:
                conflict = db.payment_receipt_conflict(receipt, exclude_id=int(payment_id))
                if conflict:
                    return {"success": False,
                            "conflict_borrower_id": conflict["borrower_id"],
                            "conflict_payment_id": conflict["id"],
                            "error": _receipt_conflict_msg(receipt, conflict)}
            data["receipt_no"] = receipt
            db.update_payment(int(payment_id), data)
            return {"success": True}
        except sqlite3.IntegrityError:
            return {"success": False, "error": "That Receipt No is already used by another payment."}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_penalty(self, penalty_id: int, password: str = "") -> dict:
        try:
            guard = _delete_guard(password)
            if guard:
                return guard
            db.delete_penalty(int(penalty_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_penalty(self, penalty_id: int, data: dict) -> dict:
        try:
            if "charge_date" in data and not _valid_iso_date(data.get("charge_date")):
                return {"success": False, "error": "Charge date is not a real calendar date."}
            data["amount"] = _clean_amount(data.get("amount"), "Penalty amount")
            db.update_penalty(int(penalty_id), data)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Seizing money (O/D recovery costs) ------------------------------

    def add_seizing(self, data: dict) -> dict:
        try:
            if not _valid_iso_date(data.get("seizing_date")):
                return {"success": False, "error": "Date is not a real calendar date."}
            amount = _clean_amount(data.get("amount"), "Seizing amount")
            sid = db.add_seizing(
                borrower_id=int(data["borrower_id"]),
                seizing_date=data["seizing_date"],
                amount=amount,
                reason=data.get("reason", ""),
            )
            return {"success": True, "id": sid}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_seizing(self, seizing_id: int, password: str = "") -> dict:
        try:
            guard = _delete_guard(password)
            if guard:
                return guard
            db.delete_seizing(int(seizing_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_seizing(self, seizing_id: int, data: dict) -> dict:
        try:
            if "seizing_date" in data and not _valid_iso_date(data.get("seizing_date")):
                return {"success": False, "error": "Date is not a real calendar date."}
            data["amount"] = _clean_amount(data.get("amount"), "Seizing amount")
            db.update_seizing(int(seizing_id), data)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Password protection for deletes (v1.29) -------------------------

    def has_password(self) -> dict:
        return {"has_password": db.has_password()}

    def verify_password(self, password: str) -> dict:
        return {"success": db.verify_password(password or "")}

    def set_password(self, new_password: str, current_password: str = "") -> dict:
        """Initial set OR change. If a password already exists, current_password
        must match. New password must be at least 4 characters."""
        try:
            new_password = (new_password or "").strip()
            if len(new_password) < 4:
                return {"success": False,
                        "error": "Password must be at least 4 characters."}
            if db.has_password():
                if not db.verify_password(current_password or ""):
                    return {"success": False,
                            "error": "Current password is wrong."}
            db.set_password(new_password)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def reset_password(self) -> dict:
        """Remove the password entirely. The 'forgot password' escape hatch."""
        try:
            db.reset_password()
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- App settings (business name, text size) -------------------------

    def get_settings(self) -> dict:
        return {
            "business_name": db.get_setting("business_name", ""),
            "text_size": db.get_setting("text_size", "normal"),
            "autobackup_enabled": db.get_setting("autobackup_enabled", "0") == "1",
            "autobackup_dir": db.get_setting("autobackup_dir", ""),
        }

    def set_setting(self, key: str, value: str) -> dict:
        allowed = {"business_name", "text_size", "autobackup_enabled", "autobackup_dir"}
        if key not in allowed:
            return {"success": False, "error": "Unknown setting."}
        try:
            maxlen = 400 if key == "autobackup_dir" else 80
            db.set_setting(key, (value or "")[:maxlen])
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Auto-backup to a cloud-synced folder ----------------------------

    def detect_sync_folders(self) -> dict:
        """Find likely OneDrive / Google Drive folders so the user can pick one
        with a click instead of typing a path."""
        home = os.path.expanduser("~")
        found, seen = [], set()

        def add(label, path):
            if path and os.path.isdir(path) and path.lower() not in seen:
                seen.add(path.lower())
                found.append({"label": label, "path": path})

        add("OneDrive", os.path.join(home, "OneDrive"))
        add("Google Drive", os.path.join(home, "Google Drive"))
        for letter in "GHIJKL":
            add(f"Google Drive ({letter}:)", f"{letter}:\\My Drive")
        try:
            for name in os.listdir(home):
                if name.lower().startswith("onedrive -"):
                    add(name, os.path.join(home, name))
        except OSError:
            pass
        return {"folders": found, "home": home}

    def run_autobackup_now(self) -> dict:
        st = autobackup.backup_now()
        if st.get("ok"):
            return {"success": True, "path": st.get("path", "")}
        return {"success": False, "error": st.get("error", "unknown")}

    def backup_to_folder(self, folder: str) -> dict:
        """Manual one-off backup to a folder, without changing saved settings."""
        st = autobackup.backup_to(folder or "")
        if st.get("ok"):
            return {"success": True, "path": st.get("path", "")}
        return {"success": False, "error": st.get("error", "unknown")}

    def autobackup_status(self) -> dict:
        return autobackup.status()

    # ---- Backup (safe hot copy of the whole database) --------------------

    def backup_db(self) -> dict:
        """Write a consistent copy of finance.db to the Downloads folder using
        SQLite's online backup API (safe even while the app is running)."""
        from datetime import datetime as _dt
        try:
            stamp = _dt.now().strftime("%Y%m%d_%H%M%S")
            downloads = Path(os.path.expanduser("~")) / "Downloads"
            downloads.mkdir(parents=True, exist_ok=True)
            dest = str(downloads / f"finance_backup_{stamp}.db")
            src = db.connect()
            try:
                dst = sqlite3.connect(dest)
                try:
                    with dst:
                        src.backup(dst)
                finally:
                    dst.close()
            finally:
                src.close()
            return {"success": True, "path": dest}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Bulk fetch for PDF export ---------------------------------------

    def get_borrowers_full(self, ids: list) -> dict:
        """Return borrower + summary + payments + penalties + seizings for
        each requested ID. Used by the PDF export so the browser doesn't have
        to make N round trips to build the print document."""
        try:
            wanted = [int(i) for i in ids]
            result = []
            for bid in wanted:
                b = db.get_borrower(bid)
                if not b:
                    continue
                s = models.compute_summary(b)
                result.append({
                    "borrower": _row(b),
                    "summary": _summary(s),
                    "payments": [_row(p) for p in db.list_payments(bid)],
                    "penalties": [_row(p) for p in db.list_penalties(bid)],
                    "seizings": [_row(p) for p in db.list_seizings(bid)],
                })
            return {"success": True, "data": result}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Due soon --------------------------------------------------------

    def get_due_soon(self, days: int = 7) -> list:
        items = models.due_soon(days=days)
        return [
            {**_summary(item["summary"]),
             "next_due_date": item["next_due_date"],
             "days_until": item["days_until"]}
            for item in items
        ]

    # ---- Payment schedule ------------------------------------------------

    def get_payment_schedule(self, borrower_id: int) -> list:
        b = db.get_borrower(borrower_id)
        if not b:
            return []
        return models.payment_schedule(b)

    # ---- Portfolio summary -----------------------------------------------

    def get_portfolio_summary(self) -> dict:
        rows = db.list_borrowers(include_closed=True)
        total_loans = len(rows)
        active = sum(1 for r in rows if not r["closed"])

        total_principal = sum(float(r["loan_amount"]) for r in rows)
        total_payable = sum(
            float(r["loan_amount"]) *
            (1 + (float(r["interest_rate"]) * float(r["period_months"]) / 12.0) / 100.0)
            for r in rows
        )

        with db.connect() as conn:
            total_collected = float(
                conn.execute("SELECT COALESCE(SUM(amount),0) FROM payments").fetchone()[0]
            )
            total_penalties = float(
                conn.execute("SELECT COALESCE(SUM(amount),0) FROM penalties").fetchone()[0]
            )
            total_seizings = float(
                conn.execute("SELECT COALESCE(SUM(amount),0) FROM seizings").fetchone()[0]
            )

        summaries = models.all_summaries()
        overdue_count = sum(1 for s in summaries if s.is_overdue)
        total_overdue_amt = sum(s.overdue_amount for s in summaries if s.is_overdue)

        # ── Time-based analytics ─────────────────────────────────────
        # Flat interest is baked into total_payable. We split every collected
        # rupee into interest vs principal using each loan's own ratio
        # (interest / payable), so "interest earned" tracks real collections.
        today = date.today()
        this_ym = today.strftime("%Y-%m")
        ratio = _loan_interest_ratios(summaries)
        pay_rows = db.payment_rows_for_analytics()

        # 6-month trend for the chart.
        months = _recent_months(today, 6)
        month_collected = {k: 0.0 for k in months}
        month_interest = {k: 0.0 for k in months}
        for r in pay_rows:
            ym = (r["d"] or "")[:7]
            if ym in month_collected:
                amt = float(r["amount"])
                month_collected[ym] += amt
                month_interest[ym] += amt * ratio.get(r["bid"], 0.0)

        # Per-showroom all-time aggregates from the loan summaries.
        sh_acc: dict[str, dict] = {}
        for s in summaries:
            sh = (s.showroom or "").strip() or "(No showroom)"
            a = sh_acc.setdefault(sh, {"showroom": sh, "loans": 0, "principal": 0.0,
                                       "collected": 0.0, "outstanding": 0.0})
            a["loans"] += 1
            a["principal"] += s.loan_amount
            a["collected"] += s.total_paid
            a["outstanding"] += s.remaining
        by_showroom = sorted(sh_acc.values(), key=lambda x: -x["collected"])

        total_interest_expected = max(0.0, total_payable - total_principal)
        total_interest_earned = sum(
            s.total_paid * ratio.get(s.borrower_id, 0.0) for s in summaries
        )

        # ── Book-level analytics for the Portfolio page ──────────────
        # All derived from the `summaries` already loaded above — no extra
        # DB round-trips.

        # Loan-health composition (counts + still-owed per status).
        status_breakdown = {
            "overdue": {"label": "Overdue", "count": 0, "outstanding": 0.0},
            "on_time": {"label": "On time", "count": 0, "outstanding": 0.0},
            "advance": {"label": "Advance", "count": 0, "outstanding": 0.0},
            "closed":  {"label": "Closed",  "count": 0, "outstanding": 0.0},
        }
        for s in summaries:
            if s.closed:
                status_breakdown["closed"]["count"] += 1
            elif s.is_overdue:
                status_breakdown["overdue"]["count"] += 1
                status_breakdown["overdue"]["outstanding"] += s.remaining
            elif s.is_advance:
                status_breakdown["advance"]["count"] += 1
                status_breakdown["advance"]["outstanding"] += s.remaining
            else:
                status_breakdown["on_time"]["count"] += 1
                status_breakdown["on_time"]["outstanding"] += s.remaining

        # Cash-flow forecast — the next unpaid installment for each on-track loan.
        upcoming = []
        for s in summaries:
            if s.closed or s.is_overdue:
                continue
            next_no = s.expected_installments + 1
            if next_no > s.period_months:
                continue
            next_due = models._add_months(s.loan_date, next_no)
            days_until = (next_due - today).days
            if days_until < 0:
                continue
            upcoming.append({
                "borrower_id": s.borrower_id,
                "name": s.name,
                "phone": s.phone,
                "due_date": models.fmt_date(next_due),
                "days_until": days_until,
                "amount": s.installment_amount,
            })
        upcoming.sort(key=lambda x: x["days_until"])
        upcoming_block = {
            "due_7": sum(u["amount"] for u in upcoming if u["days_until"] <= 7),
            "due_7_count": sum(1 for u in upcoming if u["days_until"] <= 7),
            "due_30": sum(u["amount"] for u in upcoming if u["days_until"] <= 30),
            "due_30_count": sum(1 for u in upcoming if u["days_until"] <= 30),
            "list": upcoming[:8],
        }

        # Averages / KPIs across the whole book.
        avg_loan = (total_principal / total_loans) if total_loans else 0.0
        avg_rate = (sum(float(r["interest_rate"]) for r in rows) / total_loans) if total_loans else 0.0
        avg_period = (sum(float(r["period_months"]) for r in rows) / total_loans) if total_loans else 0.0
        biggest_loan = max((float(r["loan_amount"]) for r in rows), default=0.0)

        # Months the user can pick in the selector — every month that has a
        # payment, plus the current month (so it is always selectable), newest
        # first.
        available = db.distinct_payment_months()
        if this_ym not in available:
            available = [this_ym] + available

        return {
            "total_loans": total_loans,
            "active_loans": active,
            "closed_loans": total_loans - active,
            "total_principal": total_principal,
            "total_payable": total_payable,
            "total_collected": total_collected,
            "total_outstanding": max(0.0, total_payable - total_collected),
            "total_penalties": total_penalties,
            "total_seizings": total_seizings,
            "overdue_count": overdue_count,
            "total_overdue_amount": total_overdue_amt,
            "total_interest_expected": total_interest_expected,
            "total_interest_earned": total_interest_earned,
            "status_breakdown": status_breakdown,
            "upcoming": upcoming_block,
            "avg_loan": avg_loan,
            "avg_rate": avg_rate,
            "avg_period": avg_period,
            "biggest_loan": biggest_loan,
            "this_month": _month_breakdown(this_ym, ratio, pay_rows),
            "available_months": [{"month": m, "label": _month_label(m)} for m in available],
            "monthly": [
                {"month": k, "label": _month_label(k),
                 "collected": month_collected[k], "interest": month_interest[k]}
                for k in months
            ],
            "by_showroom": by_showroom,
        }

    def get_month_summary(self, ym: str) -> dict:
        """Earnings breakdown for a single 'YYYY-MM' — drives the Portfolio
        month selector. Same shape as get_portfolio_summary()['this_month']."""
        ym = (ym or "")[:7]
        summaries = models.all_summaries()
        ratio = _loan_interest_ratios(summaries)
        return _month_breakdown(ym, ratio, db.payment_rows_for_analytics())

    # ---- CSV Export ------------------------------------------------------

    def export_csv(self) -> dict:
        # Timestamp suffix so two exports on the same day do not overwrite.
        from datetime import datetime as _dt
        stamp = _dt.now().strftime("%Y%m%d_%H%M%S")
        downloads = Path(os.path.expanduser("~")) / "Downloads"
        downloads.mkdir(parents=True, exist_ok=True)
        path = str(downloads / f"overdue_{stamp}.csv")
        try:
            summaries = models.all_summaries()
            overdue = [s for s in summaries if s.is_overdue]
            seiz_sums = db.all_seizing_sums()
            with open(path, "w", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f)
                w.writerow([
                    "Name", "Phone", "Alt Phone", "Vehicle No", "Loan Date",
                    "Days Overdue", "Overdue Amount (Rs)",
                    "Remaining (Rs)", "Seizing Money Total (Rs)", "Last Payment",
                    "Address", "Guarantor", "Guarantor Phone", "Guarantor Alt Phone",
                ])
                for s in overdue:
                    b = db.get_borrower(s.borrower_id)
                    w.writerow([
                        _csv_safe(s.name), _csv_safe(s.phone), _csv_safe(b["phone2"] or ""),
                        _csv_safe(s.vehicle_no),
                        s.loan_date.strftime("%d-%m-%y"),
                        s.days_overdue, int(round(s.overdue_amount)),
                        int(round(s.remaining)),
                        int(round(seiz_sums.get(s.borrower_id, 0.0))),
                        s.last_payment_date or "",
                        _csv_safe(b["address"] or ""), _csv_safe(b["guarantor_name"] or ""),
                        _csv_safe(b["guarantor_phone"] or ""),
                        _csv_safe(b["guarantor_phone2"] or ""),
                    ])
            return {"success": True, "path": path, "count": len(overdue)}
        except OSError as e:
            return {"success": False, "error": str(e)}
