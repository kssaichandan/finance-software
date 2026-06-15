# Finance Tracker — Full Codebase Audit

**Date:** 2026-06-15
**Scope:** Entire application — backend (`main.py`, `api.py`, `db.py`, `models.py`) and frontend (`web/index.html`, `web/app.js`, `web/style.css`, `web/help.js`).
**Method:** Full read of every source file, then six parallel specialist reviews — (1) financial/domain-logic correctness, (2) backend server / DB / security, (3) frontend JS robustness & XSS, (4) screen-by-screen UX, (5) visual / CSS / accessibility, (6) data-integrity & "what breaks" stress testing. Findings below are de-duplicated and cross-verified; several criticals were independently confirmed by 3–4 reviewers.

> **What the app is:** a local, single-user Windows desktop loan-tracker for a moneylending business (vehicle/personal loans, EMIs, overdue tracking, penalties, repossession/"seizing" costs). It runs a Python stdlib HTTP server on `127.0.0.1` (random port), serves a vanilla-JS single-page app shown in Edge app-mode, and stores everything in one local `finance.db` (SQLite). No frameworks, no internet, no external dependencies.

> **Overall verdict:** The codebase is genuinely well-built for a personal tool — clean separation, disciplined HTML-escaping (no exploitable XSS found), thoughtful touches (session-token CSRF, idle auto-shutdown, N+1-free aggregate queries, 7-language help). But there are **a small number of bugs that can crash the entire app or silently corrupt money figures**, plus one **security feature that doesn't actually work** (the delete-password is enforced only in the browser). Fixing the ~6 items in the "Must fix" table below removes essentially all of the "something broke" risk.

---

## Priority Summary

### 🔴 Must fix (data loss, whole-app crash, or broken security promise)

| # | Severity | Issue | Where |
|---|----------|-------|-------|
| **1** | Critical | **One bad calendar date (e.g. `31-02-26`) crashes the WHOLE app** — Dashboard, Borrowers, Portfolio, CSV/PDF export all 500 for *every* borrower, and you can't even open the bad record to fix it. | `app.js:137`, `models.py:11/184`, `api.py:194` |
| **2** | Critical | **`Infinity`/`NaN`/negative amounts corrupt the DB and break JSON** for every total that touches the row. | `api.py:264/333/387`, `main.py:150` |
| **3** | High | **Delete-password is enforced only in JavaScript.** The backend `delete_*` / `reset_password` methods check nothing — anyone at the PC (or any script with the session token) can delete data without the password. The feature is cosmetic. | `api.py:230/346/370/399`, `app.js:319` |
| **4** | High | **"Re-open Loan" silently does nothing on a fully-paid loan** — the button reports success but the loan stays Closed. | `models.py:132`, `api.py:255` |
| **5** | High | **Editing a borrower silently overwrites a manually-set EMI.** The "override if needed" guard (`dataset.userEdited`) is read but never set anywhere — dead code. | `app.js:1650` (read), never written |
| **6** | High | **A blank white screen on any API hiccup.** `navigate()` clears the page, then the render aborts on error with only a 3-second toast — no retry, no content. | `app.js:295/482/587/2410` |

### 🟠 Should fix (reliability, correctness, hygiene)

| # | Severity | Issue | Where |
|---|----------|-------|-------|
| 7 | High | Month-end loans (e.g. loan dated the 31st) mis-time overdue: `months_elapsed` (day-of-month rule) and `_add_months` (clamps to month-end) disagree. | `models.py:116–128` |
| 8 | High | `rounding_tol = period*0.5 + 1` auto-closes loans while up to ₹121 is still genuinely owed (240-mo loan). | `models.py:131` |
| 9 | High | SQLite connections are never `close()`d (`with sqlite3.connect()` only manages the transaction) + no `busy_timeout`/WAL → "database is locked" risk under the threaded server. | `db.py:112–116`, all `with connect()` |
| 10 | Medium | API 500s return the **full Python traceback** to the client (leaks PyInstaller temp paths, internal SQL). | `main.py:152–155` |
| 11 | Medium | **CSV formula injection** — a borrower name/notes starting with `=`,`+`,`-`,`@` executes when the export is opened in Excel. | `api.py:619–630` |
| 12 | Medium | Receipt/Book-No uniqueness: pre-existing duplicates silently disable the DB unique index; check-then-insert has a TOCTOU race; DB conflicts surface as raw 500s. | `db.py:163–178`, `api.py:266` |
| 13 | Medium | Idle watchdog kills the app after OS sleep / minimized-tab throttling (heartbeat gap > 20 s), losing any unsaved modal edits. No single-instance lock. | `main.py:26/203`, `app.js:2754` |
| 14 | Medium | Edit-payment/penalty/seizing modals never call `openModal()`; pressing Esc during their `await` writes the form into a hidden container and it's lost. | `app.js:2112/2172/2281` |
| 15 | Medium | Help page describes a filter UI that no longer exists ("either threshold" vs the real ANDed panel) and omits several shipped features. | `help.js:94–104` vs `app.js:712` |

