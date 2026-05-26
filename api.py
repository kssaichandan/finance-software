"""Python API exposed to the JavaScript frontend over local HTTP."""
import csv
import os
from datetime import date
from pathlib import Path

import db
import models


def _row(r) -> dict | None:
    if r is None:
        return None
    return {k: r[k] for k in r.keys()}


def _summary(s: models.LoanSummary) -> dict:
    return {
        "borrower_id": s.borrower_id,
        "name": s.name,
        "phone": s.phone,
        "vehicle_no": s.vehicle_no,
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
            data["loan_amount"] = float(data["loan_amount"])
            data["interest_rate"] = float(data["interest_rate"])
            data["period_months"] = int(data["period_months"])
            data["installment_amount"] = float(data["installment_amount"])
            bref = (data.get("book_ref") or "").strip()
            if bref and db.book_ref_exists(bref):
                return {"success": False,
                        "error": f"Book No / S.No '{bref}' is already used by another borrower."}
            bid = db.add_borrower(data)
            return {"success": True, "id": bid}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_borrower(self, borrower_id: int, data: dict) -> dict:
        try:
            data["loan_amount"] = float(data["loan_amount"])
            data["interest_rate"] = float(data["interest_rate"])
            data["period_months"] = int(data["period_months"])
            data["installment_amount"] = float(data["installment_amount"])
            bref = (data.get("book_ref") or "").strip()
            if bref and db.book_ref_exists(bref, exclude_id=int(borrower_id)):
                return {"success": False,
                        "error": f"Book No / S.No '{bref}' is already used by another borrower."}
            db.update_borrower(borrower_id, data)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_borrower(self, borrower_id: int) -> dict:
        try:
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
            db.update_borrower(borrower_id, {"closed": 1})
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def reopen_loan(self, borrower_id: int) -> dict:
        try:
            db.update_borrower(borrower_id, {"closed": 0})
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Payments & penalties --------------------------------------------

    def add_payment(self, data: dict) -> dict:
        try:
            receipt = (data.get("receipt_no") or "").strip()
            if receipt and db.payment_receipt_exists(receipt):
                return {"success": False,
                        "error": f"Receipt No '{receipt}' is already used in another payment."}
            pid = db.add_payment(
                borrower_id=int(data["borrower_id"]),
                payment_date=data["payment_date"],
                amount=float(data["amount"]),
                receipt_no=receipt,
                installment_label=data.get("installment_label", ""),
                notes=data.get("notes", ""),
            )
            return {"success": True, "id": pid}
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
                amount = float(p["amount"])
                if amount <= 0:
                    return {"success": False,
                            "error": f"Payment {idx}: amount must be greater than 0."}
                if not p.get("payment_date"):
                    return {"success": False,
                            "error": f"Payment {idx}: payment date is required."}
                receipt = (p.get("receipt_no") or "").strip()
                if receipt:
                    low = receipt.lower()
                    if low in seen:
                        return {"success": False,
                                "error": f"Payment {idx}: Receipt No '{receipt}' "
                                         f"is repeated within this batch."}
                    if db.payment_receipt_exists(receipt):
                        return {"success": False,
                                "error": f"Payment {idx}: Receipt No '{receipt}' "
                                         f"is already used in another payment."}
                    seen.add(low)
                cleaned.append({
                    "payment_date": p["payment_date"],
                    "amount": amount,
                    "receipt_no": receipt,
                    "installment_label": p.get("installment_label", ""),
                    "notes": p.get("notes", ""),
                })
            ids = db.add_payments_many(bid, cleaned)
            return {"success": True, "ids": ids, "count": len(ids)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def add_penalty(self, data: dict) -> dict:
        try:
            pid = db.add_penalty(
                borrower_id=int(data["borrower_id"]),
                charge_date=data["charge_date"],
                amount=float(data["amount"]),
                receipt_no=data.get("receipt_no", ""),
                notes=data.get("notes", ""),
            )
            return {"success": True, "id": pid}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_payment(self, payment_id: int) -> dict:
        try:
            db.delete_payment(int(payment_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_payment(self, payment_id: int, data: dict) -> dict:
        try:
            data["amount"] = float(data["amount"])
            receipt = (data.get("receipt_no") or "").strip()
            if receipt and db.payment_receipt_exists(receipt, exclude_id=int(payment_id)):
                return {"success": False,
                        "error": f"Receipt No '{receipt}' is already used in another payment."}
            data["receipt_no"] = receipt
            db.update_payment(int(payment_id), data)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_penalty(self, penalty_id: int) -> dict:
        try:
            db.delete_penalty(int(penalty_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_penalty(self, penalty_id: int, data: dict) -> dict:
        try:
            data["amount"] = float(data["amount"])
            db.update_penalty(int(penalty_id), data)
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # ---- Seizing money (O/D recovery costs) ------------------------------

    def add_seizing(self, data: dict) -> dict:
        try:
            sid = db.add_seizing(
                borrower_id=int(data["borrower_id"]),
                seizing_date=data["seizing_date"],
                amount=float(data["amount"]),
                reason=data.get("reason", ""),
            )
            return {"success": True, "id": sid}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def delete_seizing(self, seizing_id: int) -> dict:
        try:
            db.delete_seizing(int(seizing_id))
            return {"success": True}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def update_seizing(self, seizing_id: int, data: dict) -> dict:
        try:
            data["amount"] = float(data["amount"])
            db.update_seizing(int(seizing_id), data)
            return {"success": True}
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
        }

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
                        s.name, s.phone, b["phone2"] or "",
                        s.vehicle_no,
                        s.loan_date.strftime("%d-%m-%y"),
                        s.days_overdue, int(round(s.overdue_amount)),
                        int(round(s.remaining)),
                        int(round(seiz_sums.get(s.borrower_id, 0.0))),
                        s.last_payment_date or "",
                        b["address"] or "", b["guarantor_name"] or "",
                        b["guarantor_phone"] or "",
                        b["guarantor_phone2"] or "",
                    ])
            return {"success": True, "path": path, "count": len(overdue)}
        except OSError as e:
            return {"success": False, "error": str(e)}
