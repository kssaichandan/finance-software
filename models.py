"""Domain logic: overdue calculation, loan summaries."""
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime
import db


DATE_FMT = "%Y-%m-%d"


def parse_date(s: str) -> date:
    return datetime.strptime(s, DATE_FMT).date()


def fmt_date(d: date) -> str:
    return d.strftime(DATE_FMT)


def months_elapsed(loan_date: date, today: date) -> int:
    """Whole months elapsed using same day-of-month rule.

    Example: loan 2024-11-20, today 2025-02-19 -> 2 (the 20th hasn't hit in Feb yet).
    today 2025-02-20 -> 3.
    """
    if today < loan_date:
        return 0
    months = (today.year - loan_date.year) * 12 + (today.month - loan_date.month)
    if today.day < loan_date.day:
        months -= 1
    return max(0, months)


@dataclass
class LoanSummary:
    borrower_id: int
    name: str
    phone: str
    vehicle_no: str
    loan_date: date
    loan_amount: float
    interest_rate: float
    period_months: int
    installment_amount: float
    total_payable: float
    total_paid: float
    total_penalties: float
    total_seizings: float
    remaining: float
    expected_paid_by_today: float
    overdue_amount: float
    days_overdue: int
    months_elapsed: int
    expected_installments: int
    last_payment_date: str | None
    closed: bool
    book_ref: str
    receipts: list

    @property
    def is_overdue(self) -> bool:
        return not self.closed and self.overdue_amount > 0.01

    @property
    def is_advance(self) -> bool:
        return not self.closed and self.overdue_amount < -0.01

    @property
    def status_label(self) -> str:
        if self.closed:
            return "Closed"
        if self.is_overdue:
            return "Overdue"
        if self.is_advance:
            return "Advance"
        return "On time"


def compute_summary(borrower_row, today: date | None = None,
                    pay_sums: dict | None = None,
                    pen_sums: dict | None = None,
                    last_pays: dict | None = None,
                    seiz_sums: dict | None = None,
                    receipts: dict | None = None) -> LoanSummary:
    """Compute a loan summary. If pay_sums/pen_sums/last_pays/seiz_sums dicts
    are passed, use them instead of per-borrower DB queries — used by
    all_summaries() to avoid an N+1 pattern across many borrowers."""
    if today is None:
        today = date.today()

    b = borrower_row
    loan_date = parse_date(b["loan_date"])
    loan_amount = float(b["loan_amount"])
    interest_rate = float(b["interest_rate"])
    period = int(b["period_months"])
    installment = float(b["installment_amount"])

    # Annual rate prorated over loan months:
    # total payable = principal × (1 + (rate × months/12) / 100)
    effective_rate = interest_rate * (period / 12.0)
    total_payable = loan_amount + (loan_amount * effective_rate / 100.0)

    bid = b["id"]
    total_paid = pay_sums[bid] if pay_sums is not None and bid in pay_sums else (
        0.0 if pay_sums is not None else db.sum_payments(bid))
    total_penalties = pen_sums[bid] if pen_sums is not None and bid in pen_sums else (
        0.0 if pen_sums is not None else db.sum_penalties(bid))
    total_seizings = seiz_sums[bid] if seiz_sums is not None and bid in seiz_sums else (
        0.0 if seiz_sums is not None else db.sum_seizings(bid))
    remaining = max(0.0, total_payable - total_paid)

    elapsed = months_elapsed(loan_date, today)
    expected_installments = min(elapsed, period)
    expected_paid_by_today = min(expected_installments * installment, total_payable)
    overdue_amount = expected_paid_by_today - total_paid

    # Days overdue counted from the FIRST missed installment
    days_overdue = 0
    if overdue_amount > 0.01 and expected_installments > 0:
        for i in range(1, expected_installments + 1):
            if total_paid < i * installment - 0.01:
                first_missed = _add_months(loan_date, i)
                days_overdue = max(0, (today - first_missed).days)
                break

    # Rounding tolerance: Math.round() can drift by up to 0.5 per installment
    rounding_tol = period * 0.5 + 1
    closed = bool(b["closed"]) or total_paid >= total_payable - rounding_tol

    return LoanSummary(
        borrower_id=b["id"],
        name=b["name"] or "",
        phone=b["phone"] or "",
        vehicle_no=b["vehicle_no"] or "",
        loan_date=loan_date,
        loan_amount=loan_amount,
        interest_rate=interest_rate,
        period_months=period,
        installment_amount=installment,
        total_payable=total_payable,
        total_paid=total_paid,
        total_penalties=total_penalties,
        total_seizings=total_seizings,
        remaining=remaining,
        expected_paid_by_today=expected_paid_by_today,
        overdue_amount=overdue_amount,
        days_overdue=days_overdue,
        months_elapsed=elapsed,
        expected_installments=expected_installments,
        last_payment_date=(last_pays.get(bid) if last_pays is not None
                           else db.last_payment_date(bid)),
        closed=closed,
        book_ref=b["book_ref"] or "",
        receipts=(receipts.get(bid, []) if receipts is not None else []),
    )


def _add_months(d: date, n: int) -> date:
    """Add n months, keeping the same day-of-month (clamping to month end)."""
    month = d.month - 1 + n
    year = d.year + month // 12
    month = month % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


def all_summaries(today: date | None = None) -> list[LoanSummary]:
    rows = db.list_borrowers(include_closed=True)
    # Pre-fetch aggregates ONCE for all borrowers (was N+1 before).
    pay_sums = db.all_payment_sums()
    pen_sums = db.all_penalty_sums()
    last_pays = db.all_last_payment_dates()
    seiz_sums = db.all_seizing_sums()
    receipts = db.all_receipts_by_borrower()
    return [compute_summary(r, today, pay_sums, pen_sums, last_pays, seiz_sums, receipts) for r in rows]


def due_soon(days: int = 7, today: date | None = None) -> list[dict]:
    """Return borrowers whose next installment is due within `days` days (not already overdue)."""
    if today is None:
        today = date.today()
    result = []
    for b in db.list_borrowers(include_closed=False):
        s = compute_summary(b, today)
        if s.closed or s.is_overdue:
            continue
        next_inst_no = s.expected_installments + 1
        if next_inst_no > s.period_months:
            continue
        next_due = _add_months(s.loan_date, next_inst_no)
        days_until = (next_due - today).days
        if 0 <= days_until <= days:
            result.append({
                "summary": s,
                "next_due_date": fmt_date(next_due),
                "days_until": days_until,
            })
    result.sort(key=lambda x: x["days_until"])
    return result


def payment_schedule(borrower_row, today: date | None = None) -> list[dict]:
    """Full installment schedule — each installment with paid/overdue/upcoming status."""
    if today is None:
        today = date.today()
    loan_date = parse_date(borrower_row["loan_date"])
    period = int(borrower_row["period_months"])
    installment = float(borrower_row["installment_amount"])
    total_paid = db.sum_payments(borrower_row["id"])

    schedule = []
    for i in range(1, period + 1):
        due_date = _add_months(loan_date, i)
        expected_cumulative = i * installment
        is_past = due_date <= today
        paid_up = total_paid >= expected_cumulative - 0.01

        if not is_past:
            status = "upcoming"
        elif paid_up:
            status = "paid"
        else:
            status = "overdue"

        schedule.append({
            "no": i,
            "due_date": fmt_date(due_date),
            "amount": installment,
            "expected_cumulative": expected_cumulative,
            "status": status,
            "is_past": is_past,
        })
    return schedule
