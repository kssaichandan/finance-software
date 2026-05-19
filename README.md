# Finance Tracker

A simple Windows desktop app for tracking vehicle finance loans, installment payments, and overdue borrowers. Built with Python + PySide6, SQLite storage.

## Features
- Add borrowers with full loan/vehicle/guarantor details
- Record installment payments and O/D penalty charges
- Automatic flat-interest calculation (Total = Principal + Principal × Rate%)
- **Dashboard** that shows overdue borrowers, sorted by amount overdue
- Search across borrowers by name, phone, or vehicle number
- Export overdue list to CSV (open in Excel / WhatsApp share)
- Borrower detail view with payment history and live summary

## How overdue is calculated
For each active loan, on every refresh:
1. Count whole months elapsed from loan date (same day-of-month rule).
2. Cap to the loan's period (e.g. 12 months).
3. Expected paid by today = `installments_due × monthly_installment`.
4. Actually paid = sum of all payments recorded (penalties tracked separately).
5. **Overdue amount = Expected − Actual**. If > 0, borrower is flagged on the dashboard.

## Running

```powershell
# First-time setup
py -m pip install -r requirements.txt

# Optional: seed the demo borrower (Paramesha from the book photo)
py seed_sample.py

# Launch the app
py main.py
```

Data is stored in `finance.db` next to `main.py`. Back this file up to OneDrive / a USB stick to keep your records safe.

## Building a standalone .exe (no Python required to run)

```powershell
py -m pip install pyinstaller
py -m PyInstaller --noconfirm --windowed --onefile --name "FinanceTracker" main.py
```

The `.exe` will be in `dist\FinanceTracker.exe`. Double-click to launch.

> ⚠️ When you move the `.exe` to a different folder/computer, the `finance.db` file will be created **next to the .exe** the first time you run it. Move your existing `finance.db` alongside the `.exe` to keep your data.

## File layout
```
finance software/
├── main.py                 # Entry point
├── db.py                   # SQLite schema + helpers
├── models.py               # Overdue/summary calculation logic
├── seed_sample.py          # One-time demo seed
├── requirements.txt
├── finance.db              # Created at first run (your data lives here)
└── ui/
    ├── main_window.py      # Tabbed shell
    ├── dashboard.py        # Overdue list + CSV export
    ├── all_borrowers.py    # Searchable list of every loan
    ├── borrower_form.py    # Add/edit borrower dialog
    ├── borrower_detail.py  # Full borrower view + payment history
    ├── payment_form.py     # Add payment / penalty dialogs
    └── common.py           # Money formatting + row colors
```

## Future ideas (not in v1)
- Edit/delete individual payments
- Multiple loans per same person
- Auto-backup of `finance.db` to a chosen folder
- SMS/WhatsApp reminders to borrowers
- Print-friendly receipt generation
