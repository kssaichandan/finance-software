"""Seed one demo borrower so the app has something to show on first run.

Run once: `py seed_sample.py`. Safe to re-run — skips if already seeded.
"""
import db
import models
from datetime import date


def seed():
    db.init_db()
    for b in db.list_borrowers():
        if b["name"] == "Demo Borrower" and b["vehicle_no"] == "XX-00-AB-0001":
            print("Demo borrower already exists. Skipping.")
            return b["id"]

    bid = db.add_borrower({
        "name": "Demo Borrower",
        "father_name": "Demo Father",
        "address": "123, Sample Street, Sample Town",
        "phone": "9000000001",
        "guarantor_name": "Demo Guarantor",
        "guarantor_phone": "9000000002",
        "guarantor_address": "456, Sample Street, Sample Town",
        "vehicle_type": "Motorcycle",
        "vehicle_no": "XX-00-AB-0001",
        "engine_no": "ENG00001",
        "chassis_no": "CHS00001",
        "key_no": "KEY001",
        "serial_no": "SRL-001",
        "showroom": "Demo Motors",
        "loan_amount": 75000,
        "interest_rate": 24.0,
        "period_months": 12,
        "installment_amount": 7750,
        "loan_date": "2024-11-20",
        "notes": "Demo record — replace with real data.",
    })

    payments = [
        ("2025-01-18", "R001", 15000, "1st"),
        ("2025-03-04", "R002",  7750, "3rd"),
        ("2025-04-26", "R003", 15500, "4-5"),
        ("2025-08-19", "R004", 14500, "6-7"),
        ("2025-10-09", "R005", 15500, "8-9"),
        ("2025-12-01", "R006",  7750, "10th"),
    ]
    for d, r, amt, lbl in payments:
        db.add_payment(bid, d, amt, receipt_no=r, installment_label=lbl)

    db.add_penalty(bid, "2025-01-18", 500,  receipt_no="P001", notes="Demo penalty")
    db.add_penalty(bid, "2025-08-19", 1000, receipt_no="P002", notes="Demo penalty")

    print(f"Seeded demo borrower id={bid}")
    return bid


def print_summary(bid: int):
    b = db.get_borrower(bid)
    s = models.compute_summary(b, today=date.today())
    print("\n--- Summary ---")
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
