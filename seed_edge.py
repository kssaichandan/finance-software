"""Edge-case seed data — run once to add ~20 test borrowers."""
import db
from datetime import date, timedelta

TODAY = date(2026, 5, 19)


def emi(p, n):
    return round(p * 1.24 / n)


def add_pays(bid, loan_date_str, inst, count):
    """Add `count` payments on each monthly due date."""
    from models import _add_months, parse_date
    ld = parse_date(loan_date_str)
    for i in range(1, count + 1):
        due = _add_months(ld, i)
        if due > TODAY:
            break
        db.add_payment(bid, due.strftime("%Y-%m-%d"), inst)


def seed():
    existing = db.list_borrowers(include_closed=True)
    if len(existing) >= 60:
        print("Already seeded edge cases. Delete finance.db to reseed.")
        return

    cases = []

    # ── Recently overdue (1-10 days) — fills dashboard "Missed Last 10 Days" ──
    # days_overdue = days since FIRST missed installment
    # loan_date day=18 → 12th installment due 2026-05-18 (1 day ago)
    cases.append(dict(
        name="Kiranna Swamy", father="Basavaiah", address="Hiriyur (T), Chitradurga (D)",
        phone="9900110011", gname="Mallesh Naik", gphone="9900220022",
        vtype="Bike", vno="KA-16-HB-1818", loan=40000, period=18,
        loan_date="2025-05-18", pay=11,
        label="1 DAY OVERDUE", book_ref="Edge/M-301",
    ))
    # day=17 → 12th due 2026-05-17 (2 days ago)
    cases.append(dict(
        name="Yellamma Naik", father="Thippeswamy", address="Molakalmuru (T), Chitradurga (D)",
        phone="9900330033", gname="Rangappa", gphone="9900440044",
        vtype="Bike", vno="KA-17-HC-1717", loan=35000, period=18,
        loan_date="2025-05-17", pay=11,
        label="2 DAYS OVERDUE", book_ref="Edge/M-302",
    ))
    # day=15 → 12th due 2026-05-15 (4 days ago)
    cases.append(dict(
        name="Nanjundaswamy Patil", father="Venkataramaiah", address="Challakere (T)",
        phone="9900550055", gname="Eranna Gowda", gphone="9900660066",
        vtype="Auto", vno="KA-16-HC-1515", loan=60000, period=18,
        loan_date="2025-05-15", pay=11,
        label="4 DAYS OVERDUE", book_ref="Edge/M-303",
    ))
    # day=12 → 12th due 2026-05-12 (7 days ago)
    cases.append(dict(
        name="Kariyappa Gowda", father="Ningaiah", address="Hosadurga (T), Chitradurga (D)",
        phone="9900770077", gname="Thimmesh Naik", gphone="9900880088",
        vtype="Bike", vno="KA-15-HD-1212", loan=50000, period=18,
        loan_date="2025-05-12", pay=11,
        label="7 DAYS OVERDUE", book_ref="Edge/M-304",
    ))
    # day=9 → 12th due 2026-05-09 (10 days ago)
    cases.append(dict(
        name="Basamma Reddy", father="Shivanna", address="Bharamasagara (V), Challakere (T)",
        phone="9900990099", gname="Chandrappa", gphone="9901001001",
        vtype="Bike", vno="KA-17-HE-0909", loan=45000, period=18,
        loan_date="2025-05-09", pay=11,
        label="10 DAYS OVERDUE", book_ref="Edge/M-305",
    ))

    # ── Due soon — fills dashboard "Due in Next 3 Days" ──
    # day=20 → next due 2026-05-20 (1 day away)
    cases.append(dict(
        name="Siddappa Naik", father="Ningappa", address="Challakere (T)",
        phone="9901110011", gname="Ramesh Gowda", gphone="9901220022",
        vtype="Bike", vno="KA-16-HF-2020", loan=50000, period=13,
        loan_date="2025-05-20", pay=11,
        label="DUE TOMORROW", book_ref="Edge/M-306",
    ))
    # day=21 → next due 2026-05-21 (2 days away)
    cases.append(dict(
        name="Kamakshi Gowda", father="Nagaraj", address="Chitradurga (T)",
        phone="9901330033", gname="Pallavi Naik", gphone="9901440044",
        vtype="Scooter", vno="KA-17-HG-2121", loan=30000, period=13,
        loan_date="2025-05-21", pay=11,
        label="DUE IN 2 DAYS", book_ref="Edge/M-307",
    ))
    # day=22 → next due 2026-05-22 (3 days away)
    cases.append(dict(
        name="Thimmaiah Swamy", father="Basappa", address="Hosadurga (T)",
        phone="9901550055", gname="Krishnappa", gphone="9901660066",
        vtype="Bike", vno="KA-15-HH-2222", loan=55000, period=13,
        loan_date="2025-05-22", pay=11,
        label="DUE IN 3 DAYS", book_ref="Edge/M-308",
    ))

    # ── Edge cases ────────────────────────────────────────────────────
    # Large loan — 3 lakh, 24 months, 6 months overdue
    cases.append(dict(
        name="Veeresh Patil (Big Loan)", father="Shivakumar", address="Chitradurga (T)",
        phone="9902002002", gname="Anand Reddy", gphone="9902112112",
        vtype="Car", vno="KA-16-JA-9999", loan=300000, period=24,
        loan_date="2024-05-10", pay=12,
        label="LARGE LOAN 6MO OVERDUE", book_ref="Edge/M-309",
    ))
    # Short loan — 6 months, almost done (5 paid, last one due)
    cases.append(dict(
        name="Ramesha Naik (6mo)", father="Halappa", address="Molakalmuru (T)",
        phone="9902202202", gname="Subbaiah", gphone="9902302302",
        vtype="Bike", vno="KA-17-JB-0606", loan=20000, period=6,
        loan_date="2025-11-10", pay=5,
        label="6 MONTH LOAN LAST EMI", book_ref="Edge/M-310",
    ))
    # Long loan — 36 months, on time
    cases.append(dict(
        name="Shivakumara Gowda (36mo)", father="Rangaswamy", address="Hiriyur (T)",
        phone="9902502502", gname="Manjappa", gphone="9902602602",
        vtype="Auto", vno="KA-16-JC-3636", loan=150000, period=36,
        loan_date="2024-01-05", pay=16,
        label="36 MONTH LOAN ON TIME", book_ref="Edge/M-311",
    ))
    # Brand new loan — this month, no payments yet
    cases.append(dict(
        name="Manjula Devi (New)", father="Narayanappa", address="Challakere (T)",
        phone="9902702702", gname="Srinivas Reddy", gphone="9902802802",
        vtype="Scooter", vno="KA-17-JD-0001", loan=40000, period=12,
        loan_date="2026-05-01", pay=0,
        label="BRAND NEW LOAN", book_ref="Edge/M-312",
    ))
    # Partial payment — paid less than one full installment this month
    cases.append(dict(
        name="Hanumappa Naik (Partial)", father="Thippaiah", address="Bharamasagara (V)",
        phone="9903003003", gname="Kenchappa", gphone="9903103103",
        vtype="Bike", vno="KA-15-JE-5050", loan=50000, period=12,
        loan_date="2025-05-10", pay=None,   # handled manually below
        label="PARTIAL PAYMENT", book_ref="Edge/M-313",
    ))
    # Advance — paid 4 months ahead
    cases.append(dict(
        name="Subbanna Reddy (Advance)", father="Venkatesh", address="Chitradurga (T)",
        phone="9903203203", gname="Lokesh Gowda", gphone="9903303303",
        vtype="Bike", vno="KA-16-JF-7070", loan=60000, period=18,
        loan_date="2025-07-15", pay=None,   # handled manually below
        label="4 MONTHS ADVANCE", book_ref="Edge/M-314",
    ))
    # Overdue with penalties — has both overdue EMI and O/D charges
    cases.append(dict(
        name="Govindappa Swamy (Penalty)", father="Basavaiah", address="Hosadurga (T)",
        phone="9903503503", gname="Ramaiah", gphone="9903603603",
        vtype="Auto", vno="KA-17-JG-8080", loan=80000, period=24,
        loan_date="2024-08-10", pay=14,
        label="OVERDUE + PENALTIES", book_ref="Edge/M-315",
    ))
    # Closed — paid off exactly
    cases.append(dict(
        name="Thippeswamy Naik (Closed)", father="Kariyappa", address="Molakalmuru (T)",
        phone="9903803803", gname="Shankar Gowda", gphone="9903903903",
        vtype="Bike", vno="KA-16-JH-1010", loan=25000, period=12,
        loan_date="2025-01-10", pay=12,   # all paid
        label="FULLY CLOSED", book_ref="Edge/M-316",
        closed=True,
    ))

    for c in cases:
        # build data dict
        data = {
            "name":               c["name"],
            "father_name":        c["father"],
            "address":            c["address"],
            "phone":              c["phone"],
            "guarantor_name":     c["gname"],
            "guarantor_phone":    c["gphone"],
            "vehicle_type":       c["vtype"],
            "vehicle_no":         c["vno"],
            "loan_amount":        float(c["loan"]),
            "interest_rate":      24.0,
            "period_months":      c["period"],
            "installment_amount": float(emi(c["loan"], c["period"])),
            "loan_date":          c["loan_date"],
            "notes":              c.get("label", ""),
            "book_ref":           c.get("book_ref", ""),
            "closed":             1 if c.get("closed") else 0,
        }
        bid = db.add_borrower(data)
        inst = emi(c["loan"], c["period"])

        pay = c.get("pay")

        if c.get("label") == "PARTIAL PAYMENT":
            # Pay 10 full installments, then half of the 11th
            add_pays(bid, c["loan_date"], inst, 10)
            db.add_payment(bid, "2026-05-10", round(inst * 0.5),
                           notes="Partial payment — balance pending")

        elif c.get("label") == "4 MONTHS ADVANCE":
            # Pay 10 months (elapsed=9, expected=9, advance covers 1 extra)
            add_pays(bid, c["loan_date"], inst, 10)

        elif c.get("label") == "OVERDUE + PENALTIES":
            add_pays(bid, c["loan_date"], inst, pay)
            db.add_penalty(bid, "2026-03-10", 500, notes="Late fee March")
            db.add_penalty(bid, "2026-04-10", 500, notes="Late fee April")
            db.add_penalty(bid, "2026-05-10", 500, notes="Late fee May")

        elif c.get("label") == "FULLY CLOSED":
            total = round(c["loan"] * 1.24)
            db.add_payment(bid, "2026-01-10", total, notes="Full settlement")

        elif pay is not None:
            add_pays(bid, c["loan_date"], inst, pay)

        print(f"  Added: {c['name']} [{c.get('label','')}]")

    print(f"\nDone. Total borrowers: {len(db.list_borrowers(include_closed=True))}")

    # Verify dashboard sections
    import models
    from datetime import date as dt
    today_dt = dt(2026, 5, 19)
    summaries = models.all_summaries(today_dt)

    today_str = "2026-05-19"
    def js_add_months(ds, n):
        from models import _add_months, parse_date
        d = _add_months(parse_date(ds), n)
        return d.strftime("%Y-%m-%d")

    due_3days = []
    for s in summaries:
        if s.closed or s.is_overdue:
            continue
        nxt = s.expected_installments + 1
        if nxt > s.period_months:
            continue
        from models import _add_months
        nd = _add_months(s.loan_date, nxt)
        diff = (nd - today_dt).days
        if 0 <= diff <= 3:
            due_3days.append((s.name, nd, diff))

    recently_overdue = [(s.name, s.days_overdue, s.overdue_amount)
                        for s in summaries if s.is_overdue and 1 <= s.days_overdue <= 10]

    print(f"\nDashboard preview:")
    print(f"  Due in Next 3 Days ({len(due_3days)}):")
    for name, nd, d in sorted(due_3days, key=lambda x: x[2]):
        print(f"    {name} — due {nd} ({d}d away)")
    print(f"  Recently Missed Last 10 Days ({len(recently_overdue)}):")
    for name, days, amt in sorted(recently_overdue, key=lambda x: x[1]):
        print(f"    {name} — {days}d overdue, Rs.{amt:,.0f}")


if __name__ == "__main__":
    db.init_db()
    seed()