### 🟡 UX / design / polish — see [Screen-by-Screen](#screen-by-screen-ux-review) and [Visual](#visual--css--accessibility) sections.

---

## Critical Bugs (detail)

### 1. A single malformed date bricks the entire app  🔴 Critical

**The bug.** `parseUserDate()` validates only `day ≤ 31` and `month ≤ 12` — it does **not** check days-per-month:

```js
// app.js:143
if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1900 || y > 2100) return null;
```

So typing a loan date of `31-02-26` (or `30-02-26`, `31-04-26`, `29-02-25`) passes, becomes the string `"2026-02-31"`, and is stored verbatim — `api.add_borrower` does no calendar validation either. On the **next** render, `models.all_summaries()` builds every summary in one comprehension:

```python
# models.py:184
return [compute_summary(r, ...) for r in rows]
# → compute_summary → parse_date → datetime.strptime("2026-02-31", "%Y-%m-%d")
#   ValueError: day is out of range for month
```

Because nothing catches it per-row, **`get_all_borrowers`, `get_dashboard_data`, `get_portfolio_summary`, `export_csv`, `get_borrowers_full`, and `get_borrower_detail` all throw a 500** — for *every* borrower, not just the bad one. The user lands on a blank Dashboard/Borrowers screen and **cannot even open the offending borrower to fix the date**, because detail also recomputes. The only recovery is hand-editing `finance.db` in an SQLite tool. This is the single biggest "nothing ever breaks" violation in the app, and it was independently flagged by 4 of the 6 reviewers.

The same class affects `payment_date`/`charge_date`/`seizing_date` — those aren't `strptime`'d so they don't crash, but a stored `2026-02-31` silently creates a phantom month bucket and a wrong "last payment" (string `MAX` picks `…-02-31` over `…-02-28`).

**Fix (defense in depth):**
1. **Frontend** — in `parseUserDate`, round-trip the date before returning: build `new Date(y, mo-1, d)` and confirm `.getDate()===d && .getMonth()===mo-1 && .getFullYear()===y`; otherwise return `null`. This rejects `31-02` everywhere date input flows through (loan, payments, penalties, seizings, filters).
2. **Backend** — validate `loan_date` with `datetime.strptime` in `add_borrower`/`update_borrower` (and the date fields in payment/penalty/seizing) and return a clean `{"success": False, "error": …}`.
3. **Resilience** — wrap the per-row `compute_summary` call in `all_summaries` (and export/detail) in `try/except` so any future bad row degrades to a single visibly-flagged record instead of taking down the whole list. This one change directly satisfies the "nothing ever breaks" goal.

### 2. Non-finite / negative amounts corrupt data and break JSON  🔴 Critical

`float("1e309")` → `inf`, `float("nan")` → `nan`, `float("-5")` → `-5.0` — and the single-entry paths apply **no `> 0` and no finiteness check**:

```python
# api.py:264  add_payment — only does float(data["amount"])
# api.py:333  add_penalty — same
# api.py:387  add_seizing — same
# api.py:196  add_borrower — float(loan_amount) with no guard
```

Only `add_payments_batch` checks `amount <= 0` (`api.py:299`), and even that lets `inf`/`nan` through (`inf <= 0` and `nan <= 0` are both `False`). Once stored:

- `SUM(amount)` returns `inf`/`nan`.
- `main.py:150` does `json.dumps(result, default=str)`, which emits bare `Infinity`/`NaN` tokens — **invalid JSON**. The frontend's `await res.json()` (`app.js:211`) then throws, so Portfolio, the affected borrower's detail, and any list summing that row all fail to render.
- Negative amounts silently skew `total_paid`, `remaining`, and the interest ratios.

