# Finance Tracker

A Windows desktop app for tracking vehicle finance loans — installment payments, overdue amounts, and penalties. No internet required. All data stays on your computer.

---

## Download & Install (no Python needed)

> **One-click install for Windows**

1. Go to the [**Releases**](../../releases/latest) page of this repository.
2. Download **`FinanceTracker.zip`** from the latest release.
3. Extract the zip anywhere (e.g. `C:\FinanceTracker\`).
4. Double-click **`FinanceTracker.exe`** to launch.

Your data is saved in `finance.db` in the same folder as the `.exe`. Back this file up regularly (copy to a USB drive or cloud folder).

---

## Features

- Add borrowers with full loan, vehicle, and guarantor details
- Record installment payments and overdue (O/D) penalty charges
- Flat-interest calculation: Total = Principal × 1.24, EMI = Total ÷ Period
- Dashboard showing borrowers due today/tomorrow and recently missed payments
- Filter borrowers by status: Overdue, On Time, Advance, Due in N days, pick a date
- Edit or delete individual payment and penalty entries
- Export borrower list to CSV (open in Excel)
- Portable — copy the entire folder to any Windows PC and it works

---

## Interest Calculation

| Field | Formula |
|---|---|
| Total payable | Principal × 1.24 |
| Monthly EMI | Round(Total ÷ Period) |
| Overdue amount | (EMIs due so far × EMI) − Total paid |
| Days overdue | Days since the first unpaid EMI was due |

Penalties are tracked separately and do not affect the overdue calculation.

---

## For Developers — Running from Source

**Requirements:** Python 3.10+, Windows

```powershell
# Install dependencies
py -m pip install -r requirements.txt

# Run the app
py main.py

# Optional: seed demo data
py seed_sample.py
```

**Build a standalone .exe:**

```powershell
build.bat
```

The built app will be in `dist\FinanceTracker\`. Copy that entire folder anywhere and run `FinanceTracker.exe`.

---

## File Layout

```
finance software/
├── main.py          # Entry point
├── db.py            # SQLite schema and helpers
├── models.py        # Loan/overdue calculation logic
├── api.py           # JS-to-Python bridge (pywebview)
├── build.bat        # One-click build script
├── requirements.txt
├── seed_sample.py   # Loads one demo borrower
├── seed_edge.py     # Loads edge-case demo data for testing
├── seed_fake.py     # Loads 50 fake borrowers for testing
└── web/
    ├── index.html   # App shell
    ├── style.css    # Styles
    └── app.js       # All UI logic
```

> `finance.db` is created on first run and is excluded from git — it contains real borrower data.

---

## Backup

Your data lives entirely in `finance.db`. To back it up:
- Copy it to a USB drive, or
- Copy it to OneDrive / Google Drive

To restore, place the `.db` file back in the same folder as `FinanceTracker.exe`.
