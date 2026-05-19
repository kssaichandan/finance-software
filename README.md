# Finance Tracker

A Windows desktop app for tracking vehicle finance loans — installment payments, overdue amounts, and penalties. No internet required. All data stays on your computer.

---

## How to Download and Install

### Step 1 — Go to Releases

Click here: **[Releases page](../../releases/latest)**

Or on GitHub, look for the **"Releases"** section on the right side of the page and click the latest one.

---

### Step 2 — Download the zip file

On the Releases page, under **"Assets"**, click **`FinanceTracker-v1.1.zip`** to download it.

> Do NOT click "Source code (zip)" — that is the raw code, not the app.

---

### Step 3 — Extract the zip BEFORE running

> ⚠️ **Important:** Do NOT double-click the `.exe` from inside the zip. You must extract first or it will fail with a DLL error.

1. Find the downloaded zip in your **Downloads** folder
2. Right-click it → **"Extract All..."**
3. Choose a permanent location, for example: `C:\FinanceTracker\`
4. Click **Extract**
5. Windows will open the extracted folder automatically

> Keep the entire extracted folder together — do not move just the `.exe` out, it needs the `_internal` folder next to it.

---

### Step 4 — Run the app

Inside the extracted folder, double-click **`FinanceTracker.exe`**.

> If the folder shows "Extract all" at the top of the window, you are still inside the zip — go back and do Step 3 first.

The first time Windows may show a blue warning:
> *"Windows protected your PC"*

Click **"More info"** → then **"Run anyway"**. This is normal for apps not published to the Microsoft Store.

---

### Step 5 — Your data

When the app starts for the first time, it automatically creates `finance.db` in the same folder as the `.exe`. This file contains all your borrower data.

**Back it up regularly** — copy `finance.db` to a USB drive or OneDrive.

---

## If the App Crashes or Shows an Error

If the app shows a Python error or crashes:

1. Look for a file called **`error.log`** in the same folder as `FinanceTracker.exe`
2. Open it with Notepad — it will show the exact error
3. Share the contents to get help fixing it

**Common fixes:**

| Problem | Fix |
|---|---|
| Blue "Windows protected your PC" screen | Click "More info" → "Run anyway" |
| App opens and immediately closes | Check `error.log` in the same folder |
| "WebView2" or "Edge" error | Install [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) |
| Missing DLL error | Install [Visual C++ Redistributable](https://aka.ms/vs/17/release/vc_redist.x64.exe) |

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

## Backup Your Data

Your data lives entirely in `finance.db` next to the `.exe`. To back it up:
- Copy it to a **USB drive**, or
- Copy it to **OneDrive / Google Drive**

To restore on a new PC: copy your `finance.db` into the same folder as `FinanceTracker.exe` before launching.

---

## For Developers — Running from Source

**Requirements:** Python 3.10+, Windows

```powershell
# Install dependencies
py -m pip install -r requirements.txt

# Run the app
py main.py
```

**Build a standalone .exe:**

```powershell
build.bat
```

The built app will be in `dist\FinanceTracker\`. Zip that entire folder and distribute it.