**Fix:** add one shared validator used by every write path — reject if `not math.isfinite(x)` or (for amounts) `x <= 0`. Set `json.dumps(..., allow_nan=False)` in `main.py` and catch the resulting `ValueError` to return a clean error instead of poisoning the client. Add sane `max` / `maxlength` to the numeric inputs.

### 3. The delete-password is enforced only in the browser  🔴 High (broken security promise)

The "🔐 Confirm with Password" gate lives entirely in `requirePasswordThen()` (`app.js:319`), which calls `verify_password` and, only on a truthy result, runs the delete. But the **server-side** methods authenticate nothing:

```python
# api.py:230  delete_borrower → db.delete_borrower(int(id))      # no password check
# api.py:346  delete_payment  → db.delete_payment(int(id))       # no password check
# api.py:370  delete_penalty  → ...                              # no password check
# api.py:399  delete_seizing  → ...                              # no password check
# api.py:439  reset_password  → wipes the password, no challenge
```

Any code holding the session token (the page's own devtools console, a replayed request, a second tab) can `POST /api/delete_borrower [<id>]` and wipe a borrower plus all cascaded payments — **no password required**. The feature provides UX friction, not protection, which defeats its stated purpose (guarding against another person sitting at the same PC). The password result is computed server-side but the *authorization decision* is made client-side — backwards.

**Fix:** pass the entered password into each `delete_*` (and optionally `reset_password`); when `db.has_password()` is true, call `db.verify_password(password)` server-side and refuse before touching the DB. The frontend already collects the password — just forward it instead of pre-verifying.

> Note: PBKDF2 hashing itself is sound (SHA-256, 120k iterations, 16-byte random salt, constant-time compare). The weakness is purely that it isn't *enforced* on the server.

### 4. "Re-open Loan" is a silent no-op on fully-paid loans  🔴 High

`compute_summary` derives `closed` as an **OR**:

```python
# models.py:132
closed = bool(b["closed"]) or total_paid >= total_payable - rounding_tol
```

`reopen_loan` (`api.py:255`) sets the DB column `closed = 0` — but for any loan you'd want to reopen, `total_paid` is by definition at/near `total_payable`, so the right-hand side is `True` and the loan re-derives to Closed on the very next render. The user clicks "Re-open Loan", gets a success toast, and **nothing changes**. There's no way to reopen a settled loan (e.g. to log a refund, correction, or post-closure penalty).

**Fix:** separate the *persisted* manual closed/reopened decision from the *derived* "fully paid" state — e.g. add a `reopened` override flag so `closed = manual_closed or (fully_paid and not reopened)`, or have the auto-close write the column once rather than re-deriving on every read. At minimum, surface "auto-closed (fully paid)" distinctly so the button's ineffectiveness is explained.

### 5. Editing a borrower silently resets a custom EMI  🔴 High

The auto-calculator is guarded so it won't clobber a manual override:

```js
// app.js:1650
if (ins && !ins.dataset.userEdited) ins.value = period > 0 ? Math.round(total / period) : '';
```

…but `dataset.userEdited` is **read here and set nowhere** (confirmed by search — single occurrence). Consequences:
- **Edit-load clobber:** `renderAddBorrower(borrower)` calls `recalcInstallment()` immediately (`app.js:1612`), so opening an existing loan for edit overwrites its stored `installment_amount` with the recomputed value *before the user touches anything* — silently changing a deliberately rounded EMI.
- **Field-edit clobber:** changing principal/rate/period at any time wipes a manually typed EMI, despite the hint *"Auto-calculated. Override if needed."*

**Fix:** set the flag on manual edit — `oninput="this.dataset.userEdited='1'"` on `#installment-field` — and when loading an existing borrower with an `installment_amount`, set the flag before the initial `recalcInstallment()` so the saved value is preserved.

### 6. Blank screen on any API failure  🔴 High

`navigate()` clears the content pane *before* awaiting the render:

```js
// app.js:295
container.innerHTML = '';
if (view === 'dashboard') await renderDashboard();   // throws on API error → aborts here
```

`renderDashboard`/`renderBorrowers`/`renderPortfolio` await `api(...)` inside `try/finally` (clears the loader) but have **no `catch`**, so on a 500 / server-gone / heartbeat-shutdown the exception propagates, the `view.innerHTML = …` line never runs, and the user is left with an **empty white pane** plus a toast that vanishes in 3 seconds. On a flaky localhost (or right after the idle-timeout kills the server) this is the most likely real-world breakage.

Related: mutation handlers (`submitBorrower` etc.) set `btn.disabled = true; btn.textContent='Saving…'` and only restore it *after* a successful `await api()` — so an API throw leaves the **Save button stuck on "Saving…" and disabled** with no recovery short of navigating away (`app.js:1657–1677`).

**Fix:** wrap each render body in `try/catch` that paints an inline "Couldn't load — Retry" card; wrap the mutation `await`s so a `finally` restores button state.

---

## Financial / Math Correctness

The core interest formula is **consistent across all three implementations** (frontend `recalcInstallment` `app.js:1645`, backend `compute_summary` `models.py:104`, portfolio recompute `api.py:500`) — `payable = principal × (1 + rate×period/12 / 100)`. Verified agreeing. The issues are in the time/edge logic:

- **7 · Month-end schedule mismatch (High).** `expected_installments` uses `months_elapsed` (rule: subtract a month if `today.day < loan_date.day`), but `days_overdue` and `payment_schedule` use `_add_months` (clamps to month-end). For a loan dated **2025-01-31**, on **2025-02-28** the installment *is* due per `_add_months` (→ Feb 28) but `months_elapsed` returns 0, so the borrower gets a free month and the dashboard/`payment_schedule` disagree. Unify on one schedule: define installment *i*'s due date as `_add_months(loan_date, i)` everywhere and compute `expected_installments` as the count of those `≤ today`.

- **8 · `rounding_tol` hides real balances (High).** `rounding_tol = period * 0.5 + 1` (`models.py:131`) scales with loan length: ₹13 for 24 months, **₹121 for 240 months**. A borrower still owing that much is auto-marked Closed and dropped from overdue lists, and `remaining = max(0, …)` clamps the residue away. Use a small fixed rupee epsilon (₹1–2), not a period-scaled one.

- **M · "Advance" flickers for normal on-time payers (Medium).** Because `expected_paid_by_today` is a whole-month step function, a borrower who paid installment #1 on time shows `total_paid > expected` for most of the next month → labeled **Advance** (`models.py:69`). Pollutes the Standing filter. Compare against a day-prorated expectation, or only flag Advance when paid beyond the *next* upcoming installment.

- **M · `days_overdue` jumps (Medium).** It's computed only when the whole-month expectation ticks, so it leaps from 0 to ~28–31 at month roll rather than counting "3 days late" on the current installment. Derive it from the same unified schedule as #7.

- **M · "Interest earned so far" front-loads profit (Medium).** Portfolio splits every collected rupee by a flat `interest/payable` ratio (`api.py:33`), so after collecting half of a ₹124k loan it reports ~₹9.7k "interest earned" even though principal is still mostly outstanding. It's internally consistent (sums correctly at full payoff) but the **label** overstates realized profit mid-loan. Rename to "interest portion of collections (pro-rata)" or recognize interest principal-first.

- **M · Validate loan terms server-side (Medium).** `period_months`, `loan_amount`, `installment_amount` have form `min` attributes but no backend lower-bound check. A 0/negative period or principal stored via any path makes the loan silently uncollectable/untracked. Add server validation + DB `CHECK` constraints.

---

## Backend / Server / DB / Security

- **9 · Connection leak + lock risk (High).** `with sqlite3.connect() as conn` is a *transaction* manager, not a resource one — it commits/rolls back but never `close()`s. Every API call opens a fresh connection and relies on GC to close it. Combined with **no `busy_timeout`** and default rollback-journal mode, the `ThreadingHTTPServer` (heartbeat every 5 s + saves + list refreshes overlapping) can hit `sqlite3.OperationalError: database is locked`, surfacing as a 500 and a silently-failed save. **Fix:** `with closing(connect()) as conn, conn:`; add `PRAGMA busy_timeout = 5000` and consider `PRAGMA journal_mode = WAL` in `connect()`.

- **10 · Traceback leak (Medium).** `main.py:152` returns `json.dumps({"error": traceback.format_exc()})` on any unhandled exception — leaks `sys._MEIPASS` paths, line numbers, and SQL to anything that can hit the port, and dumps it into a UI toast. Log server-side; return a generic `{"error":"Internal error"}`.

- **11 · CSV formula injection (Medium).** `export_csv` writes name/address/guarantor verbatim (`api.py:619`). A field starting with `=`,`+`,`-`,`@` becomes a live formula in Excel/LibreOffice (data-exfil / DDE). Prefix such cells with `'`.

- **12 · Uniqueness is fragile (Medium).** Partial unique indexes are created in `try/except: pass` (`db.py:163`) — if the DB already has duplicate `receipt_no`/`book_ref`, index creation is silently swallowed and **the DB stops enforcing uniqueness entirely**, leaving only the app-level check, which is a check-then-insert across *separate connections* (TOCTOU). When the index *does* exist, a racing/edited duplicate throws `IntegrityError` → raw 500 instead of the friendly conflict message. **Fix:** do the conflict-check and insert in one transaction, catch `IntegrityError` → translate to `_receipt_conflict_msg`, and surface (don't swallow) index-creation failures.

- **13 · Lifecycle robustness (Medium).** Wall-clock idle watchdog (`main.py:203`, 20 s) kills the process after OS sleep or background-tab heartbeat throttling — taking unsaved modal edits with it (`_formDirty` is only wired to the borrower form, not the payment/penalty/seizing modals). No single-instance guard, so two `.exe`s can open the same `finance.db`. **Fix:** raise the timeout / heartbeat on `visibilitychange`+`pagehide`; detect sleep via a `monotonic()` gap and reset the clock; add a lockfile.

- **L · Robustness nits.** `secrets.compare_digest` raises `TypeError` on a non-ASCII `X-Session-Token` (fails *outside* the try, so a malformed header crashes the request rather than cleanly 403-ing) — wrap it (`main.py:126`). Crash-log `open(log_path, "w")` has no encoding → `UnicodeEncodeError` on Indic-script tracebacks loses the real error — add `encoding="utf-8", errors="replace"` (`main.py:215`). A locked/read-only/corrupt `finance.db` at startup throws straight into the scary crash dialog — wrap `init_db` with a plain-language "data file is locked / move off OneDrive" message (`main.py:181`).

- **✅ Verified safe:** the path-traversal guard in `do_GET` (drive-letter and `..` payloads correctly 404) and the session-token CSRF model are sound for the localhost threat model. The legacy "clear Cash" migration is idempotent. FK cascade on delete works (pragma is set in `connect()`). The batch-insert is atomic (no partial batch on mid-write close).

---

## Frontend JS Robustness

**XSS verdict: clean.** Every reviewer traced the `innerHTML` templates and found `esc()` applied consistently — borrower table, dashboard cards, detail modal, info rows, receipt-match card, datalist options, toasts, custom-filter values, and the PDF export. No exploitable unescaped user data. (`help.js` bodies are injected raw, but they're 100% static authored markup — safe today, worth a "must stay static" comment as a footgun.)

Beyond the criticals (#5, #6) already covered:

- **14 · Modal `await` race (Medium).** `showEditPayment/Penalty/Seizing` set `modal-inner.innerHTML` but never call `openModal()`; they rely on the detail modal already being open. Pressing **Esc** during their `await api('get_borrower_detail')` runs `closeModal()` (hides overlay + clears inner), then the resolved form is written into a now-hidden container and silently lost. Also `detail.payments.find(...)` (`app.js:2114/2174`) and `schedule.map` (`app.js:2670`) aren't null-guarded against an unexpected API shape. **Fix:** call `openModal()` after rendering; guard the result.

- **Stale global state (Medium).** `window._allSummaries` only refreshes when Borrowers renders; a mutation made from a Dashboard-opened detail modal refreshes the *dashboard*, leaving the cached array (used by PDF export + receipt search) momentarily stale (`app.js:657`).

- **Calendar-impossible dates (Low).** Same root as #1 — `parseUserDate` accepts `31-02`; `fmtDate` just slices the string so it round-trips visually with no normalization.

- **Performance (Low, fine at expected scale).** `filterBorrowers` rebuilds the entire `<tbody>` on every keystroke and re-runs the receipt nested-loop; no debounce, no pagination. Acceptable for hundreds of borrowers; revisit if it grows.

---

## Screen-by-Screen UX Review

> Reviewed as if watching a non-technical owner use a ~1280×820 Edge window with hundreds of borrowers.

**Sidebar / Nav (P1)** — Dashboard's 📋 icon reads like "list"; consider 🏠. The brand is hard-wrapped (`Finance<br>Tracker`). **No global search** — you can only search from the Borrowers screen; add a shell-level search that jumps to a borrower from anywhere. No business/shop name anywhere.

**Dashboard (P1)** — Good (clickable cards, phone/vehicle, color-coded), but: the **"Due Today" card actually includes tomorrow** (`d===0||d===1`, `app.js:496`) yet the header+count say "Due Today" → rename to **"Due Today & Tomorrow"**. **No money totals** ("to collect today", "total overdue") on the landing page — the #1 number a collections business wants. The **"Missed — last 10 days"** window silently hides anyone 11+ days overdue — add a "Long overdue (10+)" tile or "View all overdue →" deep-link. **First-run empty DB** shows only two "nothing here" messages — add a "➕ Add your first loan" CTA.

**Borrowers + filters (P1)** — The always-open filter panel (10 fields + flags + a 23-field/4-operator **build-your-own condition engine**) is power-user database tooling that intimidates the target user and pushes the table below the fold. **Collapse it behind a "🔧 Filters (n active)" toggle, closed by default**, show a few quick-filter chips inline, and move the custom builder into an "Advanced" disclosure. **Two side-by-side search boxes** (name vs 🧾 receipt) confuse — typing a receipt in the wrong box returns nothing silently; merge or clearly segment. **No clickable column sorting** (can't sort by who owes most) and **no pagination** (renders all rows). The quick-stats line (overdue count + ₹, due-this-week, active) is genuinely good — keep it.

**New Loan / Edit form (P1)** — **Text-only `dd-mm-yy` date field, no date picker** (repeated in every modal & filter) — error-prone for an older user; add a real `<input type="date">` alongside. Required core (Loan Terms) sits *after* optional Guarantor/Vehicle sections — reorder so the required fields come right after Borrower. The **EMI override bug** (#5) breaks the "override if needed" promise. Validation failures only toast — focus/scroll to the bad field. Good: auto-calc Total Payable, sensible defaults, autocomplete, dirty-check on Cancel.

**Borrower detail modal (P1)** — Packs 15-row info grid + 11-row summary + **7 action buttons** + 3 full tables into one modal; the most-used content (payments) is below the fold on an 820px screen. **"🗑 Delete Borrower" sits right after "✏ Edit"** in the primary action row — easy to misclick (well-protected by double-confirm, but placement invites it). Per-row ✏/🗑 are tiny icon-only `btn-xs`. Consider a full-page detail or tabbed tables, move Delete to a bottom "danger zone", and enlarge/label the row buttons. The PENALTY DUE / PAID LATE alert banner is excellent — keep.

**Add Payment (P1)** — The first thing shown is **"How many payments to add at once? (1–12, custom to 60)"** — a confusing extra decision for the overwhelmingly common "record one payment". Default to a single clean form; demote batch to an "➕ Add another payment" button. Payment-mode chips (Cash/PhonePe/Scanner) are friendly and clear.

**Portfolio (P2)** — ~20 stacked blocks with real duplication: collection % appears in two near-identical progress bars; total payable repeats 3+ times; penalties and seizing each get a near-empty full-width card. Lead with 3–4 headline KPIs (Capital out · Collected · Outstanding · Overdue) and tuck the rest behind sections/tabs. The month selector, 6-month trend, and by-showroom table are worth keeping.

**Help (P1)** — 7 languages is excellent, but the **"Filter options" section describes a UI that no longer exists** — it says "Custom overdue → anyone meeting **either** threshold" while the real panel **ANDs** every condition (`help.js:94–104` vs `app.js:712`). It also never mentions receipt search, payment modes, seizing money, PDF export, or the delete password. Rewrite and re-sync all 7 languages.

**Settings (P1)** — Only sets the delete password. Meanwhile backup is described as critical everywhere but is **fully manual** (close app, find `finance.db`, copy to USB). **Add an in-app "Backup now" / "Restore" button** — the single biggest data-safety gap for a non-technical owner. Also add a **Text-size** control (Normal/Large/Extra-large) and an optional **business name**.

**Terminology (P2):** mixed — "O/D" vs "Overdue", "EMI" vs "Installment" vs "Monthly Installment", "Principal" (table) vs "Loan amount" (form/filter). Pick one term per concept.

---

## Visual / CSS / Accessibility

**Top 3 for this user:**
1. **Text is too small & muted grays fail contrast.** 14 font sizes in use (11–28px, several 0.5px apart); 11/11.5/12px muted text is hard for an older reader. `--text-muted #64748b` is ~4.5:1 (borderline, fails on the light-gray backgrounds it often sits on); `#94a3b8` and placeholder `#a1afc0` as text are ~2.9:1 and ~2.5:1 — **fail WCAG AA**. Darken muted text to ~`#475569`, raise the font floor to 12–13px, bump body to 15px, and **express sizes in `rem`** so a "Large text" toggle (and OS zoom) actually works.
2. **Keyboard focus is invisible** on every `.btn`, `.nav-item`, `.modal-close`, `.mode-chip`, and nav `<a>` (only inputs get a ring). Add a global `:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }` (+ a light variant for the dark sidebar). Rows/dashboard cards are also mouse-only (`onclick` on `<tr>`/`<div>`, no `tabindex`/Enter).
3. **No responsive or display-scaling safety net.** Zero `@media` queries; fixed 210px sidebar; `body{overflow:hidden;height:100vh}` clips any overflow with no scroll recovery. At the **125%/150% Windows scaling this user is likely to choose**, the rigid 3-/4-column stat grids and `repeat(4,1fr)` portfolio cards cramp and clip large rupee figures. Add one breakpoint (`@media (max-width:1100px)`) collapsing grids and convert px→rem.

**Other:**
- **"Advance" and "On time" share the same green badge** (`app.js:109`) though they're different states — map Advance to the (currently unused) `badge-primary` blue. "Closed" uses three different ad-hoc purples (`#7c3aed`, `#6b21a8`) outside the variable system — add a `--violet` token.
- **95 inline `style="…"` blocks in app.js** duplicate the scale (e.g. `font-size:22px` repeated ~12×; `grid-template-columns:repeat(3,1fr)` re-declared when `.stat-grid` already has it; portfolio progress bars hand-built inline while the `.progress-wrap`/`.progress-bar` classes sit **unused**). Extract `.stat-value--sm`, `.flex-between`, and reuse `.progress`. This is also the main blocker to ever shipping a dark mode (which is a reasonable gap for an all-day all-white app).
- **Modal action bar scrolls away** with content — make `.detail-actions` `position:sticky; bottom:0`.
- **Magic-number scroll heights** (`calc(100vh - 235px)`, `calc(100vh - 200px)`) break when filters wrap to a second row — prefer flex `min-height:0`.
- **Emoji-as-icons** render inconsistently across Windows builds and mix with text glyphs (`⚙`,`⟳`) — fine for a personal tool, but inline SVGs would be more robust/professional.
- **Orphan CSS to delete (~25 lines):** `.progress-wrap`/`.progress-bar`(+variants), `.btn-ghost`, `.badge-warning`, `.dash-hint`, `.empty-state`(+children), `.total-owed-row`(+children), `.pick-date-input`. **Repurpose** `.badge-primary` for "Advance" and **revive** `.progress-wrap` to replace the inline portfolio bars.

---

## Suggested Features to ADD

1. **In-app Backup / Restore** (Settings) — highest-value safety feature; backup is currently fully manual.
2. **Print a single-borrower statement** — reuse `borrowerPdfCard` behind a "🖨 Print statement" button in the detail modal (today only the bulk list exports).
3. **WhatsApp / SMS reminder link** — a `wa.me/<phone>` or `sms:` link on each due/overdue card, prefilled with the amount due. High value for an Indian collections business; phone numbers are already captured.
4. **Global search** from any screen.
5. **Text-size control** and optional **business name** in Settings.
6. **Undo for deletes** — the toast already supports an action button; add a 5-second "Undo" on payment/penalty/seizing deletes.
7. **Photos** of vehicle / RC / documents per borrower (stored locally next to the DB).
8. **Dashboard money totals** ("to collect today", overdue total) + a long-overdue tile.

## Things to REMOVE / SIMPLIFY

- The **custom-condition builder** on Borrowers (23 fields × 4 operator families) → hide behind "Advanced" or remove; the preset dropdowns cover real needs.
- **Two side-by-side search boxes** → merge / segment.
- **Portfolio duplication** → consolidate the two progress bars and the two penalty/seizing cards; roughly halve the block count, detail behind a tab.
- The **1–12 / custom-60 payment-count selector as the first field** → single-payment by default.

---

## Appendix — File / Severity Index

| Area | File | Headline findings |
|------|------|-------------------|
| Entry / server | `main.py` | Traceback leak (152), idle-kill on sleep (203), `compare_digest` TypeError (126), crash-log encoding (215), unguarded `init_db` (181) |
| API | `api.py` | Non-finite amounts (264/333/387), delete-password not enforced (230/346/370/399), missing-key `KeyError`s, CSV injection (619), read endpoints lack try/except |
| DB | `db.py` | Connection-close leak + no busy_timeout (112), uniqueness index silently skipped (163), TOCTOU on conflict checks |
| Domain logic | `models.py` | Date crash via `parse_date` (11/184), reopen no-op via OR (132), period-scaled `rounding_tol` (131), month-end schedule mismatch (116–128) |
| Frontend | `web/app.js` | `parseUserDate` accepts impossible dates (137), dead `userEdited` guard (1650), blank-screen on API error (295/482/587/2410), modal `await` race (2112/2172/2281), stuck Save button (1657) |
| Help | `web/help.js` | Filter docs contradict the real UI (94–104); missing entries for shipped features |
| Styles | `web/style.css` | Contrast failures (19/23/269), no focus ring on buttons/nav, no responsive/`rem`, orphan classes, 0.5px size noise |

*The two highest-leverage fixes (real calendar-date validation client+server, and a `math.isfinite(x) and x>0` amount validator + `allow_nan=False`), plus making per-row summary computation resilient, eliminate the whole-app crash and data-corruption classes that most threaten the "nothing ever breaks" goal.*

---

## Resolution Log — fixes applied (2026-06-15)

All items above were implemented and verified (Python compiles + imports; `node --check` on JS; backend functional tests; and an end-to-end HTTP test of page-serve, token auth, and API JSON). A safety copy of `finance.db` was taken before the schema migration ran and the migration was confirmed working.

**🔴 Must-fix — all done**
1. **Feb-31 crash** — `parseUserDate` now round-trips through a real `Date` (rejects impossible dates); `api.py` validates every date server-side; `models.compute_summary`/`payment_schedule` degrade a bad stored date to today instead of throwing, so one bad row can no longer take down the list.
2. **NaN/Inf/negative amounts** — shared `_clean_amount()` (finite + > 0) on every write path; `json.dumps(..., allow_nan=False)` with a clean 400 instead of invalid JSON.
3. **Delete-password** — now enforced **server-side** via `_delete_guard()` on `delete_borrower/payment/penalty/seizing`; the entered password is forwarded from the browser.
4. **Reopen no-op** — added a `reopened` column (migrated); auto-close no longer overrides a deliberately re-opened loan. Verified: close→Closed, reopen→Active.
5. **EMI override** — `dataset.userEdited` is now set on manual edit and preserved on edit-load, so a custom EMI is no longer clobbered.
6. **Blank screen** — `navigate()` wraps renders in try/catch and shows a Retry card; the Save button is restored if the save call throws.

**🟠 Should-fix — all done**
7. Month-end schedule unified via `_installments_due_by()` (shared by overdue + schedule). 8. Fixed ₹2 rounding tolerance. 9. `busy_timeout=5000` + connection `timeout`. 10. Tracebacks logged locally, generic error to client. 11. CSV formula-injection neutralised (`_csv_safe`). 12. `IntegrityError`→friendly messages. 13. Idle watchdog now detects OS sleep (monotonic gap) + visibility heartbeats; timeout 30s. 14. Edit modals call `openModal()` + null-guards. 15. Help filter section rewritten (English) to match the real ANDed panel + a new "More features" section.

**🟡 UX / visual / features — done**
Dashboard (totals strip, "Due Today & Tomorrow", long-overdue link, first-run CTA, WhatsApp reminders); Borrowers (collapsible filters, clickable column sort); Add Payment (single-by-default + "Add another"); New Loan (Loan Terms moved up, focus-first-invalid, 📅 date pickers); Detail modal (Delete moved to a danger zone, bigger row buttons, single-borrower Print, Remind); Portfolio (duplicated cards/bars consolidated); Settings (Backup, Text size, Business name); global sidebar search; Undo on payment/penalty/seizing deletes; CSS (AA-contrast muted text, 15px base, visible focus ring, `Advance`=blue badge, `--violet` for Closed, sticky modal actions, a responsive breakpoint, text-size zoom).

**Deferred (deliberately, low value / high risk):** full `px→rem` conversion and dark mode (text-size zoom covers the readability need); per-borrower photo attachments (needs file-upload infrastructure); table virtualization/pagination (current scale is fine); re-syncing the 6 non-English Help translations for the rewritten filter section (the English — the one the audit quoted — is corrected; machine-translating financial instructions into 6 Indic languages would risk introducing errors worse than a slightly-stale translation, so this should be done by a native speaker). Orphan CSS classes were left in place (harmless) except where repurposed (`.empty-state`, `.badge-primary` are now used).
