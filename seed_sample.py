"""Seed the database with Paramesha's record from the photo as a demo row.

Run once: `py seed_sample.py`. Safe to re-run — it skips if the borrower already exists.
"""
import db
import models
from datetime import date


def seed():
    db.init_db()
    # Skip if Paramesha already exists
    for b in db.list_borrowers():
        if b["name"] == "Paramesha" and b["vehicle_no"] == "KA-16-EZ-4459":
            print("Sample borrower 'Paramesha' already exists. Skipping.")
            return b["id"]

    bid = db.add_borrower({
        "name": "Paramesha",
        "father_name": "Jannappa",
        "address": "Purlahalli (V), C.N. Halli (P), Challakere (T)",
        "phone": "9901285298",
        "guarantor_name": "Rajanna H",
        "guarantor_phone": "9448003678",
        "guarantor_address": "s/o Hallappa, Challakere Road, Parashurampura (V)",
        "vehicle_type": "Spl (T)",
        "vehicle_no": "KA-16-EZ-4459",
        "engine_no": "61679",
        "chassis_no": "B0656",
        "key_no": "2327",
        "serial_no": "M-104",
        "showroom": "Indian Motors",
        "loan_amount": 75000,
        "interest_rate": 24.0,
        "period_months": 12,
        "installment_amount": 7750,
        "loan_date": "2024-11-20",
        "notes": "Sample record seeded from book page 111.",
    })

    payments = [
        ("2025-01-18", "5369", 15000, "1st"),
        ("2025-03-04", "5511", 7750,  "3rd"),
        ("2025-04-26", "5680", 15500, "4-5"),
        ("2025-08-19", "6108", 14500, "6-7"),
        ("2025-10-09", "6908", 15500, "8-9"),
        ("2025-12-01", "6576", 7750,  "10th"),
    ]
    for d, r, amt, lbl in payments:
        db.add_payment(bid, d, amt, receipt_no=r, installment_label=lbl)

    # Penalties (O/D)
    db.add_penalty(bid, "2025-01-18", 500, receipt_no="12", notes="O/D entry from book")
    db.add_penalty(bid, "2025-08-19", 1000, receipt_no="49", notes="O/D entry from book")

    print(f"Seeded borrower id={bid}: Paramesha (KA-16-EZ-4459)")
    return bid


def print_summary(bid: int):
    b = db.get_borrower(bid)
    s = models.compute_summary(b, today=date(2026, 5, 19))
    print("\n--- Summary (as of 2026-05-19) ---")
    print(f"Name           : {s.name}")
    print(f"Loan Date      : {s.loan_date}")
    print(f"Principal      : Rs {s.loan_amount:,.0f}")
    print(f"Total Payable  : Rs {s.total_payable:,.0f}")
    print(f"Months Elapsed : {s.months_elapsed} (capped to {s.expected_installments} EMIs)")
    print(f"Expected Paid  : Rs {s.expected_paid_by_today:,.0f}")
    print(f"Actually Paid  : Rs {s.total_paid:,.0f}")
    print(f"Remaining      : Rs {s.remaining:,.0f}")
    print(f"Overdue Amount : Rs {s.overdue_amount:,.0f}")
    print(f"Days Overdue   : {s.days_overdue}")
    print(f"Penalties Paid : Rs {s.total_penalties:,.0f}")
    print(f"Status         : {s.status_label}")


if __name__ == "__main__":
    bid = seed()
    print_summary(bid)
