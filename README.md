# Finance Tracker

A Windows desktop app for tracking vehicle / personal loans you give to borrowers — installment payments, overdue amounts, penalties, and per-borrower history. **No internet required. All data stays on your computer in a single `finance.db` file.**

---

## How to Download and Install

### Step 1 — Open the Releases page

Click here: **[Latest release](../../releases/latest)**

### Step 2 — Download the zip

Under **"Assets"**, click the `FinanceTracker-vX.YY.zip` (NOT "Source code"). The filename changes with each release — always grab the latest.

### Step 3 — Extract the zip BEFORE running

> ⚠️ Do NOT double-click the `.exe` from inside the zip. Windows previews it from a temp folder and the app crashes with a DLL error. **You must extract first.**

1. Open **Downloads** folder
2. Right-click the zip → **Extract All…**
3. Pick a location, e.g. **Desktop** (Windows creates a folder named after the zip)
4. Click **Extract**

### Step 4 — Run the app

1. Open the extracted folder
2. Double-click **`FinanceTracker.exe`**
3. If Windows shows "Windows protected your PC" — click **More info** → **Run anyway**

### Step 5 — Your data

A fresh empty `finance.db` is created on first run, in the same folder as the `.exe`. **All your borrower data lives in this one file.** Back it up regularly.

---

## Features

- Add borrowers with full loan, vehicle, and guarantor details (incl. alternate phones)
- Record installment payments and overdue (O/D) penalty charges
- **Annual interest prorated by months** (see formula below)
- Dashboard: borrowers due today/tomorrow and recently missed
- Borrowers list with filters: All Active, Overdue (any), **Overdue > 1/2/3 months**, **Overdue > ₹1k/₹5k**, **Custom (set your own thresholds)**, Due in N days, Pick Date
- **Unique Book No / S.No** and **unique payment Receipt No** (when filled)
- Edit / delete individual payments and penalties
- Autocomplete suggestions for Address, Vehicle Type, Showroom, names
- Auto-close loans once fully paid (with rounding tolerance)
- Export overdue list to CSV (saved into your Downloads folder, timestamped)
- Multi-language Help page: English, हिन्दी, ಕನ್ನಡ, తెలుగు, தமிழ், മലയാളം, मराठी
- Auto-shutdown when you close the window — no ghost processes locking the DB
- Per-session security token blocks unauthorized API calls from other processes/sites
- Number fields are strictly type-only — no buttons, no mouse wheel, no arrow keys (prevents accidental value changes)
- Dates throughout shown as `dd-mm-yy` (e.g. `19-05-26`)

---

## Interest Calculation Formula

Interest is treated as **annual**, prorated by loan months:

| Field | Formula |
|---|---|
| Effective rate | `Interest % × (Period in months ÷ 12)` |
| Total Payable | `Principal × (1 + Effective rate ÷ 100)` |
| Monthly EMI | `Total Payable ÷ Period` |
| Overdue Amount | `(months elapsed × EMI) − Total paid` |
| Days Overdue | Days since the first unpaid EMI was due |

**Example:** ₹70,000 at 24% per year for 6 months
- Effective rate = 24% × (6/12) = 12%
- Total = ₹78,400, EMI = ₹13,067

For 12-month loans the result is identical to flat 24%. For other periods it scales correctly.

Penalties are tracked separately and do not affect the overdue calculation on the loan itself.

---

## If the App Crashes

1. Look for **`error.log`** in the same folder as `FinanceTracker.exe`
2. Open it with Notepad — it shows the exact error
3. Share the contents (or open a GitHub issue with them)

**Common stumbles:**

| Problem | Fix |
|---|---|
| Blue "Windows protected your PC" screen | Click "More info" → "Run anyway" |
| `Failed to load Python DLL` | You opened the exe from INSIDE the zip. Extract the zip first, then run from the extracted folder. |
| Old `finance.db` file is locked when copying | Make sure the app is fully closed. Wait ~20 seconds after closing the window for auto-shutdown to complete. |

---

## Backup Your Data

Your data lives entirely in `finance.db` next to the `.exe`. To back it up:
- Close the app first (wait for auto-shutdown — about 20s after closing the window)
- Copy `finance.db` to a **USB drive**, **OneDrive**, or **Google Drive**

To restore on a new PC: copy your `finance.db` into the folder with a fresh `FinanceTracker.exe`, before launching.

---

## For Developers — Running from Source

**Requirements:** Python 3.10+, Windows. **Zero external dependencies** — uses only the Python standard library.

```powershell
# Run from source
py main.py
```

**Build a standalone .exe:**

```powershell
.\build.bat
```

Output: `dist\FinanceTracker\` — zip that entire folder for distribution. The build script does NOT bundle your local `finance.db` (clean builds only).

---

## Project Structure

```
finance software/
├── main.py          # Entry point: local HTTP server + Edge launcher + auto-shutdown
├── api.py           # JSON API methods called from the frontend
├── db.py            # SQLite schema, queries, and migrations
├── models.py        # Loan summary + interest calculations
├── build.bat        # One-click PyInstaller build
├── requirements.txt # (empty — no external deps)
├── README.md
└── web/
    ├── index.html   # App shell
    ├── style.css    # Styling
    ├── app.js       # All UI logic and state
    └── help.js      # Translated help content (7 languages)
```

`finance.db` is created on first run and excluded from git.
