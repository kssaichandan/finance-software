'use strict';

// ── State ────────────────────────────────────────────────────────
let currentView = 'dashboard';
let searchQuery = '';      // each typed word must match name/father/guarantor/place/showroom/phone/vehicle/book ref
let receiptQuery = '';     // matches receipt numbers (separate input in toolbar)

// ── Borrowers-list filter panel ──────────────────────────────────
// Every section below is ANDed together (plus the search + receipt boxes).
// Empty / 'any' values mean "no constraint for this section".
function defaultFilters() {
  return {
    status: 'everything',   // everything | active | closed
    standing: 'any',        // any | overdue | ontime | advance
    overdue: 'any',         // any | d30 | d60 | d90 | a1k | a5k | custom
    overdueDaysMin: '',     // custom: min days overdue
    overdueAmtMin: '',      // custom: min overdue ₹
    due: 'any',             // any | today | tomorrow | d3 | d7 | within | pick
    pickDate: '',           // ISO yyyy-mm-dd, used when due === 'pick'
    dueWithin: '',          // custom: due within N days, used when due === 'within'
    hasPenalty: false,
    hasSeizing: false,
    place: '',              // exact match on address
    showroom: '',
    vehicleType: '',
    amountMin: '', amountMax: '',
    dateFrom: '', dateTo: '',   // loan-date range (ISO)
    custom: [],             // [{field, op, value}] — build-your-own, all ANDed
  };
}
let filters = defaultFilters();

// Fields the build-your-own custom filter can target. type drives which
// operators + value input are shown. All keys must exist on a summary object.
const CUSTOM_FIELDS = [
  { key: 'name',              label: 'Name',                type: 'text' },
  { key: 'father_name',       label: 'Father name',         type: 'text' },
  { key: 'guarantor_name',    label: 'Guarantor name',      type: 'text' },
  { key: 'address',           label: 'Place / address',     type: 'text' },
  { key: 'showroom',          label: 'Showroom',            type: 'text' },
  { key: 'vehicle_type',      label: 'Vehicle type',        type: 'text' },
  { key: 'vehicle_no',        label: 'Vehicle no',          type: 'text' },
  { key: 'phone',             label: 'Phone',               type: 'text' },
  { key: 'book_ref',          label: 'Book / S.No',         type: 'text' },
  { key: 'loan_amount',       label: 'Loan amount (₹)',     type: 'number' },
  { key: 'total_payable',     label: 'Total payable (₹)',   type: 'number' },
  { key: 'total_paid',        label: 'Total paid (₹)',      type: 'number' },
  { key: 'remaining',         label: 'Remaining (₹)',       type: 'number' },
  { key: 'overdue_amount',    label: 'Overdue amount (₹)',  type: 'number' },
  { key: 'days_overdue',      label: 'Days overdue',        type: 'number' },
  { key: 'total_penalties',   label: 'Penalty total (₹)',   type: 'number' },
  { key: 'total_seizings',    label: 'Seizing total (₹)',   type: 'number' },
  { key: 'interest_rate',     label: 'Interest rate (%)',   type: 'number' },
  { key: 'period_months',     label: 'Period (months)',     type: 'number' },
  { key: 'months_elapsed',    label: 'Months elapsed',      type: 'number' },
  { key: 'loan_date',         label: 'Loan date',           type: 'date' },
  { key: 'last_payment_date', label: 'Last payment date',   type: 'date' },
  { key: 'status_label',      label: 'Status',              type: 'enum',
    options: ['Overdue', 'On time', 'Advance', 'Closed'] },
];
const CUSTOM_OPS = {
  text:   [['contains', 'contains'], ['not_contains', 'does not contain'], ['equals', 'is exactly']],
  number: [['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['eq', '='], ['neq', '≠']],
  date:   [['on', 'on'], ['before', 'before'], ['after', 'after']],
  enum:   [['equals', 'is'], ['neq', 'is not']],
};

let _viewDirty = false;   // set by mutating ops; closeModal refreshes only if true
let _formDirty = false;   // set by typing in a form; Cancel warns only if true
let _filtersOpen = false;          // Borrowers filter panel starts collapsed
let _sortKey = null, _sortDir = 1; // Borrowers table column sort (1=asc, -1=desc)
let _selectedIds = new Set();      // Borrowers ticked for a selective PDF export

// ── Utilities ────────────────────────────────────────────────────
function money(v) {
  v = Math.round(parseFloat(v) || 0);
  const neg = v < 0;
  v = Math.abs(v);
  const s = String(v);
  let result;
  if (s.length <= 3) {
    result = s;
  } else {
    const last3 = s.slice(-3);
    let rest = s.slice(0, -3);
    const chunks = [];
    while (rest.length > 2) { chunks.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
    if (rest) chunks.unshift(rest);
    result = chunks.join(',') + ',' + last3;
  }
  return (neg ? '-' : '') + '₹' + result;
}

// Format an installment count: whole numbers plain, otherwise 1 decimal.
function fmtInst(n) {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// "5 paid · 7 left" — installments done vs remaining, based on money paid.
function installmentText(s) {
  const emi = s.installment_amount || 0;
  const period = s.period_months || 0;
  if (emi <= 0 || period <= 0) return '—';
  const doneRaw = (s.total_paid || 0) / emi;
  const done = Math.min(doneRaw, period);            // never more than the full period
  const left = Math.max(0, period - doneRaw);        // never below zero
  return `<span class="inst-done">${fmtInst(done)} paid</span>`
       + `<span class="inst-sep"> · </span>`
       + `<span class="inst-left">${fmtInst(left)} left</span>`;
}

function badge(status) {
  const map = {
    'Overdue': 'danger', 'On time': 'success', 'Advance': 'primary',
    'Closed': 'gray',
  };
  return `<span class="badge badge-${map[status] || 'gray'}">${status}</span>`;
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Convert "YYYY-MM-DD" → "DD-MM-YY" for display. Leaves anything else untouched.
function fmtDate(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
  if (!m) return String(s);
  return `${m[3]}-${m[2]}-${m[1].slice(2)}`;
}

// Today as "dd-mm-yy" for prefilling date inputs.
function todayDDMMYY() {
  const t = new Date();
  const d = String(t.getDate()).padStart(2, '0');
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const y = String(t.getFullYear()).slice(2);
  return `${d}-${m}-${y}`;
}

// Parse user-typed "dd-mm-yy" / "dd-mm-yyyy" / "dd/mm/yy" → "YYYY-MM-DD" or null.
function parseUserDate(s) {
  if (!s) return null;
  const m = /^\s*(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\s*$/.exec(String(s));
  if (!m) return null;
  let d = parseInt(m[1], 10), mo = parseInt(m[2], 10), y = parseInt(m[3], 10);
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1900 || y > 2100) return null;
  // Reject impossible calendar dates like 31-02 — the Date must round-trip.
  // A bad date stored as a loan_date used to crash the entire borrowers list.
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// Live validation for date text inputs — red border the moment the value is invalid.
function validateDateInput(el) {
  const ok = !el.value.trim() || parseUserDate(el.value) !== null;
  el.classList.toggle('input-invalid', !ok);
}

// Open the OS calendar for the dd-mm-yy text input that sits beside the 📅
// button, and write the chosen date back in dd-mm-yy form.
function openDatePicker(btn) {
  const target = btn.parentElement && btn.parentElement.querySelector('input[type="text"]');
  if (!target) return;
  let dp = document.getElementById('_hidden-datepicker');
  if (!dp) {
    dp = document.createElement('input');
    dp.type = 'date';
    dp.id = '_hidden-datepicker';
    dp.style.position = 'fixed';
    dp.style.left = '-9999px';
    dp.style.top = '0';
    document.body.appendChild(dp);
  }
  dp.value = parseUserDate(target.value) || '';
  dp.onchange = () => {
    if (dp.value) {
      target.value = fmtDate(dp.value);
      validateDateInput(target);
      _formDirty = true;
    }
  };
  try {
    if (typeof dp.showPicker === 'function') dp.showPicker();
    else { dp.focus(); dp.click(); }
  } catch (e) { dp.focus(); dp.click(); }
}

function loading(show) {
  document.getElementById('loader').classList.toggle('hidden', !show);
}

function toast(msg, type = 'info', action = null) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  let actionHTML = '';
  if (action && action.label && typeof action.onClick === 'function') {
    actionHTML = `<button class="toast-action">${esc(action.label)}</button>`;
  }
  el.innerHTML = `<span>${icons[type]}</span><span class="toast-msg">${esc(msg)}</span>${actionHTML}`;
  document.getElementById('toasts').appendChild(el);
  if (action && action.onClick) {
    const btn = el.querySelector('.toast-action');
    if (btn) btn.addEventListener('click', () => { action.onClick(); el.remove(); });
  }
  // Toasts with an action stay longer so the user has time to click.
  const ttl = action ? 8000 : 3200;
  setTimeout(() => {
    el.style.animation = 'slide-out 0.2s ease forwards';
    setTimeout(() => el.remove(), 200);
  }, ttl);
}

// Show an API error toast. If the result has conflict_borrower_id, the toast
// gets a "View →" button that closes any open modal and jumps to that borrower.
function showApiError(result, fallback = 'unknown error') {
  const msg = (result && result.error) || fallback;
  if (result && result.conflict_borrower_id) {
    toast(msg, 'error', {
      label: 'View →',
      onClick: () => {
        try { closeModal(); } catch (_) {}
        navigate('borrowers');
        setTimeout(() => showDetail(result.conflict_borrower_id), 60);
      },
    });
  } else {
    toast('Error: ' + msg, 'error');
  }
}

async function api(method, ...args) {
  try {
    const res = await fetch('/api/' + method, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Token': window.SESSION_TOKEN || '',
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err);
    }
    return await res.json();
  } catch (e) {
    toast(`API error: ${e.message || e}`, 'error');
    throw e;
  }
}

// ── Date helpers ─────────────────────────────────────────────────
function jsAddMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const tm = (m - 1) + n;
  const yr = y + Math.floor(tm / 12);
  const mo = (tm % 12) + 1;
  const last = new Date(yr, mo, 0).getDate();
  return `${yr}-${String(mo).padStart(2,'0')}-${String(Math.min(d, last)).padStart(2,'0')}`;
}

function nextDueDateFor(s) {
  if (s.closed) return null;
  const next = s.expected_installments + 1;
  if (next > s.period_months) return null;
  return jsAddMonths(s.loan_date, next);
}

// Whole months from one YYYY-MM-DD date to another (same day-of-month rule).
function jsMonthsElapsed(fromStr, toStr) {
  const [fy, fm, fd] = fromStr.split('-').map(Number);
  const [ty, tm, td] = toStr.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return Math.max(0, months);
}

// Render 3 selectable radio chips for payment mode. `name` must be unique within
// the form (use a per-block suffix in the multi-payment add form).
const PAYMENT_MODES = [
  { value: 'Cash',    icon: '💵', label: 'Cash' },
  { value: 'PhonePe', icon: '📱', label: 'PhonePe' },
  { value: 'Scanner', icon: '📷', label: 'Scanner' },
];
function modeIconFor(v) {
  const m = PAYMENT_MODES.find(x => x.value === v);
  return m ? m.icon : '';
}
// Compact pill for use inside the payments table — only shown if a mode is set.
function modePill(v) {
  if (!v) return '';   // no mode -> nothing rendered
  const slug = v.toLowerCase();
  return `<span class="mode-pill mode-${esc(slug)}">${modeIconFor(v)} ${esc(v)}</span>`;
}
function modeChips(name, current) {
  const cur = current || '';   // empty -> no chip pre-selected
  return `<div class="mode-chips">${PAYMENT_MODES.map(m => `
    <label class="mode-chip ${m.value === cur ? 'checked' : ''}">
      <input type="radio" name="${esc(name)}" value="${m.value}" ${m.value === cur ? 'checked' : ''}
        onchange="this.closest('.mode-chips').querySelectorAll('.mode-chip').forEach(el => el.classList.remove('checked')); this.closest('.mode-chip').classList.add('checked');" />
      <span>${m.icon} ${m.label}</span>
    </label>`).join('')}</div>`;
}

// Cached distinct showroom names, for the optional per-payment showroom picker.
let _showroomOpts = null;
async function ensureShowroomOpts() {
  if (_showroomOpts) return _showroomOpts;
  try {
    const sug = await api('get_suggestions');
    _showroomOpts = (sug && sug.showroom) || [];
  } catch (_) { _showroomOpts = []; }
  return _showroomOpts;
}
function showroomDatalistHtml(id) {
  return `<datalist id="${id}">${(_showroomOpts || []).map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`;
}

// True if a borrower has a penalty situation — either PENALTY DUE (loan still
// running past its period with money owed) or PAID LATE (cleared after the
// loan period). Same logic as the badge shown in the borrower detail page.
function hasPenalty(s) {
  if (!s.loan_date || !s.period_months) return false;
  const lastDue = jsAddMonths(s.loan_date, s.period_months);
  const todayStr = new Date().toISOString().split('T')[0];
  if (!s.closed && s.remaining > 0.01 && todayStr > lastDue) return true;   // PENALTY DUE
  if (s.last_payment_date && s.last_payment_date > lastDue) return true;    // PAID LATE
  return false;
}

// True if any seizing money has been recorded against this borrower.
function hasSeizing(s) {
  return (s.total_seizings || 0) > 0.001;
}

// ── WhatsApp / SMS reminders ─────────────────────────────────────
// Build a wa.me click-to-chat link. Assumes Indian numbers (prepends 91 to a
// bare 10-digit number). Returns null if there's no usable number.
function waHref(phone, text) {
  const digits = (phone || '').toString().replace(/\D/g, '');
  if (digits.length < 10) return null;
  const num = digits.length === 10 ? '91' + digits : digits;
  return `https://wa.me/${num}?text=${encodeURIComponent(text || '')}`;
}
// Opens WhatsApp with a polite prefilled reminder. `amountText` is already a
// money() string. Values come from data-* attributes so names with quotes are safe.
function openWhatsApp(phone, name, amountText, kind) {
  const biz = (window.BUSINESS_NAME || '').trim();
  const sign = biz ? `\n— ${biz}` : '';
  const msg = kind === 'overdue'
    ? `Namaste ${name}, your payment of ${amountText} is overdue. Kindly clear it at the earliest. Thank you.${sign}`
    : `Namaste ${name}, a gentle reminder that your installment of ${amountText} is due. Thank you.${sign}`;
  const href = waHref(phone, msg);
  if (!href) { toast('No valid 10-digit phone number for this borrower.', 'error'); return; }
  window.open(href, '_blank');
}
function remindFromBtn(btn) {
  openWhatsApp(btn.dataset.phone, btn.dataset.name, btn.dataset.amt, btn.dataset.kind);
}

// Jump to the Borrowers list pre-filtered to everyone overdue.
function gotoOverdue() {
  filters = defaultFilters();
  filters.standing = 'overdue';
  navigate('borrowers');
}

// Global search (sidebar) — open the Borrowers list filtered to the typed text.
function globalSearchGo(v) {
  searchQuery = (v || '').trim();
  navigate('borrowers');
}

// ── Navigation ───────────────────────────────────────────────────
async function navigate(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  const container = document.getElementById('view');
  container.innerHTML = '';
  try {
    if (view === 'dashboard') await renderDashboard();
    else if (view === 'borrowers') await renderBorrowers();
    else if (view === 'add') renderAddBorrower();
    else if (view === 'portfolio') await renderPortfolio();
    else if (view === 'help') renderHelp();
    else if (view === 'settings') await renderSettings();
  } catch (e) {
    // Never leave a blank white pane — show a retry card instead.
    loading(false);
    renderErrorState(e && e.message);
  }
}

// Friendly full-screen fallback when a view fails to load (server hiccup,
// just-shut-down, etc.). Always offers a Retry instead of a blank screen.
function renderErrorState(msg) {
  const v = document.getElementById('view');
  if (!v) return;
  v.innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">⚠️</div>
      <h3>Couldn't load this screen</h3>
      <p>The app couldn't reach its data just now. This usually fixes itself.</p>
      <button class="btn btn-primary" style="margin-top:14px" onclick="refreshCurrentView()">⟳ Retry</button>
    </div>`;
}

// ── Password protection (v1.29) ──────────────────────────────────
// _hasPassword is the cached server state. We refresh it on app load and
// after any Settings action so the delete flow knows whether to prompt.
let _hasPassword = false;
async function refreshHasPassword() {
  try {
    const r = await api('has_password');
    _hasPassword = !!(r && r.has_password);
  } catch (_) { _hasPassword = false; }
  return _hasPassword;
}

// requirePasswordThen — show a password prompt before running `action`.
// If no password is set, falls back to a normal confirm() with `confirmMsg`.
// `description` is interpolated into the prompt: "This will delete <description>"
// Calls action(password) once the user confirms. The password is forwarded to
// the server so the delete is enforced there too (the server independently
// re-checks it — the browser gate alone is not trusted).
function requirePasswordThen(description, confirmMsg, action, opts) {
  opts = opts || {};
  const title = opts.title || '🔐 Confirm with Password';
  const btnLabel = opts.btnLabel || 'Confirm Delete';
  const btnClass = opts.btnClass || 'btn-danger';
  if (!_hasPassword) {
    if (!confirm(confirmMsg)) { if (opts.onCancel) opts.onCancel(); return; }
    action('');
    return;
  }
  window._pwOnCancel = opts.onCancel || null;
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3>${title}</h3>
        <button class="modal-close" onclick="pwCancel()">✕</button>
      </div>
      <p style="margin:0 0 14px;color:var(--text)">${esc(description)}</p>
      <form id="pw-prompt-form">
        <div class="form-group">
          <label>Password <span class="req">*</span></label>
          <input class="form-control" id="pw-prompt-input" type="password"
            autocomplete="current-password" placeholder="Enter your password" />
          <div class="form-hint" id="pw-prompt-error" style="color:var(--danger);margin-top:6px;display:none">Wrong password.</div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn ${btnClass}">${btnLabel}</button>
          <button type="button" class="btn btn-outline" onclick="pwCancel()">Cancel</button>
        </div>
      </form>
    </div>`;
  openModal();
  const input = document.getElementById('pw-prompt-input');
  setTimeout(() => input && input.focus(), 50);
  document.getElementById('pw-prompt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pwd = input.value;
    const r = await api('verify_password', pwd);
    if (r && r.success) {
      window._pwOnCancel = null;
      closeModal();
      action(pwd);
    } else {
      const errEl = document.getElementById('pw-prompt-error');
      if (errEl) errEl.style.display = '';
      input.value = '';
      input.focus();
    }
  });
}

async function renderSettings() {
  await refreshHasPassword();
  let s = { business_name: '', text_size: 'normal', autobackup_enabled: false, autobackup_dir: '' };
  try { s = await api('get_settings'); } catch (_) {}
  let detected = { folders: [] };
  try { detected = await api('detect_sync_folders'); } catch (_) {}
  let abStatus = {};
  try { abStatus = await api('autobackup_status'); } catch (_) {}

  const appCard = `
    <div class="card" style="padding:18px;margin-bottom:18px">
      <h3 style="margin-top:0">🏪 Business &amp; Display</h3>
      <div class="form-group" style="margin-bottom:16px">
        <label>Business / Shop Name <span style="color:var(--text-muted);font-weight:400">(shown in the sidebar &amp; on printouts)</span></label>
        <input class="form-control" id="set-business-name" maxlength="60" value="${esc(s.business_name || '')}" placeholder="e.g. Sri Lakshmi Finance" />
        <button type="button" class="btn btn-sm btn-outline" style="margin-top:8px;align-self:flex-start" onclick="saveBusinessName()">Save name</button>
      </div>
      <div class="form-group">
        <label>Text Size <span style="color:var(--text-muted);font-weight:400">(makes everything bigger)</span></label>
        <div class="text-size-options">
          ${[['normal','Normal'],['large','Large'],['xlarge','Extra Large']].map(([sz,lbl]) => `
            <label class="size-opt ${s.text_size===sz?'checked':''}">
              <input type="radio" name="text_size" value="${sz}" ${s.text_size===sz?'checked':''} onchange="applyTextSize('${sz}', true)" />
              <span>${lbl}</span>
            </label>`).join('')}
        </div>
      </div>
    </div>`;

  const backupCard = `
    <div class="card" style="padding:18px;margin-bottom:18px">
      <h3 style="margin-top:0">💾 Backup</h3>
      <p style="color:var(--text-muted);margin:0 0 14px">Save a complete copy of all your data to your <b>Downloads</b> folder, then copy it to a USB drive or Google Drive / OneDrive. Do this regularly.</p>
      <button type="button" class="btn btn-primary" onclick="doBackup()">💾 Back up now</button>
      <p style="color:var(--text-muted);font-size:12.5px;margin:12px 0 0">To restore on another PC: close the app, copy your backup file into the app's folder and rename it to <code>finance.db</code>, then start the app.</p>
    </div>`;

  const folderBtns = (detected.folders || []).map(f => {
    const target = f.path + '\\FinanceTracker Backups';
    return `<button type="button" class="btn btn-sm btn-outline" data-path="${esc(target)}" onclick="pickAutobackupFolder(this)">📁 ${esc(f.label)}</button>`;
  }).join('') || '<span style="color:var(--text-muted);font-size:12.5px">No OneDrive / Google Drive folder detected — paste a folder path below.</span>';

  const statusLine = (abStatus && abStatus.when)
    ? (abStatus.ok
        ? `<div class="ab-status ok">✓ Last auto-backup: ${esc(abStatus.when)}</div>`
        : `<div class="ab-status err">⚠ Last auto-backup failed: ${esc(abStatus.error || 'unknown')}</div>`)
    : '';

  const autoBackupCard = `
    <div class="card" style="padding:18px;margin-bottom:18px">
      <h3 style="margin-top:0">🔄 Auto-backup to cloud</h3>
      <p style="color:var(--text-muted);margin:0 0 14px">
        After every change, a safe copy is written into a folder you choose. Point it at your
        <b>OneDrive</b> or <b>Google Drive</b> folder and it uploads to the cloud automatically —
        no manual copying. A dated copy is also kept each day so you can roll back.
      </p>
      <label style="display:flex;align-items:center;gap:8px;margin-bottom:14px;cursor:pointer;font-size:14px;font-weight:500">
        <input type="checkbox" id="ab-enabled" ${s.autobackup_enabled ? 'checked' : ''} style="width:17px;height:17px;accent-color:var(--primary)" onchange="saveAutobackup()" />
        <span>Turn on automatic backup (after every change)</span>
      </label>
      <div class="form-group" style="margin-bottom:10px">
        <label>Backup folder</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">${folderBtns}</div>
        <input class="form-control" id="ab-dir" value="${esc(s.autobackup_dir || '')}"
          placeholder="e.g. C:\\Users\\you\\OneDrive\\FinanceTracker Backups" />
        <span class="form-hint">Tip: choose a folder inside OneDrive / Google Drive so it syncs to the cloud.</span>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" onclick="saveAutobackup()">Save folder</button>
        <button type="button" class="btn btn-outline" onclick="runAutobackupNow()">Back up now</button>
      </div>
      <p class="form-hint" style="margin-top:8px">The on/off switch saves by itself. Use “Save folder” only after changing the folder path.</p>
      ${statusLine}
    </div>`;

  const setForm = `
    <form id="set-password-form" class="card" style="padding:18px">
      <h3 style="margin-top:0">${_hasPassword ? '🔐 Change Delete Password' : '🔐 Set Delete Password'}</h3>
      ${_hasPassword
        ? `<p style="color:var(--text-muted);margin:0 0 14px">A password is currently required before any delete. To change it, enter your current password and the new one.</p>`
        : `<p style="color:var(--text-muted);margin:0 0 14px">Set a password to require confirmation before deleting any borrower, payment, penalty, or seizing entry.</p>`}
      ${_hasPassword ? `
        <div class="form-group">
          <label>Current Password <span class="req">*</span></label>
          <input class="form-control" name="current_password" type="password" autocomplete="current-password" required />
        </div>` : ''}
      <div class="form-group">
        <label>New Password <span class="req">*</span> <span style="color:var(--text-muted);font-weight:400">(at least 4 characters)</span></label>
        <input class="form-control" name="new_password" type="password" autocomplete="new-password" minlength="4" required />
      </div>
      <div class="form-group">
        <label>Confirm New Password <span class="req">*</span></label>
        <input class="form-control" name="confirm_password" type="password" autocomplete="new-password" minlength="4" required />
      </div>
      <button type="submit" class="btn btn-primary">${_hasPassword ? 'Update Password' : 'Set Password'}</button>
    </form>`;

  const resetCard = _hasPassword ? `
    <div class="card" style="padding:18px;margin-top:18px;border-color:var(--danger)">
      <h3 style="margin-top:0;color:var(--danger)">⚠ Forgot your password?</h3>
      <p style="color:var(--text-muted);margin:0 0 14px">
        This resets the delete password completely. Anyone with access to this PC can do it — it's a no-questions-asked escape hatch.
        Your loan data is <strong>not</strong> affected, only the password.
      </p>
      <button class="btn btn-danger" onclick="resetPasswordFlow()">Reset Password (no recovery)</button>
    </div>` : '';

  document.getElementById('view').innerHTML = `
    <div class="page-header">
      <h2>⚙ Settings</h2>
      <p style="color:var(--text-muted);margin:4px 0 0">Local app preferences and security.</p>
    </div>
    <div style="max-width:560px">
      ${appCard}
      ${backupCard}
      ${autoBackupCard}
      ${setForm}
      ${resetCard}
    </div>`;

  document.getElementById('set-password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const np = (fd.get('new_password') || '').toString();
    const cp = (fd.get('confirm_password') || '').toString();
    if (np !== cp) { toast('New password and confirmation do not match.', 'error'); return; }
    const r = await api('set_password', np, fd.get('current_password') || '');
    if (r && r.success) {
      toast(_hasPassword ? 'Password updated.' : 'Password set — deletes are now protected.', 'success');
      await refreshHasPassword();
      renderSettings();
    } else {
      toast('Error: ' + (r && r.error || 'unknown'), 'error');
    }
  });
}

async function resetPasswordFlow() {
  if (!confirm('Reset the delete password? Anyone using this PC can do this. Your loan data stays intact.')) return;
  if (!confirm('Really reset? This is irreversible.')) return;
  const r = await api('reset_password');
  if (r && r.success) {
    toast('Password removed. Deletes are no longer protected.', 'success');
    await refreshHasPassword();
    renderSettings();
  } else {
    toast('Error: ' + (r && r.error || 'unknown'), 'error');
  }
}

// ── Business name + text size + backup ───────────────────────────
async function saveBusinessName() {
  const el = document.getElementById('set-business-name');
  const v = el ? el.value : '';
  const r = await api('set_setting', 'business_name', v);
  if (r && r.success) {
    window.BUSINESS_NAME = (v || '').trim();
    applyBusinessName();
    toast('Business name saved.', 'success');
  } else {
    toast('Error: ' + (r && r.error || 'unknown'), 'error');
  }
}

function applyBusinessName() {
  const el = document.querySelector('.brand-name');
  if (el) {
    el.innerHTML = (window.BUSINESS_NAME && window.BUSINESS_NAME.trim())
      ? esc(window.BUSINESS_NAME) : 'Finance<br>Tracker';
  }
}

async function applyTextSize(sz, persist) {
  document.documentElement.setAttribute('data-text-size', sz || 'normal');
  document.querySelectorAll('.size-opt').forEach(el => {
    const inp = el.querySelector('input');
    el.classList.toggle('checked', inp && inp.value === sz);
  });
  if (persist) { try { await api('set_setting', 'text_size', sz); } catch (_) {} }
}

async function doBackup() {
  loading(true);
  let r;
  try { r = await api('backup_db'); }
  catch (e) { return; }
  finally { loading(false); }
  if (r && r.success) toast('Backup saved → ' + r.path, 'success');
  else toast('Backup failed: ' + (r && r.error || 'unknown'), 'error');
}

// ── Auto-backup to a cloud-synced folder ─────────────────────────
function pickAutobackupFolder(btn) {
  const dir = document.getElementById('ab-dir');
  if (dir) dir.value = btn.dataset.path;
}

async function saveAutobackup() {
  const cb = document.getElementById('ab-enabled');
  const on = !!(cb && cb.checked);
  const dirEl = document.getElementById('ab-dir');
  const folder = ((dirEl && dirEl.value) || '').trim();
  if (on && !folder) {
    toast('Choose or paste a backup folder first.', 'error');
    if (cb) cb.checked = false;   // revert the tick
    return;
  }

  const apply = async () => {
    if (folder) await api('set_setting', 'autobackup_dir', folder);
    await api('set_setting', 'autobackup_enabled', on ? '1' : '0');
    if (on) {
      loading(true);
      let r;
      try { r = await api('run_autobackup_now'); } finally { loading(false); }
      if (r && r.success) toast('Auto-backup on. First backup saved → ' + r.path, 'success');
      else toast('Saved, but the test backup failed: ' + (r && r.error || 'unknown') + '. Check the folder path.', 'error');
    } else {
      toast('Auto-backup turned off.', 'success');
    }
    renderSettings();
  };

  // Changing the auto-backup setting requires the password (if one is set).
  // On cancel, re-render so the checkbox snaps back to its real saved state.
  if (_hasPassword) {
    requirePasswordThen(
      'Enter your password to change automatic backup settings.',
      '',
      () => apply(),
      { title: '🔐 Confirm with Password', btnLabel: 'Confirm', btnClass: 'btn-primary',
        onCancel: () => renderSettings() }
    );
  } else {
    apply();
  }
}

async function runAutobackupNow() {
  const dirEl = document.getElementById('ab-dir');
  const folder = ((dirEl && dirEl.value) || '').trim();
  if (!folder) { toast('Choose or paste a backup folder first.', 'error'); return; }
  // Manual one-off backup — does NOT change saved settings and does NOT
  // re-render (so it can't wipe an in-progress toggle).
  loading(true);
  let r;
  try { r = await api('backup_to_folder', folder); } finally { loading(false); }
  if (r && r.success) toast('Backup saved → ' + r.path, 'success');
  else toast('Backup failed: ' + (r && r.error || 'unknown'), 'error');
}

// Load persisted settings once at startup (text size + business name).
async function loadAppSettings() {
  try {
    const s = await api('get_settings');
    window.BUSINESS_NAME = (s && s.business_name) || '';
    applyTextSize((s && s.text_size) || 'normal', false);
    applyBusinessName();
  } catch (_) {}
}

function renderHelp() {
  const langs = window.HELP_LANGS || { en: 'English' };
  const allContent = window.HELP_CONTENT || {};
  let lang = '';
  try { lang = localStorage.getItem('helpLang') || ''; } catch (e) {}
  if (!langs[lang] || !allContent[lang]) lang = 'en';
  const content = allContent[lang] || allContent.en || { title: 'Help', sections: [] };

  const langOptions = Object.keys(langs).map(code =>
    `<option value="${code}" ${code === lang ? 'selected' : ''}>${esc(langs[code])}</option>`
  ).join('');

  const sectionsHTML = (content.sections || []).map(s => `
    <div class="help-section">
      <h3 class="help-section-title">${esc(s.h)}</h3>
      <div class="help-section-body">${s.body}</div>
    </div>
  `).join('');

  document.getElementById('view').innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${esc(content.title || 'Help')}</div>
        <div class="page-subtitle">${esc(content.subtitle || '')}</div>
      </div>
      <div class="header-actions">
        <label style="font-size:13px;color:var(--text-muted);margin-right:8px">Language:</label>
        <select class="filter-select" onchange="setHelpLang(this.value)">${langOptions}</select>
      </div>
    </div>
    <div class="help-page">${sectionsHTML}</div>
  `;
}

function setHelpLang(code) {
  try { localStorage.setItem('helpLang', code); } catch (e) {}
  renderHelp();
}

async function refreshCurrentView() {
  await navigate(currentView);
}

// ── Dashboard view ───────────────────────────────────────────────
async function renderDashboard() {
  loading(true);
  let summaries;
  try { summaries = await api('get_all_borrowers'); }
  finally { loading(false); }

  const today = new Date().toISOString().split('T')[0];
  const todayFmt = new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  const view = document.getElementById('view');

  // First-run / empty book → a friendly call to action, not two empty panels.
  if (!summaries || summaries.length === 0) {
    view.innerHTML = `
      <div class="page-header">
        <div><div class="page-title">Dashboard</div><div class="page-subtitle">${todayFmt}</div></div>
      </div>
      <div class="empty-state">
        <div class="empty-icon">👋</div>
        <h3>Welcome to Finance Tracker</h3>
        <p>You haven't added any loans yet. Start by creating your first one.</p>
        <button class="btn btn-primary" style="margin-top:16px;font-size:15px" onclick="navigate('add')">➕ Add your first loan</button>
        <p style="margin-top:16px"><a onclick="navigate('help')" style="color:var(--primary)">Read the quick guide →</a></p>
      </div>`;
    return;
  }

  // Due Today/Tomorrow — next installment due today or tomorrow.
  const dueToday = summaries.filter(s => {
    if (s.closed || s.is_overdue) return false;
    const nd = nextDueDateFor(s);
    if (!nd) return false;
    const d = Math.round((new Date(nd) - new Date(today)) / 86400000);
    return d === 0 || d === 1;
  }).sort((a, b) => {
    const da = Math.round((new Date(nextDueDateFor(a)) - new Date(today)) / 86400000);
    const db2 = Math.round((new Date(nextDueDateFor(b)) - new Date(today)) / 86400000);
    return da - db2;
  });

  // Recently overdue — missed payment in last 10 days
  const recentOverdue = summaries
    .filter(s => s.is_overdue && s.days_overdue >= 1 && s.days_overdue <= 10)
    .sort((a, b) => a.days_overdue - b.days_overdue);

  const allOverdue = summaries.filter(s => s.is_overdue);
  const longOverdue = allOverdue.filter(s => s.days_overdue > 10);
  const toCollect = dueToday.reduce((a, s) => a + (s.installment_amount || 0), 0);
  const totalOverdueAmt = allOverdue.reduce((a, s) => a + s.overdue_amount, 0);
  const activeCount = summaries.filter(s => !s.closed).length;

  view.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Dashboard</div>
        <div class="page-subtitle">${todayFmt}</div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline" onclick="exportCSV()">⬇ Export CSV</button>
      </div>
    </div>

    <div class="stat-grid dash-stats">
      <div class="stat-card success">
        <div class="stat-label">To Collect — Today &amp; Tomorrow</div>
        <div class="stat-value success stat-value-md">${money(toCollect)}</div>
        <div class="stat-sub">${dueToday.length} installment${dueToday.length !== 1 ? 's' : ''} due</div>
      </div>
      <div class="stat-card ${allOverdue.length ? 'danger' : 'gray'} clickable" onclick="gotoOverdue()" title="View all overdue borrowers">
        <div class="stat-label">Overdue (all)</div>
        <div class="stat-value ${allOverdue.length ? 'danger' : ''} stat-value-md">${money(totalOverdueAmt)}</div>
        <div class="stat-sub">${allOverdue.length} borrower${allOverdue.length !== 1 ? 's' : ''}${longOverdue.length ? ` · ${longOverdue.length} over 10 days` : ''} · View all →</div>
      </div>
      <div class="stat-card gray">
        <div class="stat-label">Active Loans</div>
        <div class="stat-value stat-value-md">${activeCount}</div>
        <div class="stat-sub">${summaries.length} total in your book</div>
      </div>
    </div>

    <div class="dash-grid">

      <div class="dash-section">
        <div class="dash-section-header due-today-header">
          <span class="dash-section-title">Due Today &amp; Tomorrow</span>
          <span class="dash-section-count">${dueToday.length} borrower${dueToday.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="dash-section-body">
          ${dueToday.length === 0
            ? `<div class="dash-empty">No payments due today or tomorrow</div>`
            : dueToday.map(s => {
                const nd = nextDueDateFor(s);
                const dLeft = Math.round((new Date(nd) - new Date(today)) / 86400000);
                const dLabel = dLeft === 0 ? 'Due Today' : 'Due Tomorrow';
                const dStyle = dLeft === 0
                  ? 'background:#bbf7d0;color:#15803d'
                  : 'background:#fef9c3;color:#b45309';
                return `
              <div class="dash-card due-card" onclick="showDetail(${s.borrower_id})">
                <div class="dash-card-top">
                  <span class="dash-name">${esc(s.name)}</span>
                  ${s.book_ref ? `<span class="book-ref-tag">${esc(s.book_ref)}</span>` : ''}
                </div>
                <div class="dash-card-mid">
                  <span class="dash-phone">📞 ${esc(s.phone) || '—'}</span>
                  <span class="dash-vehicle">${esc(s.vehicle_no) || ''}</span>
                </div>
                <div class="dash-card-bot">
                  <span class="dash-amount due-amount">${money(s.installment_amount)} due</span>
                  <span class="dash-card-actions">
                    ${s.phone ? `<button class="dash-remind" title="Send WhatsApp reminder"
                      data-phone="${esc(s.phone)}" data-name="${esc(s.name)}" data-amt="${esc(money(s.installment_amount))}" data-kind="due"
                      onclick="event.stopPropagation(); remindFromBtn(this)">💬</button>` : ''}
                    <span class="dash-days" style="${dStyle}">${dLabel}</span>
                  </span>
                </div>
              </div>`}).join('')}
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-section-header overdue-header">
          <span class="dash-section-title">Missed — Last 10 Days</span>
          <span class="dash-section-count">${recentOverdue.length} borrower${recentOverdue.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="dash-section-body">
          ${recentOverdue.length === 0
            ? `<div class="dash-empty">No one became overdue in the last 10 days</div>`
            : recentOverdue.map(s => `
              <div class="dash-card overdue-card" onclick="showDetail(${s.borrower_id})">
                <div class="dash-card-top">
                  <span class="dash-name">${esc(s.name)}</span>
                  ${s.book_ref ? `<span class="book-ref-tag">${esc(s.book_ref)}</span>` : ''}
                </div>
                <div class="dash-card-mid">
                  <span class="dash-phone">📞 ${esc(s.phone) || '—'}</span>
                  <span class="dash-vehicle">${esc(s.vehicle_no) || ''}</span>
                </div>
                <div class="dash-card-bot">
                  <span class="dash-amount overdue-amount">${money(s.overdue_amount)} overdue</span>
                  <span class="dash-card-actions">
                    ${s.phone ? `<button class="dash-remind" title="Send WhatsApp reminder"
                      data-phone="${esc(s.phone)}" data-name="${esc(s.name)}" data-amt="${esc(money(s.overdue_amount))}" data-kind="overdue"
                      onclick="event.stopPropagation(); remindFromBtn(this)">💬</button>` : ''}
                    <span class="dash-days">${s.days_overdue}d ago</span>
                  </span>
                </div>
              </div>`).join('')}
        </div>
      </div>

    </div>
  `;
}

// ── All Borrowers view ───────────────────────────────────────────
async function renderBorrowers() {
  loading(true);
  let summaries;
  try { summaries = await api('get_all_borrowers'); }
  finally { loading(false); }

  // Choices for the Place / Showroom / Vehicle-type filters come from values
  // already entered on borrowers. Non-critical — fall back to empty lists.
  let suggestions = {};
  try { suggestions = await api('get_suggestions'); } catch (_) {}

  const today = new Date().toISOString().split('T')[0];
  const overdueSummaries = summaries.filter(s => s.is_overdue);
  const dueSoonCount = summaries.filter(s => {
    const nd = nextDueDateFor(s);
    if (!nd) return false;
    const d = Math.round((new Date(nd) - new Date(today)) / 86400000);
    return d >= 0 && d <= 7;
  }).length;
  const totalOverdueAmt = overdueSummaries.reduce((sum, s) => sum + s.overdue_amount, 0);

  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Borrowers</div>
        <div class="quick-stats">
          <span class="qstat danger">${overdueSummaries.length} overdue &nbsp;·&nbsp; ${money(totalOverdueAmt)}</span>
          <span class="qstat warning">${dueSoonCount} due this week</span>
          <span class="qstat muted">${summaries.filter(s=>!s.closed).length} active</span>
        </div>
        <div id="borrow-count" style="font-size:12px;color:var(--text-muted);margin-top:3px"></div>
      </div>
      <div class="header-actions">
        <button class="btn btn-outline" onclick="exportCSV()">⬇ Export CSV</button>
        <button class="btn btn-primary" onclick="navigate('add')">➕ New Loan</button>
      </div>
    </div>
    <div class="search-row">
      <input class="search-input" id="borrow-search" type="text"
        placeholder="Search name, then add father / guarantor / place / showroom…"
        title="Type a name, then keep adding words (father name, guarantor, place, showroom, phone, vehicle, book ref) to narrow down — every word must match."
        value="${esc(searchQuery)}"
        oninput="filterBorrowers(this.value)" />
      <input class="search-input search-input-receipt" id="receipt-search" type="text"
        placeholder="🧾 Search receipt no…"
        value="${esc(receiptQuery)}"
        oninput="setReceiptQuery(this.value)" />
      <button id="pdf-export-btn" class="btn btn-outline btn-sm" onclick="exportBorrowersPDF()"
        title="Tick the rows you want to export only those. Tick none to export the whole filtered list.">
        📄 Export to PDF
      </button>
      <span id="selection-info" class="selection-info"></span>
    </div>
    ${renderFilterPanel(suggestions)}
    <div id="receipt-match-slot"></div>
    <div class="card">
      <div class="table-wrap table-scroll-full">
        <table class="data-table">
          <thead>
            <tr>
              <th class="th-check"><input type="checkbox" id="select-all-rows" title="Select / clear all shown" onclick="toggleSelectAll(this.checked)"></th>
              <th class="th-sort" data-sort="book_ref" onclick="sortBorrowers('book_ref')">Book Ref<span class="sort-caret"></span></th>
              <th class="th-sort" data-sort="name" onclick="sortBorrowers('name')">Name<span class="sort-caret"></span></th>
              <th>Phone</th><th>Vehicle No</th>
              <th class="th-sort" data-sort="loan_date" onclick="sortBorrowers('loan_date')">Loan Date<span class="sort-caret"></span></th>
              <th class="th-sort" data-sort="loan_amount" onclick="sortBorrowers('loan_amount')">Principal<span class="sort-caret"></span></th>
              <th>Installments</th>
              <th class="th-sort" data-sort="overdue_amount" onclick="sortBorrowers('overdue_amount')">Overdue<span class="sort-caret"></span></th>
              <th class="th-sort" data-sort="status_label" onclick="sortBorrowers('status_label')">Status<span class="sort-caret"></span></th>
            </tr>
          </thead>
          <tbody id="borrow-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  window._allSummaries = summaries;
  _selectedIds = new Set();   // fresh selection each time the page is built
  filterBorrowers(searchQuery);
}

function setReceiptQuery(v) {
  receiptQuery = v;
  filterBorrowers(searchQuery);   // re-runs the filter + re-renders the match card
}

// Render the small card above the Borrowers table when the receipt search
// box has a value: shows the matched payment's full details, or "no match".
function renderReceiptMatchCard() {
  const slot = document.getElementById('receipt-match-slot');
  if (!slot) return;
  const q = (receiptQuery || '').trim();
  if (!q) { slot.innerHTML = ''; return; }
  const matches = findReceiptMatches();
  if (matches.length === 0) {
    slot.innerHTML = `
      <div class="receipt-match-card empty">
        <div class="rmc-icon">🔍</div>
        <div>No payment found with receipt <strong>${esc(q)}</strong>.</div>
      </div>`;
    return;
  }
  const head = matches.length === 1
    ? `<div class="rmc-header">🧾 Match found for <strong>${esc(q)}</strong></div>`
    : `<div class="rmc-header">🧾 ${matches.length} matches for <strong>${esc(q)}</strong></div>`;
  const rows = matches.map(m => {
    const p = m.payment;
    const modeBit = p.payment_mode ? modePill(p.payment_mode) : '';
    const notesBit = p.notes ? `<div class="rmc-notes">📝 ${esc(p.notes)}</div>` : '';
    return `
      <div class="rmc-row">
        <div class="rmc-main">
          <div class="rmc-line1">
            <span class="rmc-receipt">${esc(p.receipt_no)}</span>
            <span class="rmc-amount">${money(p.amount)}</span>
            <span class="rmc-date">${fmtDate(p.payment_date)}</span>
            ${modeBit}
          </div>
          <div class="rmc-line2">
            <strong>${esc(m.borrower_name) || '—'}</strong>
            ${m.book_ref ? `<span class="book-ref-tag">${esc(m.book_ref)}</span>` : ''}
          </div>
          ${notesBit}
        </div>
        <button class="btn btn-sm btn-outline" onclick="showDetail(${m.borrower_id})">View →</button>
      </div>`;
  }).join('');
  slot.innerHTML = `<div class="receipt-match-card">${head}${rows}</div>`;
}

// Pure predicate — true if a summary should be shown given current filter+search.
// Factored out so both the Borrowers list and the PDF export use the exact same logic.
function passesBorrowerFilter(s, today, q) {
  const f = filters;

  // ── Status (lifecycle) ──
  if (f.status === 'active' && s.closed) return false;
  if (f.status === 'closed' && !s.closed) return false;

  // ── Standing ──
  if (f.standing === 'overdue' && !s.is_overdue) return false;
  if (f.standing === 'ontime'  && (s.closed || s.is_overdue || s.is_advance)) return false;
  if (f.standing === 'advance' && !s.is_advance) return false;

  // ── Overdue severity (implies overdue) ──
  if (f.overdue !== 'any') {
    if (!s.is_overdue) return false;
    if (f.overdue === 'd30' && s.days_overdue < 30) return false;
    if (f.overdue === 'd60' && s.days_overdue < 60) return false;
    if (f.overdue === 'd90' && s.days_overdue < 90) return false;
    if (f.overdue === 'a1k' && s.overdue_amount < 1000) return false;
    if (f.overdue === 'a5k' && s.overdue_amount < 5000) return false;
    if (f.overdue === 'custom') {
      const dMin = parseFloat(f.overdueDaysMin);
      if (!isNaN(dMin) && s.days_overdue < dMin) return false;
      const aMin = parseFloat(f.overdueAmtMin);
      if (!isNaN(aMin) && s.overdue_amount < aMin) return false;
    }
  }

  // ── Flags ──
  if (f.hasPenalty && !hasPenalty(s)) return false;
  if (f.hasSeizing && !hasSeizing(s)) return false;

  // ── Due-date window ──
  if (f.due !== 'any') {
    const nd = nextDueDateFor(s);
    if (!nd) return false;
    const daysUntil = Math.round((new Date(nd) - new Date(today)) / 86400000);
    if (f.due === 'today'    && daysUntil !== 0) return false;
    if (f.due === 'tomorrow' && daysUntil !== 1) return false;
    if (f.due === 'd3'       && (daysUntil < 0 || daysUntil > 3)) return false;
    if (f.due === 'd7'       && (daysUntil < 0 || daysUntil > 7)) return false;
    if (f.due === 'within') {
      const n = parseFloat(f.dueWithin);
      if (!isNaN(n) && (daysUntil < 0 || daysUntil > n)) return false;
    }
    if (f.due === 'pick'     && f.pickDate && nd !== f.pickDate) return false;
  }

  // ── Category exact matches (case-insensitive) ──
  if (f.place && (s.address || '').toLowerCase() !== f.place.toLowerCase()) return false;
  if (f.showroom && (s.showroom || '').toLowerCase() !== f.showroom.toLowerCase()) return false;
  if (f.vehicleType && (s.vehicle_type || '').toLowerCase() !== f.vehicleType.toLowerCase()) return false;

  // ── Loan amount range ──
  const amin = parseFloat(f.amountMin);
  if (!isNaN(amin) && s.loan_amount < amin) return false;
  const amax = parseFloat(f.amountMax);
  if (!isNaN(amax) && s.loan_amount > amax) return false;

  // ── Loan date range (ISO string compare is safe for yyyy-mm-dd) ──
  if (f.dateFrom && s.loan_date < f.dateFrom) return false;
  if (f.dateTo && s.loan_date > f.dateTo) return false;

  // ── Build-your-own custom conditions (all must match) ──
  for (const c of (f.custom || [])) {
    if (!matchesCustomCondition(s, c)) return false;
  }

  // Normal search box: each typed word must match at least one field, so you
  // can start with the name and keep adding words (father / guarantor / place /
  // showroom) to narrow down when several borrowers share the same name.
  if (q) {
    const fields = [
      s.name, s.phone, s.vehicle_no, s.book_ref,
      s.father_name, s.guarantor_name, s.address, s.showroom,
    ].map(x => (x || '').toString().toLowerCase());
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = terms.every(t => fields.some(f => f.includes(t)));
    if (!matched) return false;
  }
  // Dedicated receipt search box: check this borrower's receipts
  if (receiptQuery) {
    const lr = receiptQuery.toLowerCase();
    const receipts = s.receipts || [];
    const hit = receipts.some(p =>
      ((p && (p.receipt_no || p)) || '').toString().toLowerCase().includes(lr));
    if (!hit) return false;
  }
  return true;
}

// Find every payment whose receipt matches the current receipt query, across
// all loaded summaries. Used to render the small "matched receipt" card above
// the Borrowers table.
function findReceiptMatches() {
  const lr = (receiptQuery || '').trim().toLowerCase();
  if (!lr) return [];
  const out = [];
  for (const s of (window._allSummaries || [])) {
    for (const p of (s.receipts || [])) {
      const rno = (p && (p.receipt_no || p)) || '';
      if (rno.toString().toLowerCase().includes(lr)) {
        out.push({
          payment: typeof p === 'object' ? p : { receipt_no: rno },
          borrower_id: s.borrower_id,
          borrower_name: s.name,
          book_ref: s.book_ref,
        });
      }
    }
  }
  return out;
}

// Human-readable summary of every active filter — used as the PDF heading and
// as the "n active" hint in the panel. Returns 'All Borrowers' when nothing set.
function activeFilterParts() {
  const f = filters;
  const parts = [];
  if (f.status === 'active') parts.push('Active only');
  else if (f.status === 'closed') parts.push('Closed only');
  if (f.standing === 'overdue') parts.push('Overdue');
  else if (f.standing === 'ontime') parts.push('On time');
  else if (f.standing === 'advance') parts.push('Advance');
  const odMap = { d30: 'Overdue ≥30d', d60: 'Overdue ≥60d', d90: 'Overdue ≥90d',
                  a1k: 'Overdue >₹1,000', a5k: 'Overdue >₹5,000' };
  if (odMap[f.overdue]) parts.push(odMap[f.overdue]);
  else if (f.overdue === 'custom') {
    const bits = [];
    if (f.overdueDaysMin) bits.push(`≥${f.overdueDaysMin}d`);
    if (f.overdueAmtMin) bits.push(`≥₹${f.overdueAmtMin}`);
    parts.push(bits.length ? 'Overdue ' + bits.join(' & ') : 'Overdue (custom)');
  }
  if (f.hasPenalty) parts.push('Has penalty');
  if (f.hasSeizing) parts.push('Has seizing');
  const dueMap = { today: 'Due today', tomorrow: 'Due tomorrow', d3: 'Due in 3 days',
                   d7: 'Due in 7 days' };
  if (dueMap[f.due]) parts.push(dueMap[f.due]);
  else if (f.due === 'within') parts.push(`Due within ${f.dueWithin || '—'} days`);
  else if (f.due === 'pick') parts.push(`Due on ${f.pickDate ? fmtDate(f.pickDate) : '—'}`);
  if (f.place) parts.push(`Place: ${f.place}`);
  if (f.showroom) parts.push(`Showroom: ${f.showroom}`);
  if (f.vehicleType) parts.push(`Vehicle: ${f.vehicleType}`);
  if (f.amountMin || f.amountMax)
    parts.push(`Amount ${f.amountMin || '0'}–${f.amountMax || '∞'}`);
  if (f.dateFrom || f.dateTo)
    parts.push(`Loan date ${f.dateFrom ? fmtDate(f.dateFrom) : '…'}–${f.dateTo ? fmtDate(f.dateTo) : '…'}`);
  for (const c of (f.custom || [])) {
    if (!c || !c.field || c.value === '' || c.value == null) continue;
    const meta = CUSTOM_FIELDS.find(m => m.key === c.field);
    const opLabel = (CUSTOM_OPS[meta ? meta.type : 'text'].find(o => o[0] === c.op) || ['', c.op])[1];
    parts.push(`${meta ? meta.label : c.field} ${opLabel} ${c.value}`);
  }
  return parts;
}

function currentFilterLabel() {
  const parts = activeFilterParts();
  let label = parts.length ? parts.join(' · ') : 'All Borrowers (Active + Closed)';
  if (searchQuery) label += ` · search: "${searchQuery}"`;
  return label;
}

function filterBorrowers(q) {
  searchQuery = q;
  renderReceiptMatchCard();   // update the inline card whenever search changes
  const summaries = window._allSummaries || [];
  const tbody = document.getElementById('borrow-tbody');
  if (!tbody) return;
  const today = new Date().toISOString().split('T')[0];

  const rows = summaries.filter(s => passesBorrowerFilter(s, today, q));

  // Optional column sort (default order = server's overdue-first grouping).
  if (_sortKey) {
    const k = _sortKey, dir = _sortDir;
    rows.sort((a, b) => {
      let va = a[k], vb = b[k];
      if (k === 'name' || k === 'status_label' || k === 'book_ref' || k === 'loan_date') {
        va = (va || '').toString().toLowerCase();
        vb = (vb || '').toString().toLowerCase();
        return va < vb ? -dir : va > vb ? dir : 0;
      }
      return ((parseFloat(va) || 0) - (parseFloat(vb) || 0)) * dir;
    });
  }

  document.getElementById('borrow-count').textContent =
    `Showing ${rows.length} of ${summaries.length} borrowers`;
  updateActiveFilterCount();
  updateSortCarets();
  updateSelectAllState(rows);
  updateSelectionUI();

  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="no-data"><td colspan="10">No borrowers found.</td></tr>`;
    return;
  }
  rows.forEach(s => {
    const rowCls = s.closed ? 'row-closed' : s.is_overdue ? 'row-overdue' : s.is_advance ? 'row-advance' : '';
    const overdueTd = s.is_overdue
      ? `<span style="color:var(--danger);font-weight:600">${money(s.overdue_amount)}</span>`
      : '—';
    const bookRefTd = s.book_ref
      ? `<span class="book-ref-tag">${esc(s.book_ref)}</span>`
      : '<span style="color:var(--text-muted);font-size:12px">—</span>';
    const tr = document.createElement('tr');
    tr.className = rowCls;
    const checked = _selectedIds.has(s.borrower_id) ? 'checked' : '';
    tr.innerHTML = `
      <td class="td-check"><input type="checkbox" class="row-check" ${checked}
        onclick="event.stopPropagation(); toggleRowSelect(${s.borrower_id}, this.checked)"></td>
      <td>${bookRefTd}</td>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.phone) || '—'}</td>
      <td><code style="font-size:12px">${esc(s.vehicle_no) || '—'}</code></td>
      <td>${fmtDate(s.loan_date)}</td>
      <td>${money(s.loan_amount)}</td>
      <td>${installmentText(s)}</td>
      <td>${overdueTd}</td>
      <td>${badge(s.status_label)}</td>
    `;
    tr.style.cursor = 'pointer';
    tr.onclick = () => showDetail(s.borrower_id);
    tbody.appendChild(tr);
  });
}

// ── Row selection (for selective PDF export) ─────────────────────
function _shownRows() {
  const summaries = window._allSummaries || [];
  const today = new Date().toISOString().split('T')[0];
  return summaries.filter(s => passesBorrowerFilter(s, today, searchQuery));
}

function toggleRowSelect(id, checked) {
  if (checked) _selectedIds.add(id); else _selectedIds.delete(id);
  updateSelectAllState(_shownRows());
  updateSelectionUI();
}

function toggleSelectAll(checked) {
  _shownRows().forEach(s => {
    if (checked) _selectedIds.add(s.borrower_id); else _selectedIds.delete(s.borrower_id);
  });
  document.querySelectorAll('#borrow-tbody .row-check').forEach(cb => { cb.checked = checked; });
  const sa = document.getElementById('select-all-rows');
  if (sa) sa.indeterminate = false;
  updateSelectionUI();
}

function clearSelection() {
  _selectedIds.clear();
  document.querySelectorAll('#borrow-tbody .row-check').forEach(cb => { cb.checked = false; });
  const sa = document.getElementById('select-all-rows');
  if (sa) { sa.checked = false; sa.indeterminate = false; }
  updateSelectionUI();
}

// Tri-state header checkbox: checked if all shown are selected, dash if some.
function updateSelectAllState(shownRows) {
  const sa = document.getElementById('select-all-rows');
  if (!sa) return;
  const shown = shownRows || [];
  const allSel = shown.length > 0 && shown.every(s => _selectedIds.has(s.borrower_id));
  sa.checked = allSel;
  sa.indeterminate = !allSel && shown.some(s => _selectedIds.has(s.borrower_id));
}

function updateSelectionUI() {
  const n = _selectedIds.size;
  const info = document.getElementById('selection-info');
  if (info) info.innerHTML = n > 0
    ? `<b>${n}</b> selected · <a class="sel-clear" onclick="clearSelection()">clear</a>`
    : '';
  const btn = document.getElementById('pdf-export-btn');
  if (btn) btn.textContent = n > 0 ? `📄 Export ${n} to PDF` : '📄 Export to PDF';
}

// ── Filter panel: rendering ──────────────────────────────────────
function optionList(values, selected) {
  const opts = ['<option value="">— Any —</option>'];
  for (const v of (values || [])) {
    opts.push(`<option value="${esc(v)}" ${selected === v ? 'selected' : ''}>${esc(v)}</option>`);
  }
  return opts.join('');
}

function renderFilterPanel(sug) {
  sug = sug || {};
  const f = filters;
  const sel = (cur, val) => cur === val ? 'selected' : '';
  // Open the panel automatically if any filter is already active, otherwise
  // keep it collapsed so the table isn't pushed down by the big panel.
  if (activeFilterParts().length > 0) _filtersOpen = true;
  const open = _filtersOpen;
  return `
  <div class="filter-panel ${open ? 'open' : 'collapsed'}" id="filter-panel">
    <div class="filter-panel-head">
      <button class="fp-toggle" onclick="toggleFilters()" aria-expanded="${open}">
        <span class="fp-caret">${open ? '▾' : '▸'}</span> 🔧 Filters
      </button>
      <span class="fp-active" id="fp-active-count"></span>
      <button class="btn btn-sm btn-outline fp-clear" onclick="clearAllFilters()">✕ Clear all</button>
    </div>
    <div class="filter-body" ${open ? '' : 'style="display:none"'}>
    <div class="filter-grid">
      <div class="filter-field">
        <label>Status</label>
        <select class="filter-select" onchange="setFilter('status', this.value)">
          <option value="everything" ${sel(f.status,'everything')}>Active + Closed</option>
          <option value="active" ${sel(f.status,'active')}>Active only</option>
          <option value="closed" ${sel(f.status,'closed')}>Closed only</option>
        </select>
      </div>
      <div class="filter-field">
        <label>Standing</label>
        <select class="filter-select" onchange="setFilter('standing', this.value)">
          <option value="any" ${sel(f.standing,'any')}>Any</option>
          <option value="overdue" ${sel(f.standing,'overdue')}>Overdue</option>
          <option value="ontime" ${sel(f.standing,'ontime')}>On time</option>
          <option value="advance" ${sel(f.standing,'advance')}>Advance (paid ahead)</option>
        </select>
      </div>
      <div class="filter-field">
        <label>Overdue severity</label>
        <select class="filter-select" onchange="setFilterOverdue(this.value)">
          <option value="any" ${sel(f.overdue,'any')}>Any</option>
          <option value="d30" ${sel(f.overdue,'d30')}>≥ 30 days</option>
          <option value="d60" ${sel(f.overdue,'d60')}>≥ 60 days</option>
          <option value="d90" ${sel(f.overdue,'d90')}>≥ 90 days</option>
          <option value="a1k" ${sel(f.overdue,'a1k')}>over ₹1,000</option>
          <option value="a5k" ${sel(f.overdue,'a5k')}>over ₹5,000</option>
          <option value="custom" ${sel(f.overdue,'custom')}>Custom…</option>
        </select>
        <div class="filter-range" id="overdue-custom"
          style="margin-top:6px;${f.overdue !== 'custom' ? 'display:none' : ''}">
          <input type="number" class="form-control" placeholder="≥ days" min="0"
            value="${esc(f.overdueDaysMin)}" oninput="setFilter('overdueDaysMin', this.value)" />
          <span class="range-dash">&</span>
          <input type="number" class="form-control" placeholder="≥ ₹" min="0"
            value="${esc(f.overdueAmtMin)}" oninput="setFilter('overdueAmtMin', this.value)" />
        </div>
      </div>
      <div class="filter-field">
        <label>Due date</label>
        <select class="filter-select" onchange="setFilterDue(this.value)">
          <option value="any" ${sel(f.due,'any')}>Any</option>
          <option value="today" ${sel(f.due,'today')}>Due today</option>
          <option value="tomorrow" ${sel(f.due,'tomorrow')}>Due tomorrow</option>
          <option value="d3" ${sel(f.due,'d3')}>Due in 3 days</option>
          <option value="d7" ${sel(f.due,'d7')}>Due in 7 days</option>
          <option value="within" ${sel(f.due,'within')}>Due within N days…</option>
          <option value="pick" ${sel(f.due,'pick')}>Due on date…</option>
        </select>
        <input type="number" id="filter-due-within" class="form-control" placeholder="within N days" min="0"
          value="${esc(f.dueWithin)}"
          style="margin-top:6px;${f.due !== 'within' ? 'display:none' : ''}"
          oninput="setFilter('dueWithin', this.value)" />
        <input type="text" id="filter-pick-date" class="form-control" placeholder="dd-mm-yy"
          maxlength="10" value="${esc(fmtDate(f.pickDate))}"
          style="margin-top:6px;${f.due !== 'pick' ? 'display:none' : ''}"
          onchange="setFilterPickDate(this.value)" />
      </div>
      <div class="filter-field">
        <label>Place / address</label>
        <select class="filter-select" onchange="setFilter('place', this.value)">
          ${optionList(sug.address, f.place)}
        </select>
      </div>
      <div class="filter-field">
        <label>Showroom</label>
        <select class="filter-select" onchange="setFilter('showroom', this.value)">
          ${optionList(sug.showroom, f.showroom)}
        </select>
      </div>
      <div class="filter-field">
        <label>Vehicle type</label>
        <select class="filter-select" onchange="setFilter('vehicleType', this.value)">
          ${optionList(sug.vehicle_type, f.vehicleType)}
        </select>
      </div>
      <div class="filter-field">
        <label>Loan amount (₹)</label>
        <div class="filter-range">
          <input type="number" class="form-control" placeholder="min" min="0" value="${esc(f.amountMin)}"
            oninput="setFilter('amountMin', this.value)" />
          <span class="range-dash">–</span>
          <input type="number" class="form-control" placeholder="max" min="0" value="${esc(f.amountMax)}"
            oninput="setFilter('amountMax', this.value)" />
        </div>
      </div>
      <div class="filter-field">
        <label>Loan date</label>
        <div class="filter-range">
          <input type="text" class="form-control" placeholder="from dd-mm-yy" maxlength="10"
            value="${esc(fmtDate(f.dateFrom))}" onchange="setFilterDate('dateFrom', this.value)" />
          <span class="range-dash">–</span>
          <input type="text" class="form-control" placeholder="to dd-mm-yy" maxlength="10"
            value="${esc(fmtDate(f.dateTo))}" onchange="setFilterDate('dateTo', this.value)" />
        </div>
      </div>
      <div class="filter-field">
        <label>Flags</label>
        <div class="filter-checks">
          <label class="filter-label"><input type="checkbox" ${f.hasPenalty ? 'checked' : ''}
            onchange="toggleFilterFlag('hasPenalty', this.checked)" /> Has penalty</label>
          <label class="filter-label"><input type="checkbox" ${f.hasSeizing ? 'checked' : ''}
            onchange="toggleFilterFlag('hasSeizing', this.checked)" /> Has seizing</label>
        </div>
      </div>
    </div>
    <div class="filter-custom">
      <div class="fc-head">
        <span class="fc-title">Custom conditions <span class="muted-hint">(build your own — all must match)</span></span>
        <button class="btn btn-sm btn-outline" onclick="addCustomRow()">➕ Add condition</button>
      </div>
      <div id="custom-conditions">${renderCustomConditions()}</div>
    </div>
    </div>
  </div>`;
}

// Collapse / expand the Borrowers filter panel.
function toggleFilters() {
  _filtersOpen = !_filtersOpen;
  const panel = document.getElementById('filter-panel');
  if (!panel) return;
  const body = panel.querySelector('.filter-body');
  const caret = panel.querySelector('.fp-caret');
  const toggle = panel.querySelector('.fp-toggle');
  if (body) body.style.display = _filtersOpen ? '' : 'none';
  if (caret) caret.textContent = _filtersOpen ? '▾' : '▸';
  if (toggle) toggle.setAttribute('aria-expanded', _filtersOpen);
  panel.classList.toggle('open', _filtersOpen);
  panel.classList.toggle('collapsed', !_filtersOpen);
}

// Sort the Borrowers table by a column; clicking the same column flips order.
function sortBorrowers(key) {
  if (_sortKey === key) _sortDir = -_sortDir;
  else { _sortKey = key; _sortDir = 1; }
  filterBorrowers(searchQuery);
}

function updateSortCarets() {
  document.querySelectorAll('th.th-sort').forEach(th => {
    const c = th.querySelector('.sort-caret');
    if (!c) return;
    c.textContent = (th.dataset.sort === _sortKey) ? (_sortDir > 0 ? ' ▲' : ' ▼') : '';
  });
}

// HTML for the build-your-own custom-condition rows.
function renderCustomConditions() {
  if (!filters.custom.length) {
    return '<div class="fc-empty">No custom conditions. Click “Add condition” to filter on any field (e.g. Days overdue &gt; 45, Place is exactly Pavagada).</div>';
  }
  return filters.custom.map((c, i) => {
    const meta = CUSTOM_FIELDS.find(m => m.key === c.field) || CUSTOM_FIELDS[0];
    const fieldSel = CUSTOM_FIELDS.map(m =>
      `<option value="${m.key}" ${m.key === c.field ? 'selected' : ''}>${esc(m.label)}</option>`).join('');
    const opSel = (CUSTOM_OPS[meta.type] || CUSTOM_OPS.text).map(o =>
      `<option value="${o[0]}" ${o[0] === c.op ? 'selected' : ''}>${esc(o[1])}</option>`).join('');
    let valInput;
    if (meta.type === 'enum') {
      const opts = (meta.options || []).map(o =>
        `<option value="${esc(o)}" ${o === c.value ? 'selected' : ''}>${esc(o)}</option>`).join('');
      valInput = `<select class="filter-select cc-value" onchange="setCustom(${i}, 'value', this.value)">
        <option value="">— pick —</option>${opts}</select>`;
    } else {
      const ph = meta.type === 'date' ? 'dd-mm-yy' : (meta.type === 'number' ? 'value' : 'text');
      valInput = `<input type="text" class="form-control cc-value" placeholder="${ph}"
        value="${esc(c.value)}" oninput="setCustom(${i}, 'value', this.value)" />`;
    }
    return `
      <div class="cc-row">
        <select class="filter-select cc-field" onchange="changeCustomField(${i}, this.value)">${fieldSel}</select>
        <select class="filter-select cc-op" onchange="setCustom(${i}, 'op', this.value)">${opSel}</select>
        ${valInput}
        <button class="btn btn-sm btn-outline cc-del" title="Remove this condition"
          onclick="removeCustomRow(${i})">✕</button>
      </div>`;
  }).join('');
}

// True if a single custom condition matches a summary. Empty value = ignored.
function matchesCustomCondition(s, c) {
  if (!c || !c.field || c.value === '' || c.value == null) return true;
  const meta = CUSTOM_FIELDS.find(m => m.key === c.field);
  if (!meta) return true;
  if (meta.type === 'number') {
    const fieldVal = parseFloat(s[c.field]) || 0;
    const v = parseFloat(c.value);
    if (isNaN(v)) return true;
    switch (c.op) {
      case 'gt':  return fieldVal >  v;
      case 'gte': return fieldVal >= v;
      case 'lt':  return fieldVal <  v;
      case 'lte': return fieldVal <= v;
      case 'eq':  return Math.round(fieldVal) === Math.round(v);
      case 'neq': return Math.round(fieldVal) !== Math.round(v);
      default:    return true;
    }
  }
  if (meta.type === 'date') {
    const iso = parseUserDate(c.value);
    if (!iso) return true;                 // not a valid date yet — don't filter
    const fieldVal = s[c.field] || '';
    if (!fieldVal) return false;
    switch (c.op) {
      case 'on':     return fieldVal === iso;
      case 'before': return fieldVal <  iso;
      case 'after':  return fieldVal >  iso;
      default:       return true;
    }
  }
  if (meta.type === 'enum') {
    const fieldVal = s.status_label || '';
    return c.op === 'neq' ? fieldVal !== c.value : fieldVal === c.value;
  }
  // text
  const fieldVal = (s[c.field] || '').toString().toLowerCase();
  const v = c.value.toString().toLowerCase();
  switch (c.op) {
    case 'not_contains': return !fieldVal.includes(v);
    case 'equals':       return fieldVal === v;
    default:             return fieldVal.includes(v);
  }
}

// ── Filter panel: state handlers ─────────────────────────────────
function setFilter(key, value) {
  filters[key] = value;
  filterBorrowers(searchQuery);
}

function setFilterDue(value) {
  filters.due = value;
  const pick = document.getElementById('filter-pick-date');
  const within = document.getElementById('filter-due-within');
  if (pick) pick.style.display = value === 'pick' ? '' : 'none';
  if (within) within.style.display = value === 'within' ? '' : 'none';
  filterBorrowers(searchQuery);
}

// Overdue severity: reveal the custom day/amount thresholds when "Custom…" picked.
function setFilterOverdue(value) {
  filters.overdue = value;
  const box = document.getElementById('overdue-custom');
  if (box) box.style.display = value === 'custom' ? '' : 'none';
  filterBorrowers(searchQuery);
}

function setFilterPickDate(val) {
  const iso = parseUserDate(val);
  filters.pickDate = iso || '';
  if (val && !iso) toast('Invalid date. Use dd-mm-yy.', 'error');
  filterBorrowers(searchQuery);
}

function setFilterDate(key, val) {
  const iso = parseUserDate(val);
  filters[key] = iso || '';
  if (val && !iso) toast('Invalid date. Use dd-mm-yy.', 'error');
  filterBorrowers(searchQuery);
}

function toggleFilterFlag(key, checked) {
  filters[key] = !!checked;
  filterBorrowers(searchQuery);
}

function addCustomRow() {
  filters.custom.push({ field: CUSTOM_FIELDS[0].key, op: CUSTOM_OPS.text[0][0], value: '' });
  refreshCustomConditions();
  filterBorrowers(searchQuery);
}

function removeCustomRow(i) {
  filters.custom.splice(i, 1);
  refreshCustomConditions();
  filterBorrowers(searchQuery);
}

// Changing the field also resets the operator to the first valid one for the
// new field type (a number op makes no sense on a text field, etc.).
function changeCustomField(i, fieldKey) {
  const meta = CUSTOM_FIELDS.find(m => m.key === fieldKey) || CUSTOM_FIELDS[0];
  filters.custom[i].field = fieldKey;
  filters.custom[i].op = (CUSTOM_OPS[meta.type] || CUSTOM_OPS.text)[0][0];
  refreshCustomConditions();   // op list + value input depend on the field type
  filterBorrowers(searchQuery);
}

function setCustom(i, prop, value) {
  if (!filters.custom[i]) return;
  filters.custom[i][prop] = value;
  filterBorrowers(searchQuery);
}

function refreshCustomConditions() {
  const box = document.getElementById('custom-conditions');
  if (box) box.innerHTML = renderCustomConditions();
}

function clearAllFilters() {
  filters = defaultFilters();
  renderBorrowers();   // rebuild the whole panel back to defaults
}

// Show "(n active)" next to the panel title.
function updateActiveFilterCount() {
  const el = document.getElementById('fp-active-count');
  if (!el) return;
  const n = activeFilterParts().length;
  el.textContent = n ? `${n} active` : '';
  el.classList.toggle('on', n > 0);
}

// ── PDF export of the currently-filtered borrowers list ──────────
// Opens a new window with a dense print-styled report and auto-prints it.
// User picks "Save as PDF" in the Edge print dialog (default option on Windows).
async function exportBorrowersPDF() {
  const summaries = window._allSummaries || [];
  if (summaries.length === 0) {
    toast('Borrowers list not loaded yet. Open the Borrowers page first.', 'error');
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  // If any rows are ticked, export exactly those; otherwise the whole filtered list.
  const useSel = _selectedIds.size > 0;
  const targets = useSel
    ? summaries.filter(s => _selectedIds.has(s.borrower_id))
    : summaries.filter(s => passesBorrowerFilter(s, today, searchQuery));
  if (targets.length === 0) {
    toast('No borrowers to export.', 'error');
    return;
  }
  loading(true);
  let result;
  try {
    result = await api('get_borrowers_full', targets.map(s => s.borrower_id));
  } finally { loading(false); }
  if (!result || !result.success) {
    toast('Failed to fetch data: ' + (result && result.error || 'unknown'), 'error');
    return;
  }
  const label = useSel
    ? `${targets.length} selected borrower${targets.length !== 1 ? 's' : ''}`
    : currentFilterLabel();
  const html = buildBorrowersPdfHtml(result.data, label, targets.length);
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) {
    toast('Pop-up blocked. Allow pop-ups for this app and try again.', 'error');
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// Build the full HTML document (with embedded CSS + auto-print script) for the
// PDF window. Landscape A4, compact per-borrower cards including every key field
// + full payments / penalties / seizings tables. Auto-fires window.print() once
// the document is loaded so Edge's "Save as PDF" dialog appears immediately.
function buildBorrowersPdfHtml(items, filterLabel, count) {
  const todayStr = fmtDate(new Date().toISOString().split('T')[0]);
  const cards = items.map((it, i) => borrowerPdfCard(it, i + 1)).join('');
  return `<!doctype html>
<html><head><meta charset="utf-8">
<title>Borrowers Export — ${esc(filterLabel)} — ${todayStr}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font: 9pt 'Segoe UI','Nirmala UI',Arial,sans-serif; color: #111; }
  .report-header {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 2px solid #333; padding-bottom: 3mm; margin-bottom: 4mm;
  }
  .report-header h1 { margin: 0; font-size: 14pt; }
  .report-header .meta { font-size: 9pt; color: #555; text-align: right; line-height: 1.5; }
  .toolbar {
    display: flex; gap: 8px; margin-bottom: 4mm;
  }
  .toolbar button {
    font: inherit; padding: 4px 12px; border: 1px solid #333; background: #f4f4f4;
    border-radius: 3px; cursor: pointer;
  }
  @media print { .toolbar { display: none; } }
  .card {
    border: 1px solid #888; border-radius: 4px; padding: 3mm 4mm;
    margin-bottom: 3mm; page-break-inside: avoid;
  }
  .card-head {
    display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 1px solid #ccc; padding-bottom: 1.5mm; margin-bottom: 2mm;
  }
  .card-head .name { font-size: 11pt; font-weight: 700; }
  .card-head .name .sl { color: #666; font-weight: 500; margin-right: 2mm; }
  .card-head .name .book { color: #666; font-weight: 500; font-size: 9pt; margin-left: 3mm; }
  .card-head .status {
    font-size: 8.5pt; font-weight: 700; padding: 1px 6px; border-radius: 999px;
    border: 1px solid #888;
  }
  .status.Overdue { color: #b00020; border-color: #b00020; }
  .status.Closed  { color: #6b21a8; border-color: #6b21a8; }
  .status.Advance { color: #15803d; border-color: #15803d; }
  .status\\ On.time { color: #15803d; }
  .row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 1mm 6mm; margin-bottom: 1mm; }
  .row.cols-2 { grid-template-columns: 1fr 1fr; }
  .row.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .kv { font-size: 8.5pt; }
  .kv .k { color: #666; }
  .kv .v { font-weight: 600; }
  .kv .v.danger { color: #b00020; }
  .section-title {
    font-size: 8pt; font-weight: 700; color: #555;
    text-transform: uppercase; letter-spacing: 0.04em;
    margin-top: 2mm; margin-bottom: 1mm;
  }
  table.mini {
    font-size: 8pt; width: 100%; border-collapse: collapse;
  }
  table.mini th, table.mini td {
    padding: 0.6mm 2mm; border-bottom: 1px solid #ddd; text-align: left;
  }
  table.mini th { background: #f0f0f0; font-weight: 600; color: #444; }
  table.mini td.amt { text-align: right; font-variant-numeric: tabular-nums; }
  table.mini th.amt { text-align: right; }
  .empty { font-size: 8pt; color: #888; font-style: italic; padding: 1mm 0; }
</style>
</head>
<body>
  <div class="toolbar">
    <button onclick="window.print()">🖨 Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
  </div>
  <div class="report-header">
    <h1>Borrowers Report — ${esc(filterLabel)}</h1>
    <div class="meta">
      <div><b>${count}</b> borrower${count===1?'':'s'}</div>
      <div>Generated: ${todayStr}</div>
    </div>
  </div>
  ${cards}
  <script>
    // Give the browser one paint frame to lay everything out, then trigger print.
    window.addEventListener('load', () => setTimeout(() => window.print(), 300));
  </script>
</body></html>`;
}

// Print / save a single borrower's full statement (reuses the PDF card).
async function printBorrowerStatement(borrowerId) {
  loading(true);
  let result;
  try { result = await api('get_borrowers_full', [borrowerId]); }
  catch (e) { return; }
  finally { loading(false); }
  if (!result || !result.success || !result.data || !result.data.length) {
    toast('Could not build the statement.', 'error');
    return;
  }
  const name = (result.data[0].borrower && result.data[0].borrower.name) || 'Borrower';
  const html = buildBorrowersPdfHtml(result.data, `Statement — ${name}`, 1);
  const win = window.open('', '_blank', 'width=1000,height=800');
  if (!win) { toast('Pop-up blocked. Allow pop-ups for this app and try again.', 'error'); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
}

function borrowerPdfCard(it, sl) {
  const b = it.borrower, s = it.summary;
  const pays = it.payments || [], pens = it.penalties || [], seiz = it.seizings || [];

  const phoneCombined = [b.phone, b.phone2].filter(Boolean).join(' / ') || '—';
  const guarPhoneCombined = [b.guarantor_phone, b.guarantor_phone2].filter(Boolean).join(' / ');
  const guarLine = b.guarantor_name
    ? `${esc(b.guarantor_name)}${guarPhoneCombined ? ` — ${esc(guarPhoneCombined)}` : ''}${b.guarantor_address ? `, ${esc(b.guarantor_address)}` : ''}`
    : '—';
  const lastDue = (b.loan_date && b.period_months)
    ? fmtDate(jsAddMonths(b.loan_date, b.period_months)) : '—';
  const statusClass = (s.status_label || '').replace(/\s/g, '.');

  const payRows = pays.length > 0
    ? pays.map(p => `
        <tr>
          <td>${fmtDate(p.payment_date)}</td>
          <td>${esc(p.receipt_no) || '—'}</td>
          <td>${esc(p.installment_label) || '—'}</td>
          <td class="amt">${money(p.amount)}</td>
          <td>${[p.payment_mode ? `${modeIconFor(p.payment_mode)} ${esc(p.payment_mode)}` : '', p.showroom ? `🏪 ${esc(p.showroom)}` : ''].filter(Boolean).join(' · ')}</td>
          <td>${esc(p.notes) || ''}</td>
        </tr>`).join('')
    : '';
  const penRows = pens.length > 0
    ? pens.map(p => `
        <tr>
          <td>${fmtDate(p.charge_date)}</td>
          <td>${esc(p.receipt_no) || '—'}</td>
          <td class="amt">${money(p.amount)}</td>
          <td>${esc(p.notes) || ''}</td>
        </tr>`).join('')
    : '';
  const seizRows = seiz.length > 0
    ? seiz.map(p => `
        <tr>
          <td>${fmtDate(p.seizing_date)}</td>
          <td class="amt">${money(p.amount)}</td>
          <td>${esc(p.reason) || ''}</td>
        </tr>`).join('')
    : '';

  const odLine = s.is_overdue
    ? `<span class="v danger">${money(s.overdue_amount)} (${s.days_overdue} days)</span>`
    : `<span class="v">—</span>`;

  return `
  <div class="card">
    <div class="card-head">
      <div class="name">
        <span class="sl">${sl}.</span>${esc(b.name) || '—'}
        ${b.book_ref ? `<span class="book">📒 ${esc(b.book_ref)}</span>` : ''}
      </div>
      <div class="status ${statusClass}">${esc(s.status_label)}</div>
    </div>

    <div class="row cols-3">
      <div class="kv"><span class="k">S/o:</span> <span class="v">${esc(b.father_name) || '—'}</span></div>
      <div class="kv"><span class="k">Phone:</span> <span class="v">${esc(phoneCombined)}</span></div>
      <div class="kv"><span class="k">Address:</span> <span class="v">${esc(b.address) || '—'}</span></div>
    </div>

    <div class="row cols-3">
      <div class="kv"><span class="k">Vehicle:</span> <span class="v">${esc([b.vehicle_type, b.vehicle_no].filter(Boolean).join(' — ')) || '—'}</span></div>
      <div class="kv"><span class="k">Engine / Chassis:</span> <span class="v">${esc([b.engine_no, b.chassis_no].filter(Boolean).join(' / ')) || '—'}</span></div>
      <div class="kv"><span class="k">Key / S.No:</span> <span class="v">${esc([b.key_no, b.serial_no].filter(Boolean).join(' / ')) || '—'}</span></div>
    </div>

    <div class="row cols-4">
      <div class="kv"><span class="k">Loan Date:</span> <span class="v">${fmtDate(b.loan_date)}</span></div>
      <div class="kv"><span class="k">Period:</span> <span class="v">${b.period_months} months</span></div>
      <div class="kv"><span class="k">Last Due:</span> <span class="v">${lastDue}</span></div>
      <div class="kv"><span class="k">Interest:</span> <span class="v">${b.interest_rate}% / yr</span></div>
    </div>

    <div class="row cols-4">
      <div class="kv"><span class="k">Principal:</span> <span class="v">${money(b.loan_amount)}</span></div>
      <div class="kv"><span class="k">EMI:</span> <span class="v">${money(b.installment_amount)}</span></div>
      <div class="kv"><span class="k">Total Payable:</span> <span class="v">${money(s.total_payable)}</span></div>
      <div class="kv"><span class="k">Showroom:</span> <span class="v">${esc(b.showroom) || '—'}</span></div>
    </div>

    <div class="row cols-4">
      <div class="kv"><span class="k">Paid:</span> <span class="v">${money(s.total_paid)} (${installmentText(s).replace(/<[^>]+>/g,'')})</span></div>
      <div class="kv"><span class="k">Remaining:</span> <span class="v">${money(s.remaining)}</span></div>
      <div class="kv"><span class="k">Overdue:</span> ${odLine}</div>
      <div class="kv"><span class="k">Last Payment:</span> <span class="v">${fmtDate(s.last_payment_date) || '—'}</span></div>
    </div>

    <div class="row cols-3">
      <div class="kv"><span class="k">Penalties Total:</span> <span class="v">${money(s.total_penalties)}</span></div>
      <div class="kv"><span class="k">Seizing Money Total:</span> <span class="v">${money(s.total_seizings || 0)}</span></div>
      <div class="kv"><span class="k">Guarantor:</span> <span class="v">${guarLine}</span></div>
    </div>

    ${pays.length > 0 ? `
      <div class="section-title">Payments (${pays.length})</div>
      <table class="mini">
        <thead><tr><th>Date</th><th>Receipt</th><th>Inst #</th><th class="amt">Amount</th><th>Mode</th><th>Notes</th></tr></thead>
        <tbody>${payRows}</tbody>
      </table>` : `<div class="empty">No payments recorded.</div>`}

    ${pens.length > 0 ? `
      <div class="section-title">Penalties (${pens.length})</div>
      <table class="mini">
        <thead><tr><th>Date</th><th>Receipt</th><th class="amt">Amount</th><th>Notes</th></tr></thead>
        <tbody>${penRows}</tbody>
      </table>` : ''}

    ${seiz.length > 0 ? `
      <div class="section-title">Seizing Money (${seiz.length})</div>
      <table class="mini">
        <thead><tr><th>Date</th><th class="amt">Amount</th><th>Reason</th></tr></thead>
        <tbody>${seizRows}</tbody>
      </table>` : ''}
  </div>`;
}

// ── Add / Edit Borrower form ─────────────────────────────────────
function renderAddBorrower(borrower = null) {
  const isEdit = !!borrower;
  const b = borrower || {};
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">${isEdit ? 'Edit Borrower' : 'New Loan'}</div>
        <div class="page-subtitle">${isEdit ? 'Update borrower details' : 'Enter borrower and loan details'}</div>
      </div>
    </div>

    <form class="form-page" id="borrower-form" onsubmit="submitBorrower(event, ${isEdit ? b.id : 'null'})">

      <div class="book-ref-banner">
        <div class="form-group">
          <label style="font-size:14px;font-weight:700;color:#1e40af">
            📒 Book No / S.No
          </label>
          <input class="form-control book-ref-input" name="book_ref"
            value="${esc(b.book_ref || '')}"
            placeholder="e.g. M-104 · Book-2/P-45 · B3-111"
            autocomplete="off" />
          <span class="form-hint">Your physical register reference — search this number anytime to find this loan instantly.</span>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Borrower</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Name <span class="req">*</span></label>
            <input class="form-control" name="name" required value="${esc(b.name)}" placeholder="Full name" />
          </div>
          <div class="form-group">
            <label>S/o (Father's Name)</label>
            <input class="form-control" name="father_name" list="dl-father_name" autocomplete="off"
                   value="${esc(b.father_name)}" placeholder="Father's name" />
          </div>
          <div class="form-group form-full">
            <label>Address</label>
            <input class="form-control" name="address" list="dl-address" autocomplete="off"
                   value="${esc(b.address)}" placeholder="Village, Post, Taluk…" />
            <span class="form-hint">Type to see previously-used addresses.</span>
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input class="form-control" name="phone" type="tel" maxlength="10" value="${esc(b.phone)}" placeholder="10-digit mobile" />
          </div>
          <div class="form-group">
            <label>Alternate Phone</label>
            <input class="form-control" name="phone2" type="tel" maxlength="10" value="${esc(b.phone2)}" placeholder="Optional 2nd number" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Loan Terms</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Loan Date <span class="req">*</span></label>
            <div class="date-field">
              <input class="form-control" name="loan_date" type="text" required maxlength="10"
                placeholder="dd-mm-yy" inputmode="numeric"
                oninput="validateDateInput(this)"
                value="${esc(fmtDate(b.loan_date)) || todayDDMMYY()}" />
              <button type="button" class="date-pick-btn" title="Pick from calendar" onclick="openDatePicker(this)">📅</button>
            </div>
            <span class="form-hint">Format: dd-mm-yy (e.g. 19-05-26)</span>
          </div>
          <div class="form-group">
            <label>Principal Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="loan_amount" type="number" min="1" required
              value="${b.loan_amount || ''}" placeholder="e.g. 75000"
              oninput="recalcInstallment()" />
          </div>
          <div class="form-group">
            <label>Interest Rate (% per year) <span class="req">*</span></label>
            <input class="form-control" name="interest_rate" type="number" min="0" max="100" step="0.1" required
              value="${b.interest_rate || 24}" placeholder="e.g. 24"
              oninput="recalcInstallment()" />
            <span class="form-hint">Annual rate, prorated by loan months.</span>
          </div>
          <div class="form-group">
            <label>Period (months) <span class="req">*</span></label>
            <input class="form-control" name="period_months" type="number" min="1" max="240" required
              value="${b.period_months || 12}" placeholder="e.g. 12"
              oninput="recalcInstallment()" />
          </div>
          <div class="form-group">
            <label>Total Payable (auto-calculated)</label>
            <div class="calc-display" id="total-payable-display">₹0</div>
          </div>
          <div class="form-group">
            <label>Monthly Installment (₹) <span class="req">*</span></label>
            <input class="form-control" name="installment_amount" id="installment-field" type="number" min="1" required
              value="${b.installment_amount || ''}" placeholder="Auto-filled"
              oninput="onInstallmentEdited(this)" />
            <span class="form-hint">Auto-calculated. Override if needed.</span>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Guarantor</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Guarantor Name</label>
            <input class="form-control" name="guarantor_name" list="dl-guarantor_name" autocomplete="off"
                   value="${esc(b.guarantor_name)}" placeholder="Name" />
          </div>
          <div class="form-group">
            <label>Guarantor Phone</label>
            <input class="form-control" name="guarantor_phone" type="tel" maxlength="10" value="${esc(b.guarantor_phone)}" placeholder="10-digit mobile" />
          </div>
          <div class="form-group">
            <label>Guarantor Alt Phone</label>
            <input class="form-control" name="guarantor_phone2" type="tel" maxlength="10" value="${esc(b.guarantor_phone2)}" placeholder="Optional 2nd number" />
          </div>
          <div class="form-group form-full">
            <label>Guarantor Address</label>
            <input class="form-control" name="guarantor_address" list="dl-guarantor_address" autocomplete="off"
                   value="${esc(b.guarantor_address)}" placeholder="Guarantor's address" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Vehicle</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Vehicle Type</label>
            <input class="form-control" name="vehicle_type" list="dl-vehicle_type" autocomplete="off"
                   value="${esc(b.vehicle_type)}" placeholder="e.g. Splendor, Pulsar, Auto" />
          </div>
          <div class="form-group">
            <label>Vehicle Number</label>
            <input class="form-control" name="vehicle_no" value="${esc(b.vehicle_no)}" placeholder="e.g. KA-16-EZ-4459" style="text-transform:uppercase" />
          </div>
          <div class="form-group">
            <label>Engine No</label>
            <input class="form-control" name="engine_no" value="${esc(b.engine_no)}" placeholder="Engine number" />
          </div>
          <div class="form-group">
            <label>Chassis No</label>
            <input class="form-control" name="chassis_no" value="${esc(b.chassis_no)}" placeholder="Chassis number" />
          </div>
          <div class="form-group">
            <label>Key No</label>
            <input class="form-control" name="key_no" value="${esc(b.key_no)}" placeholder="Key number" />
          </div>
          <div class="form-group">
            <label>Serial No (S.No)</label>
            <input class="form-control" name="serial_no" value="${esc(b.serial_no)}" placeholder="Serial number" />
          </div>
          <div class="form-group">
            <label>Show Room</label>
            <input class="form-control" name="showroom" list="dl-showroom" autocomplete="off"
                   value="${esc(b.showroom)}" placeholder="Show room name" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Notes</div>
        <div class="form-group">
          <textarea class="form-control" name="notes" rows="3" placeholder="Any additional notes…">${esc(b.notes)}</textarea>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary" id="save-btn">
          ${isEdit ? '💾 Save Changes' : '✅ Create Loan'}
        </button>
        <button type="button" class="btn btn-outline" onclick="cancelBorrowerForm()">Cancel</button>
      </div>

      <datalist id="dl-address"></datalist>
      <datalist id="dl-guarantor_address"></datalist>
      <datalist id="dl-vehicle_type"></datalist>
      <datalist id="dl-showroom"></datalist>
      <datalist id="dl-father_name"></datalist>
      <datalist id="dl-guarantor_name"></datalist>
    </form>
  `;

  // On EDIT, the saved installment may be a deliberate manual override — mark
  // the field as user-edited BEFORE the first recalc so it isn't overwritten.
  if (isEdit && b.installment_amount) {
    const ins = document.getElementById('installment-field');
    if (ins) ins.dataset.userEdited = '1';
  }
  recalcInstallment();
  loadSuggestions();
  // Reset and start tracking edits — Cancel will warn if anything's been typed.
  _formDirty = false;
  document.getElementById('borrower-form').addEventListener('input',
    () => { _formDirty = true; }, { once: true });
}

// Called when the user types in the EMI field: lock it so the auto-calculator
// (which runs on principal/rate/period changes) stops overwriting their value.
function onInstallmentEdited(el) {
  el.dataset.userEdited = '1';
  _formDirty = true;
}

function cancelBorrowerForm() {
  if (_formDirty && !confirm('Discard unsaved changes?')) return;
  _formDirty = false;
  navigate('borrowers');
}

async function loadSuggestions() {
  try {
    const sug = await api('get_suggestions');
    for (const field of ['address', 'guarantor_address', 'vehicle_type',
                         'showroom', 'father_name', 'guarantor_name']) {
      const dl = document.getElementById('dl-' + field);
      if (!dl || !sug[field]) continue;
      dl.innerHTML = sug[field].map(v => `<option value="${esc(v)}"></option>`).join('');
    }
  } catch (e) {
    // Silent — autocomplete is non-critical
  }
}

function recalcInstallment() {
  const principal = parseFloat(document.querySelector('[name=loan_amount]')?.value) || 0;
  const rate = parseFloat(document.querySelector('[name=interest_rate]')?.value) || 0;
  const period = parseInt(document.querySelector('[name=period_months]')?.value) || 1;
  // Rate is annual (per year). Prorate over the loan period.
  const effectiveRate = rate * (period / 12);
  const total = principal + (principal * effectiveRate / 100);
  const el = document.getElementById('total-payable-display');
  const ins = document.getElementById('installment-field');
  if (el) el.textContent = money(total);
  if (ins && !ins.dataset.userEdited) ins.value = period > 0 ? Math.round(total / period) : '';
}

async function submitBorrower(e, existingId) {
  e.preventDefault();
  const form = e.target;
  const btn = document.getElementById('save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const data = {};
  new FormData(form).forEach((val, key) => { data[key] = val; });

  const iso = parseUserDate(data.loan_date);
  if (!iso) {
    btn.disabled = false; btn.textContent = existingId ? '💾 Save Changes' : '✅ Create Loan';
    toast('Loan Date is invalid. Use dd-mm-yy (e.g. 19-05-26).', 'error');
    const ld = form.querySelector('[name=loan_date]');
    if (ld) { ld.classList.add('input-invalid'); ld.focus(); ld.scrollIntoView({ block: 'center' }); }
    return;
  }
  data.loan_date = iso;

  let result;
  try {
    result = existingId
      ? await api('update_borrower', existingId, data)
      : await api('add_borrower', data);
  } catch (e) {
    // api() already showed an error toast — just un-stick the button.
    btn.disabled = false; btn.textContent = existingId ? '💾 Save Changes' : '✅ Create Loan';
    return;
  }

  btn.disabled = false; btn.textContent = existingId ? '💾 Save Changes' : '✅ Create Loan';

  if (result.success) {
    _formDirty = false;
    toast(existingId ? 'Borrower updated.' : 'Loan created successfully!', 'success');
    navigate('borrowers');
  } else {
    showApiError(result);
  }
}

// ── Borrower Detail modal ────────────────────────────────────────
async function showDetail(borrowerId) {
  loading(true);
  let data;
  try { data = await api('get_borrower_detail', borrowerId); }
  finally { loading(false); }
  if (!data) { toast('Borrower not found.', 'error'); return; }

  const { borrower: b, summary: s, payments, penalties, seizings } = data;

  const statusColor = { Overdue: 'danger', 'On time': 'success', Advance: 'success', Closed: 'gray' };
  const sc = statusColor[s.status_label] || 'gray';

  const payRows = payments.length > 0
    ? payments.map(p => `
        <tr>
          <td>${fmtDate(p.payment_date)}</td>
          <td>${esc(p.receipt_no) || '—'}</td>
          <td>${esc(p.installment_label) || '—'}</td>
          <td><strong>${money(p.amount)}</strong></td>
          <td>${modePill(p.payment_mode)}${p.showroom ? `<span class="sh-pill">🏪 ${esc(p.showroom)}</span>` : ''}</td>
          <td>${esc(p.notes) || '—'}</td>
          <td class="action-cell">
            <button class="btn btn-xs btn-outline" onclick="showEditPayment(${p.id},${b.id})">✏</button>
            <button class="btn btn-xs btn-danger-sm" onclick="deletePayment(${p.id},${b.id})">🗑</button>
          </td>
        </tr>`).join('')
    : `<tr class="no-data"><td colspan="7">No payments recorded yet.</td></tr>`;

  const penRows = penalties.length > 0
    ? penalties.map(p => `
        <tr>
          <td>${fmtDate(p.charge_date)}</td>
          <td>${esc(p.receipt_no) || '—'}</td>
          <td><strong>${money(p.amount)}</strong></td>
          <td>${esc(p.notes) || '—'}</td>
          <td class="action-cell">
            <button class="btn btn-xs btn-outline" onclick="showEditPenalty(${p.id},${b.id})">✏</button>
            <button class="btn btn-xs btn-danger-sm" onclick="deletePenalty(${p.id},${b.id})">🗑</button>
          </td>
        </tr>`).join('')
    : `<tr class="no-data"><td colspan="5">No penalties recorded.</td></tr>`;

  const seizList = seizings || [];
  const seizRows = seizList.length > 0
    ? seizList.map(p => `
        <tr>
          <td>${fmtDate(p.seizing_date)}</td>
          <td><strong>${money(p.amount)}</strong></td>
          <td>${esc(p.reason) || '—'}</td>
          <td class="action-cell">
            <button class="btn btn-xs btn-outline" onclick="showEditSeizing(${p.id},${b.id})">✏</button>
            <button class="btn btn-xs btn-danger-sm" onclick="deleteSeizing(${p.id},${b.id})">🗑</button>
          </td>
        </tr>`).join('')
    : `<tr class="no-data"><td colspan="4">No seizing money recorded.</td></tr>`;

  const closedBtn = s.closed
    ? `<button class="btn btn-sm btn-outline" onclick="reopenLoan(${b.id})">🔓 Re-open Loan</button>`
    : `<button class="btn btn-sm btn-success" onclick="confirmCloseLoan(${b.id})">✔ Mark Closed</button>`;

  // Penalty alert near the name. Two cases:
  //   1. Loan still running, past its period, money still owed -> PENALTY DUE
  //   2. Loan cleared, but the final payment came after the due date -> PAID LATE
  //      (this one stays forever as a permanent record).
  let penaltyAlert = '';
  if (b.loan_date && b.period_months) {
    const lastDue = jsAddMonths(b.loan_date, b.period_months);
    const todayStr = new Date().toISOString().split('T')[0];
    if (!s.closed && s.remaining > 0.01 && todayStr > lastDue) {
      const monthsOver = jsMonthsElapsed(lastDue, todayStr);
      const detail = monthsOver >= 1
        ? `${monthsOver} month${monthsOver > 1 ? 's' : ''} past loan period`
        : 'past loan period';
      penaltyAlert = `<div class="penalty-alert">⚠ PENALTY DUE — ${detail}
        &nbsp;·&nbsp; loan was due ${fmtDate(lastDue)}</div>`;
    } else if (s.last_payment_date && s.last_payment_date > lastDue) {
      const monthsLate = jsMonthsElapsed(lastDue, s.last_payment_date);
      const detail = monthsLate >= 1
        ? `cleared ${monthsLate} month${monthsLate > 1 ? 's' : ''} after loan period`
        : 'cleared after loan period';
      penaltyAlert = `<div class="penalty-alert">⚠ PAID LATE — ${detail}
        &nbsp;·&nbsp; loan was due ${fmtDate(lastDue)}</div>`;
    }
  }

  document.getElementById('modal-inner').innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-name">${esc(b.name)}</div>
        ${penaltyAlert}
        <div class="detail-meta">
          ${b.book_ref ? `<span class="book-ref-tag" style="font-size:13px">📒 ${esc(b.book_ref)}</span>` : ''}
          ${b.vehicle_no ? `<span>${esc(b.vehicle_no)}</span>` : ''}
          ${b.phone ? `<span>📞 ${esc(b.phone)}${b.phone2 ? `, ${esc(b.phone2)}` : ''}</span>` : ''}
          ${b.serial_no ? `<span>S.No: ${esc(b.serial_no)}</span>` : ''}
          <span>${badge(s.status_label)}</span>
        </div>
      </div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>

    <div class="detail-body">
      <div class="detail-info">
        <div class="detail-section-title">Loan Info</div>
        <div class="info-grid">
          ${infoRow('S/o', b.father_name)}
          ${infoRow('Address', b.address)}
          ${infoRow('Alt Phone', b.phone2)}
          ${infoRow('Guarantor', b.guarantor_name ? `${b.guarantor_name} — ${b.guarantor_phone || '—'}${b.guarantor_phone2 ? `, ${b.guarantor_phone2}` : ''}` : null)}
          ${infoRow('Guar. Address', b.guarantor_address)}
          ${infoRow('Vehicle Type', b.vehicle_type)}
          ${infoRow('Engine / Chassis', [b.engine_no, b.chassis_no].filter(Boolean).join(' / ') || null)}
          ${infoRow('Key No / S.No', [b.key_no, b.serial_no].filter(Boolean).join(' / ') || null)}
          ${infoRow('Show Room', b.showroom)}
          ${infoRow('Loan Date', fmtDate(b.loan_date))}
          ${infoRow('Period', `${b.period_months} months`)}
          ${infoRow('Last Payment Due', b.loan_date && b.period_months
              ? fmtDate(jsAddMonths(b.loan_date, b.period_months)) : null, 'val-red')}
          ${infoRow('Principal', money(b.loan_amount))}
          ${infoRow('Interest', `${b.interest_rate}% per year`)}
          ${infoRow('Installment', money(b.installment_amount))}
        </div>
      </div>

      <div class="detail-summary">
        <div class="detail-section-title">Summary</div>
        <div class="summary-row"><span class="summary-key">Total Payable</span><span class="summary-val">${money(s.total_payable)}</span></div>
        <div class="summary-row"><span class="summary-key">Paid So Far</span><span class="summary-val primary">${money(s.total_paid)}</span></div>
        <div class="summary-row"><span class="summary-key">Remaining</span><span class="summary-val">${money(s.remaining)}</span></div>
        <div class="summary-row"><span class="summary-key">Installments</span><span class="summary-val">${installmentText(s)}</span></div>
        <div class="summary-row"><span class="summary-key">Expected by Today</span><span class="summary-val">${money(s.expected_paid_by_today)}</span></div>
        <div class="summary-row">
          <span class="summary-key">Overdue Amount</span>
          <span class="summary-val ${s.is_overdue ? 'danger' : 'success'}">${s.is_overdue ? money(s.overdue_amount) : '—'}</span>
        </div>
        <div class="summary-row">
          <span class="summary-key">Days Overdue</span>
          <span class="summary-val ${s.is_overdue ? 'danger' : ''}">${s.is_overdue ? s.days_overdue + ' days' : '—'}</span>
        </div>
        <div class="summary-row"><span class="summary-key">Months Elapsed</span><span class="summary-val">${s.months_elapsed} / ${s.period_months}</span></div>
        <div class="summary-row"><span class="summary-key">Penalties Paid</span><span class="summary-val">${money(s.total_penalties)}</span></div>
        <div class="summary-row"><span class="summary-key">Seizing Money</span><span class="summary-val">${money(s.total_seizings || 0)}</span></div>
        <div class="summary-row"><span class="summary-key">Last Payment</span><span class="summary-val">${fmtDate(s.last_payment_date) || '—'}</span></div>
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn btn-sm btn-primary" onclick="showAddPayment(${b.id})">➕ Add Payment</button>
      <button class="btn btn-sm btn-outline" onclick="showAddPenalty(${b.id})">⚠ Add Penalty (O/D)</button>
      <button class="btn btn-sm btn-outline" onclick="showAddSeizing(${b.id})">🚚 Add Seizing Money</button>
      <button class="btn btn-sm btn-outline" onclick="showPaymentSchedule(${b.id})">📅 Schedule</button>
      ${b.phone ? `<button class="btn btn-sm btn-outline" title="Send WhatsApp reminder"
        data-phone="${esc(b.phone)}" data-name="${esc(b.name)}"
        data-amt="${esc(money(s.is_overdue ? s.overdue_amount : s.installment_amount))}"
        data-kind="${s.is_overdue ? 'overdue' : 'due'}" onclick="remindFromBtn(this)">💬 Remind</button>` : ''}
      <button class="btn btn-sm btn-outline" onclick="printBorrowerStatement(${b.id})">🖨 Print</button>
      <button class="btn btn-sm btn-outline" onclick="closeModal(); navigate('add'); loadEditForm(${b.id})">✏ Edit</button>
      ${closedBtn}
    </div>

    <div class="detail-tables">
      <div class="detail-table-section">
        <h4>Payments</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Receipt</th><th>Inst#</th><th>Amount</th><th>Mode</th><th>Notes</th><th></th></tr></thead>
            <tbody>${payRows}</tbody>
          </table>
        </div>
      </div>
      <div class="detail-table-section">
        <h4>Penalties (O/D)</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Receipt</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
            <tbody>${penRows}</tbody>
          </table>
        </div>
      </div>
      <div class="detail-table-section">
        <h4>Seizing Money (O/D)</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Amount</th><th>Reason</th><th></th></tr></thead>
            <tbody>${seizRows}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="detail-danger">
      <button class="btn btn-sm btn-danger" data-bid="${b.id}" data-bname="${esc(b.name)}" onclick="confirmDeleteBorrower(this)">🗑 Delete this borrower</button>
      <span class="detail-danger-hint">Permanently removes this borrower and all their payments, penalties &amp; seizing entries.</span>
    </div>
  `;

  openModal();
}

function infoRow(key, val, valClass) {
  if (!val) return '';
  const cls = valClass ? ` ${valClass}` : '';
  return `<div class="info-row"><span class="info-key">${esc(key)}</span><span class="info-val${cls}">${esc(val)}</span></div>`;
}

// ── Add Payment / Penalty modals ─────────────────────────────────
const MAX_PAYMENTS_AT_ONCE = 60;  // safety cap for the Custom option

async function showAddPayment(borrowerId) {
  // Single payment by default — the common case. "Add another payment" appends
  // more blocks for the occasional bulk back-entry (capped for safety).
  await ensureShowroomOpts();   // for the showroom datalist in each block
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3>Add Payment</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <label style="font-size:13px;font-weight:600;color:var(--text);margin:0">How many payments to add?</label>
        <input type="number" id="pay-count" class="form-control" min="1" max="${MAX_PAYMENTS_AT_ONCE}" value="1"
          style="width:84px" oninput="setPaymentCount(this.value)" />
        <span style="font-size:12.5px;color:var(--text-muted)">type a number (max ${MAX_PAYMENTS_AT_ONCE})</span>
      </div>
      <form onsubmit="submitPaymentBatch(event, ${borrowerId})">
        <div class="pay-blocks-wrap" id="pay-blocks-wrap"></div>
        <button type="button" class="btn btn-outline btn-sm" style="margin-top:4px"
          onclick="addPaymentBlock()">➕ Add another payment</button>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button type="submit" class="btn btn-primary">Save</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
      ${showroomDatalistHtml('dl-pay-showroom')}
    </div>`;
  buildPaymentBlocks(1);
  openModal();
}

// Build exactly N payment blocks from the "How many payments?" box.
function setPaymentCount(v) {
  let n = parseInt(v, 10) || 1;
  if (n < 1) n = 1;
  if (n > MAX_PAYMENTS_AT_ONCE) n = MAX_PAYMENTS_AT_ONCE;
  buildPaymentBlocks(n);
}

// Append one more payment block (up to the safety cap), keeping typed values.
function addPaymentBlock() {
  const n = document.querySelectorAll('#pay-blocks-wrap .pay-block').length;
  if (n >= MAX_PAYMENTS_AT_ONCE) {
    toast(`You can add up to ${MAX_PAYMENTS_AT_ONCE} payments at once.`, 'info');
    return;
  }
  buildPaymentBlocks(n + 1);
}

// Remove one payment block by index, keeping the rest of the typed values.
function removePaymentBlock(i) {
  const rows = _readPaymentBlocks();
  if (rows.length <= 1) return;
  rows.splice(i, 1);
  buildPaymentBlocks(rows.length, rows);
}

// Read whatever is currently typed in the payment blocks (preserved across rebuilds).
function _readPaymentBlocks() {
  const out = [];
  document.querySelectorAll('#pay-blocks-wrap .pay-block').forEach(blk => {
    const get = sel => { const el = blk.querySelector(sel); return el ? el.value : ''; };
    const modeRadio = blk.querySelector('input[type="radio"]:checked');
    out.push({
      payment_date: get('.pb-date'),
      receipt_no: get('.pb-receipt'),
      amount: get('.pb-amount'),
      installment_label: get('.pb-label'),
      notes: get('.pb-notes'),
      payment_mode: modeRadio ? modeRadio.value : '',   // empty if user didn't pick
      showroom: get('.pb-showroom'),
    });
  });
  return out;
}

function buildPaymentBlocks(count, preset) {
  count = Math.max(1, Math.min(MAX_PAYMENTS_AT_ONCE, count || 1));
  const existing = preset || _readPaymentBlocks();   // keep anything already typed
  const today = todayDDMMYY();
  let html = '';
  for (let i = 1; i <= count; i++) {
    const prev = existing[i - 1];   // undefined for newly-added blocks
    const d = prev ? prev.payment_date : today;
    const r = prev ? prev.receipt_no : '';
    const a = prev ? prev.amount : '';
    const l = prev ? prev.installment_label : '';
    const n = prev ? prev.notes : '';
    const mode = prev ? (prev.payment_mode || '') : '';   // new blocks start unselected
    const sh = prev ? (prev.showroom || '') : '';
    html += `
      <div class="pay-block">
        <div class="pay-block-title">Payment ${i}
          ${count > 1 ? `<button type="button" class="pay-block-del" title="Remove this payment" onclick="removePaymentBlock(${i - 1})">✕</button>` : ''}
        </div>
        <div class="form-grid">
          <div class="form-group">
            <label>Payment Date <span class="req">*</span></label>
            <div class="date-field">
              <input class="form-control pb-date" type="text" maxlength="10"
                placeholder="dd-mm-yy" inputmode="numeric"
                oninput="validateDateInput(this)" value="${esc(d)}" />
              <button type="button" class="date-pick-btn" title="Pick from calendar" onclick="openDatePicker(this)">📅</button>
            </div>
          </div>
          <div class="form-group">
            <label>Receipt No</label>
            <input class="form-control pb-receipt" placeholder="Receipt number" value="${esc(r)}" />
          </div>
          <div class="form-group">
            <label>Amount (₹) <span class="req">*</span></label>
            <input class="form-control pb-amount" type="number" min="1" placeholder="e.g. 7750" value="${esc(a)}" />
          </div>
          <div class="form-group">
            <label>Installment Label</label>
            <input class="form-control pb-label" placeholder="e.g. 1st, 2nd" value="${esc(l)}" />
          </div>
          <div class="form-group form-full">
            <label>Payment Mode &amp; Showroom</label>
            <div class="mode-showroom-row">
              ${modeChips(`pay-mode-${i}`, mode)}
              <input class="form-control pb-showroom" list="dl-pay-showroom"
                placeholder="Showroom (optional)" value="${esc(sh)}" autocomplete="off" />
            </div>
          </div>
          <div class="form-group form-full">
            <label>Notes</label>
            <input class="form-control pb-notes" placeholder="Optional notes" value="${esc(n)}" />
          </div>
        </div>
      </div>`;
  }
  document.getElementById('pay-blocks-wrap').innerHTML = html;
  const cnt = document.getElementById('pay-count');   // keep the count box in sync
  if (cnt && String(count) !== cnt.value) cnt.value = count;
}

async function submitPaymentBatch(e, borrowerId) {
  e.preventDefault();
  const rows = _readPaymentBlocks();
  const payments = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const iso = parseUserDate((row.payment_date || '').trim());
    if (!iso) { toast(`Payment ${i + 1}: date is invalid. Use dd-mm-yy.`, 'error'); return; }
    const amount = parseFloat((row.amount || '').trim());
    if (!amount || amount <= 0) { toast(`Payment ${i + 1}: enter a valid amount.`, 'error'); return; }
    payments.push({
      payment_date: iso,
      amount: amount,
      receipt_no: row.receipt_no,
      installment_label: row.installment_label,
      notes: row.notes,
      payment_mode: row.payment_mode || '',
      showroom: row.showroom || '',
    });
  }
  const r = await api('add_payments_batch', borrowerId, payments);
  if (r.success) {
    _viewDirty = true;
    toast(`${r.count} payment(s) saved!`, 'success');
    showDetail(borrowerId);
  } else {
    showApiError(r);
  }
}

function showAddPenalty(borrowerId) {
  const today = todayDDMMYY();
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3>Add Penalty (O/D Charge)</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <form onsubmit="submitPenalty(event, ${borrowerId})">
        <div class="form-grid" style="margin-bottom:16px">
          <div class="form-group">
            <label>Charge Date <span class="req">*</span></label>
            <div class="date-field">
              <input class="form-control" name="charge_date" type="text" required maxlength="10"
                placeholder="dd-mm-yy" inputmode="numeric"
                oninput="validateDateInput(this)" value="${today}" />
              <button type="button" class="date-pick-btn" title="Pick from calendar" onclick="openDatePicker(this)">📅</button>
            </div>
          </div>
          <div class="form-group">
            <label>Receipt No</label>
            <input class="form-control" name="receipt_no" placeholder="Receipt number" />
          </div>
          <div class="form-group">
            <label>Penalty Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="amount" type="number" min="1" required placeholder="e.g. 500" />
          </div>
          <div class="form-group form-full">
            <label>Notes</label>
            <input class="form-control" name="notes" placeholder="O/D reason, etc." />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn btn-danger">Save Penalty</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
    </div>`;
}

async function submitPenalty(e, borrowerId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = { borrower_id: borrowerId };
  fd.forEach((v, k) => { data[k] = v; });
  const iso = parseUserDate(data.charge_date);
  if (!iso) { toast('Charge Date invalid. Use dd-mm-yy.', 'error'); return; }
  data.charge_date = iso;
  const result = await api('add_penalty', data);
  if (result.success) { _viewDirty = true; toast('Penalty saved!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + result.error, 'error');
}

// ── Delete payment / penalty ─────────────────────────────────────
// Fetch one sub-record (payment/penalty/seizing) so a delete can offer Undo.
async function _grabRecord(borrowerId, kind, id) {
  try {
    const d = await api('get_borrower_detail', borrowerId);
    return ((d && d[kind]) || []).find(x => x.id === id) || null;
  } catch (_) { return null; }
}

function deletePayment(paymentId, borrowerId) {
  requirePasswordThen(
    'This will delete this payment.',
    'Delete this payment?',
    async (pwd) => {
      const rec = await _grabRecord(borrowerId, 'payments', paymentId);
      const r = await api('delete_payment', paymentId, pwd || '');
      if (r.success) {
        _viewDirty = true; showDetail(borrowerId);
        toast('Payment deleted.', 'success', rec ? { label: 'Undo', onClick: () => undoPayment(borrowerId, rec) } : null);
      } else toast('Error: ' + r.error, 'error');
    });
}

function undoPayment(borrowerId, rec) {
  api('add_payment', {
    borrower_id: borrowerId, payment_date: rec.payment_date, amount: rec.amount,
    receipt_no: rec.receipt_no || '', installment_label: rec.installment_label || '',
    notes: rec.notes || '', payment_mode: rec.payment_mode || '', showroom: rec.showroom || '',
  }).then(r => {
    if (r && r.success) { _viewDirty = true; toast('Payment restored.', 'success'); showDetail(borrowerId); }
    else toast('Could not undo: ' + (r && r.error || 'unknown'), 'error');
  }).catch(() => {});
}

function deletePenalty(penaltyId, borrowerId) {
  requirePasswordThen(
    'This will delete this penalty entry.',
    'Delete this penalty?',
    async (pwd) => {
      const rec = await _grabRecord(borrowerId, 'penalties', penaltyId);
      const r = await api('delete_penalty', penaltyId, pwd || '');
      if (r.success) {
        _viewDirty = true; showDetail(borrowerId);
        toast('Penalty deleted.', 'success', rec ? { label: 'Undo', onClick: () => undoPenalty(borrowerId, rec) } : null);
      } else toast('Error: ' + r.error, 'error');
    });
}

function undoPenalty(borrowerId, rec) {
  api('add_penalty', {
    borrower_id: borrowerId, charge_date: rec.charge_date, amount: rec.amount,
    receipt_no: rec.receipt_no || '', notes: rec.notes || '',
  }).then(r => {
    if (r && r.success) { _viewDirty = true; toast('Penalty restored.', 'success'); showDetail(borrowerId); }
    else toast('Could not undo: ' + (r && r.error || 'unknown'), 'error');
  }).catch(() => {});
}

// ── Edit payment / penalty ───────────────────────────────────────
async function showEditPayment(paymentId, borrowerId) {
  let detail;
  try { detail = await api('get_borrower_detail', borrowerId); } catch (e) { return; }
  if (!detail || !detail.payments) return;
  const p = detail.payments.find(x => x.id === paymentId);
  if (!p) return;
  await ensureShowroomOpts();
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3>Edit Payment</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <form onsubmit="submitEditPayment(event,${paymentId},${borrowerId})">
        <div class="form-grid" style="margin-bottom:16px">
          <div class="form-group">
            <label>Payment Date <span class="req">*</span></label>
            <input class="form-control" name="payment_date" type="text" required maxlength="10"
              placeholder="dd-mm-yy" inputmode="numeric"
              oninput="validateDateInput(this)" value="${esc(fmtDate(p.payment_date))}" />
          </div>
          <div class="form-group">
            <label>Receipt No</label>
            <input class="form-control" name="receipt_no" value="${esc(p.receipt_no || '')}" />
          </div>
          <div class="form-group">
            <label>Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="amount" type="number" min="1" required value="${p.amount}" />
          </div>
          <div class="form-group">
            <label>Installment Label</label>
            <input class="form-control" name="installment_label" value="${esc(p.installment_label || '')}" />
          </div>
          <div class="form-group form-full">
            <label>Payment Mode &amp; Showroom</label>
            <div class="mode-showroom-row">
              ${modeChips('payment_mode', p.payment_mode || '')}
              <input class="form-control" name="showroom" list="dl-pay-showroom"
                placeholder="Showroom (optional)" value="${esc(p.showroom || '')}" autocomplete="off" />
            </div>
          </div>
          <div class="form-group form-full">
            <label>Notes</label>
            <input class="form-control" name="notes" value="${esc(p.notes || '')}" />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn btn-primary">Update Payment</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
      ${showroomDatalistHtml('dl-pay-showroom')}
    </div>`;
  openModal();
}

async function submitEditPayment(e, paymentId, borrowerId) {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v, k) => { data[k] = v; });
  if (!data.payment_mode) data.payment_mode = '';   // allow clearing
  const iso = parseUserDate(data.payment_date);
  if (!iso) { toast('Payment Date invalid. Use dd-mm-yy.', 'error'); return; }
  data.payment_date = iso;
  const r = await api('update_payment', paymentId, data);
  if (r.success) { _viewDirty = true; toast('Payment updated!', 'success'); showDetail(borrowerId); }
  else showApiError(r);
}

async function showEditPenalty(penaltyId, borrowerId) {
  let detail;
  try { detail = await api('get_borrower_detail', borrowerId); } catch (e) { return; }
  if (!detail || !detail.penalties) return;
  const p = detail.penalties.find(x => x.id === penaltyId);
  if (!p) return;
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3>Edit Penalty</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <form onsubmit="submitEditPenalty(event,${penaltyId},${borrowerId})">
        <div class="form-grid" style="margin-bottom:16px">
          <div class="form-group">
            <label>Charge Date <span class="req">*</span></label>
            <input class="form-control" name="charge_date" type="text" required maxlength="10"
              placeholder="dd-mm-yy" inputmode="numeric"
              oninput="validateDateInput(this)" value="${esc(fmtDate(p.charge_date))}" />
          </div>
          <div class="form-group">
            <label>Receipt No</label>
            <input class="form-control" name="receipt_no" value="${esc(p.receipt_no || '')}" />
          </div>
          <div class="form-group">
            <label>Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="amount" type="number" min="1" required value="${p.amount}" />
          </div>
          <div class="form-group form-full">
            <label>Notes</label>
            <input class="form-control" name="notes" value="${esc(p.notes || '')}" />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn btn-danger">Update Penalty</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
    </div>`;
  openModal();
}

async function submitEditPenalty(e, penaltyId, borrowerId) {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v, k) => { data[k] = v; });
  const iso = parseUserDate(data.charge_date);
  if (!iso) { toast('Charge Date invalid. Use dd-mm-yy.', 'error'); return; }
  data.charge_date = iso;
  const r = await api('update_penalty', penaltyId, data);
  if (r.success) { _viewDirty = true; toast('Penalty updated!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

// ── Seizing money (O/D recovery costs) ───────────────────────────
function showAddSeizing(borrowerId) {
  const today = todayDDMMYY();
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3>Add Seizing Money</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <form onsubmit="submitSeizing(event, ${borrowerId})">
        <div class="form-grid" style="margin-bottom:16px">
          <div class="form-group">
            <label>Date <span class="req">*</span></label>
            <div class="date-field">
              <input class="form-control" name="seizing_date" type="text" required maxlength="10"
                placeholder="dd-mm-yy" inputmode="numeric"
                oninput="validateDateInput(this)" value="${today}" />
              <button type="button" class="date-pick-btn" title="Pick from calendar" onclick="openDatePicker(this)">📅</button>
            </div>
          </div>
          <div class="form-group">
            <label>Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="amount" type="number" min="1" required placeholder="e.g. 1500" />
          </div>
          <div class="form-group form-full">
            <label>Reason</label>
            <input class="form-control" name="reason" placeholder="e.g. towing, garage, recovery agent" />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn btn-danger">Save Seizing Money</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
    </div>`;
}

async function submitSeizing(e, borrowerId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = { borrower_id: borrowerId };
  fd.forEach((v, k) => { data[k] = v; });
  const iso = parseUserDate(data.seizing_date);
  if (!iso) { toast('Date invalid. Use dd-mm-yy.', 'error'); return; }
  data.seizing_date = iso;
  const result = await api('add_seizing', data);
  if (result.success) { _viewDirty = true; toast('Seizing money saved!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + result.error, 'error');
}

function deleteSeizing(seizingId, borrowerId) {
  requirePasswordThen(
    'This will delete this seizing money entry.',
    'Delete this seizing money entry?',
    async (pwd) => {
      const rec = await _grabRecord(borrowerId, 'seizings', seizingId);
      const r = await api('delete_seizing', seizingId, pwd || '');
      if (r.success) {
        _viewDirty = true; showDetail(borrowerId);
        toast('Seizing entry deleted.', 'success', rec ? { label: 'Undo', onClick: () => undoSeizing(borrowerId, rec) } : null);
      } else toast('Error: ' + r.error, 'error');
    });
}

function undoSeizing(borrowerId, rec) {
  api('add_seizing', {
    borrower_id: borrowerId, seizing_date: rec.seizing_date, amount: rec.amount,
    reason: rec.reason || '',
  }).then(r => {
    if (r && r.success) { _viewDirty = true; toast('Seizing entry restored.', 'success'); showDetail(borrowerId); }
    else toast('Could not undo: ' + (r && r.error || 'unknown'), 'error');
  }).catch(() => {});
}

async function showEditSeizing(seizingId, borrowerId) {
  let detail;
  try { detail = await api('get_borrower_detail', borrowerId); } catch (e) { return; }
  if (!detail) return;
  const p = (detail.seizings || []).find(x => x.id === seizingId);
  if (!p) return;
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3>Edit Seizing Money</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <form onsubmit="submitEditSeizing(event,${seizingId},${borrowerId})">
        <div class="form-grid" style="margin-bottom:16px">
          <div class="form-group">
            <label>Date <span class="req">*</span></label>
            <input class="form-control" name="seizing_date" type="text" required maxlength="10"
              placeholder="dd-mm-yy" inputmode="numeric"
              oninput="validateDateInput(this)" value="${esc(fmtDate(p.seizing_date))}" />
          </div>
          <div class="form-group">
            <label>Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="amount" type="number" min="1" required value="${p.amount}" />
          </div>
          <div class="form-group form-full">
            <label>Reason</label>
            <input class="form-control" name="reason" value="${esc(p.reason || '')}" />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn btn-danger">Update Seizing Money</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
    </div>`;
  openModal();
}

async function submitEditSeizing(e, seizingId, borrowerId) {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v, k) => { data[k] = v; });
  const iso = parseUserDate(data.seizing_date);
  if (!iso) { toast('Date invalid. Use dd-mm-yy.', 'error'); return; }
  data.seizing_date = iso;
  const r = await api('update_seizing', seizingId, data);
  if (r.success) { _viewDirty = true; toast('Seizing money updated!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

// ── Close / reopen loan ──────────────────────────────────────────
async function confirmCloseLoan(borrowerId) {
  if (!confirm('Mark this loan as fully closed? This removes it from the overdue list.')) return;
  const r = await api('close_loan', borrowerId);
  if (r.success) { _viewDirty = true; toast('Loan marked as closed.', 'success'); closeModal(); }
  else toast('Error: ' + r.error, 'error');
}

async function reopenLoan(borrowerId) {
  const r = await api('reopen_loan', borrowerId);
  if (r.success) { _viewDirty = true; toast('Loan re-opened.', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

function confirmDeleteBorrower(btn) {
  const borrowerId = parseInt(btn.dataset.bid, 10);
  const name = btn.dataset.bname || 'this borrower';
  const longMsg = `PERMANENTLY DELETE "${name}"?\n\n` +
                  `This will also delete ALL their payments, penalties, and seizing money entries.\n` +
                  `This CANNOT be undone.\n\n` +
                  `Click OK to delete, Cancel to keep.`;
  // Always require the two-step confirm dialog (independent of the password
  // gate) so the user is forced to read the consequences.
  if (!confirm(longMsg)) return;
  if (!confirm(`Really delete "${name}"? Last chance — click OK to confirm.`)) return;
  requirePasswordThen(
    `This will delete borrower "${name}" and ALL their payments / penalties / seizings. It cannot be undone.`,
    `Final confirmation: delete "${name}" now?`,
    async (pwd) => {
      const r = await api('delete_borrower', borrowerId, pwd || '');
      if (r.success) {
        _viewDirty = true;
        toast(`${name} deleted permanently.`, 'success');
        closeModal();
      } else {
        toast('Error: ' + r.error, 'error');
      }
    });
}

// ── Edit borrower (from detail modal) ───────────────────────────
async function loadEditForm(borrowerId) {
  loading(true);
  let data;
  try { data = await api('get_borrower_detail', borrowerId); }
  finally { loading(false); }
  if (!data) return;
  renderAddBorrower(data.borrower);
}

// ── CSV Export ───────────────────────────────────────────────────
async function exportCSV() {
  loading(true);
  let r;
  try { r = await api('export_csv'); }
  finally { loading(false); }
  if (r.success) toast(`Exported ${r.count} row(s) → ${r.path}`, 'success');
  else toast('Export failed: ' + (r.error || 'unknown'), 'error');
}

// ── Modal helpers ────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-inner').innerHTML = '';
  if (_viewDirty) { _viewDirty = false; refreshCurrentView(); }
}

function handleOverlayClick(e) {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
}

// Cancel a password prompt and run its onCancel (e.g. to revert a toggle).
function pwCancel() {
  const cb = window._pwOnCancel;
  window._pwOnCancel = null;
  closeModal();
  if (cb) cb();
}

// ── Keyboard shortcuts ───────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
  if (e.key === 'F5') { e.preventDefault(); refreshCurrentView(); }
});

// ── Portfolio view ───────────────────────────────────────────────
async function renderPortfolio() {
  loading(true);
  let p;
  try { p = await api('get_portfolio_summary'); }
  finally { loading(false); }

  const collectedPct = p.total_payable > 0
    ? Math.min(100, Math.round((p.total_collected / p.total_payable) * 100))
    : 0;

  // ── "If every customer clears their dues" ──
  // Loan money only (principal + interest) — penalties/seizing excluded.
  const fcAlreadyIn   = p.total_collected || 0;   // already received
  const fcStillToCome = p.total_outstanding || 0; // remaining to receive
  const fcGrandTotal  = p.total_payable || 0;      // already + remaining
  const fcRemainPct   = Math.max(0, 100 - collectedPct);
  const fcStillOwing  = p.active_loans || 0;       // customers who haven't cleared yet
  const fcFullyDone   = fcStillToCome <= 0 && fcGrandTotal > 0;

  // Cache the payload so the month selector can re-render without refetching.
  window._portfolioData = p;
  window._selMonth = (p.this_month || {}).month || '';
  const nowLabel = (p.this_month || {}).label || '';

  // ── Interest earned vs expected ──
  const intExp = p.total_interest_expected || 0;
  const intEarned = p.total_interest_earned || 0;
  const intPct = intExp > 0 ? Math.min(100, Math.round((intEarned / intExp) * 100)) : 0;

  // ── 6-month collection trend (bars scaled to the biggest month) ──
  const monthly = p.monthly || [];
  const maxC = Math.max(1, ...monthly.map(m => m.collected || 0));
  const trendBars = monthly.map(m => {
    const w = Math.round(((m.collected || 0) / maxC) * 100);
    const isNow = m.label === nowLabel;
    return `
      <div class="mtrend-row">
        <div class="mtrend-label">${esc(m.label)}${isNow ? ' •' : ''}</div>
        <div class="mtrend-bar-wrap"><div class="mtrend-bar${isNow ? ' now' : ''}" style="width:${w}%"></div></div>
        <div class="mtrend-val">${money(m.collected || 0)}<span class="mtrend-int">int ${money(m.interest || 0)}</span></div>
      </div>`;
  }).join('');

  // ── Collections by showroom (all-time) ──
  const shRows = (p.by_showroom || []).map(r => `
    <tr>
      <td><strong>${esc(r.showroom)}</strong></td>
      <td>${r.loans}</td>
      <td>${money(r.principal)}</td>
      <td>${money(r.collected)}</td>
      <td>${r.outstanding > 0 ? money(r.outstanding) : '—'}</td>
    </tr>`).join('') || '<tr class="no-data"><td colspan="5">No showroom data yet.</td></tr>';

  // ── Loan health breakdown (counts + still-owed per status) ──
  const sb = p.status_breakdown || {};
  const sbDefs = [
    ['overdue', 'danger',  'Behind on payments'],
    ['on_time', 'success', 'Paying on schedule'],
    ['advance', 'primary', 'Paid ahead'],
    ['closed',  'gray',    'Fully cleared'],
  ];
  const sbTotal = sbDefs.reduce((t, [k]) => t + ((sb[k] || {}).count || 0), 0) || 1;
  const healthCards = sbDefs.map(([k, cls, sub]) => {
    const r = sb[k] || { label: k, count: 0, outstanding: 0 };
    const owed = (k !== 'closed' && r.outstanding > 0) ? money(r.outstanding) + ' owed' : sub;
    return `
      <div class="stat-card ${cls}">
        <div class="stat-label">${esc(r.label || k)}</div>
        <div class="stat-value ${cls === 'gray' ? '' : cls}" style="font-size:22px">${r.count}</div>
        <div class="stat-sub">${owed}</div>
      </div>`;
  }).join('');
  const healthBar = sbDefs.map(([k, cls]) => {
    const pct = Math.round(((sb[k] || {}).count || 0) / sbTotal * 100);
    return pct > 0 ? `<div class="lh-seg lh-${cls}" style="width:${pct}%" title="${esc((sb[k] || {}).label || k)}: ${(sb[k] || {}).count || 0}"></div>` : '';
  }).join('');

  // ── Key numbers (KPIs) ──
  const kpis = [
    [money(p.avg_loan || 0), 'Average loan size'],
    [(p.avg_rate || 0).toFixed(0) + '%', 'Avg interest rate / yr'],
    [Math.round(p.avg_period || 0) + ' mo', 'Avg loan period'],
    [money(p.biggest_loan || 0), 'Biggest single loan'],
  ];
  const kpiHtml = kpis.map(([v, l]) =>
    `<div class="kpi"><div class="kpi-val">${v}</div><div class="kpi-label">${l}</div></div>`).join('');

  // ── Cash-flow forecast (money coming in soon) ──
  const up = p.upcoming || {};
  const upRows = (up.list || []).map(u => `
    <div class="up-row clickable" onclick="showDetail(${u.borrower_id})">
      <span class="up-name">${esc(u.name)}</span>
      <span class="up-when">${u.days_until === 0 ? 'today' : u.days_until === 1 ? 'tomorrow' : 'in ' + u.days_until + ' days'} · ${esc(u.due_date)}</span>
      <span class="up-amt">${money(u.amount)}</span>
    </div>`).join('') || '<div class="fc-empty" style="padding:14px 20px">No installments due in the near future.</div>';

  document.getElementById('view').innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Portfolio Summary</div>
        <div class="page-subtitle">Overall health of your lending book</div>
      </div>
    </div>

    <div class="card" style="margin-bottom:16px;border:2px solid var(--primary)">
      <div class="card-header"><span class="card-title">💰 If Every Customer Clears Their Dues</span></div>
      <div class="fc-clear">
        <div class="fc-clear-item">
          <div class="stat-label">Already Collected</div>
          <div class="stat-value success" style="font-size:24px">${money(fcAlreadyIn)}</div>
          <div class="stat-sub">Money received so far</div>
        </div>
        <div class="fc-clear-op">+</div>
        <div class="fc-clear-item">
          <div class="stat-label">Still To Receive</div>
          <div class="stat-value ${fcStillToCome > 0 ? 'danger' : ''}" style="font-size:24px">${money(fcStillToCome)}</div>
          <div class="stat-sub">Outstanding from all customers</div>
        </div>
        <div class="fc-clear-op">=</div>
        <div class="fc-clear-item fc-clear-total">
          <div class="stat-label">Grand Total In Hand</div>
          <div class="stat-value" style="font-size:26px;color:var(--success)">${money(fcGrandTotal)}</div>
          <div class="stat-sub">Once everyone fully clears</div>
        </div>
      </div>
      <div class="fc-clear-foot">
        <div class="fc-clear-barhead">
          <span><strong style="color:var(--success)">${collectedPct}%</strong> collected</span>
          <span><strong>${fcRemainPct}%</strong> still to come</span>
        </div>
        <div class="fc-clear-bar"><div class="fc-clear-bar-fill" style="width:${collectedPct}%"></div></div>
        <div class="fc-clear-note">
          ${fcFullyDone
            ? `🎉 Every customer has cleared their dues. You have received the full <strong>${money(fcGrandTotal)}</strong>.`
            : `You've already received <strong style="color:var(--success)">${money(fcAlreadyIn)}</strong>. If all <strong>${fcStillOwing}</strong> customer(s) who still owe pay off their balance, another <strong style="color:var(--danger)">${money(fcStillToCome)}</strong> comes in — bringing your total to <strong>${money(fcGrandTotal)}</strong>.`}
        </div>
        <div class="fc-clear-hint">Assumes every loan is paid in full (principal + interest). Penalties &amp; seizing costs are not included.</div>
      </div>
    </div>

    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
      <div class="stat-card primary">
        <div class="stat-label">Total Capital Lent</div>
        <div class="stat-value primary" style="font-size:22px">${money(p.total_principal)}</div>
        <div class="stat-sub">${p.total_loans} loan(s) total</div>
      </div>
      <div class="stat-card primary">
        <div class="stat-label">Total Payable (with interest)</div>
        <div class="stat-value primary" style="font-size:22px">${money(p.total_payable)}</div>
        <div class="stat-sub">Principal + flat interest</div>
      </div>
      <div class="stat-card gray">
        <div class="stat-label">Loans</div>
        <div class="stat-value" style="font-size:22px">${p.active_loans} active · ${p.closed_loans} closed</div>
        <div class="stat-sub">${p.total_loans} total</div>
      </div>
    </div>

    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="stat-card primary">
        <div class="stat-label">Total Collected</div>
        <div class="stat-value primary" style="font-size:22px">${money(p.total_collected)}</div>
        <div class="stat-sub">${collectedPct}% of total payable recovered</div>
      </div>
      <div class="stat-card ${p.total_outstanding > 0 ? 'danger' : 'gray'}">
        <div class="stat-label">Outstanding (still owed)</div>
        <div class="stat-value ${p.total_outstanding > 0 ? 'danger' : ''}" style="font-size:22px">${money(p.total_outstanding)}</div>
        <div class="stat-sub">Remaining across all active loans</div>
      </div>
      <div class="stat-card ${p.overdue_count > 0 ? 'danger' : 'gray'}">
        <div class="stat-label">Overdue</div>
        <div class="stat-value ${p.overdue_count > 0 ? 'danger' : ''}" style="font-size:22px">${money(p.total_overdue_amount)}</div>
        <div class="stat-sub">${p.overdue_count} borrower(s) behind on payments</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Loan Health — Where Your Book Stands</span></div>
      <div style="padding:16px 20px 6px">
        <div class="lh-bar">${healthBar}</div>
      </div>
      <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);padding:6px 20px 18px;gap:12px">
        ${healthCards}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Key Numbers</span></div>
      <div class="kpi-row">${kpiHtml}</div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Money Coming In Soon — Cash-Flow Forecast</span></div>
      <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);padding:18px 20px 8px;gap:12px">
        <div class="stat-card success">
          <div class="stat-label">Expected Next 7 Days</div>
          <div class="stat-value success" style="font-size:22px">${money(up.due_7 || 0)}</div>
          <div class="stat-sub">${up.due_7_count || 0} installment(s) due</div>
        </div>
        <div class="stat-card primary">
          <div class="stat-label">Expected Next 30 Days</div>
          <div class="stat-value primary" style="font-size:22px">${money(up.due_30 || 0)}</div>
          <div class="stat-sub">${up.due_30_count || 0} installment(s) due</div>
        </div>
      </div>
      <div class="up-list">${upRows}</div>
    </div>

    <div id="month-section">${renderMonthSection(p.this_month)}</div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Last 6 Months — Collection Trend</span></div>
      <div style="padding:18px 24px">
        ${trendBars || '<div style="color:var(--text-muted);font-size:13px">No collection data.</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Interest — Earned vs Expected</span></div>
      <div style="padding:20px 24px">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:8px">
          <span>Earned so far: <strong style="color:var(--success)">${money(intEarned)}</strong></span>
          <span>${intPct}%</span>
          <span>Total expected: <strong>${money(intExp)}</strong></span>
        </div>
        <div style="height:14px;background:var(--border);border-radius:999px;overflow:hidden">
          <div style="height:100%;width:${intPct}%;background:var(--success);border-radius:999px;transition:width 0.5s"></div>
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-top:8px">Interest is the profit baked into each loan (total payable − principal). "Earned" is the share already collected.</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Collections by Showroom (all-time)</span></div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Showroom</th><th>Loans</th><th>Principal Lent</th>
              <th>Collected (all-time)</th><th>Outstanding</th>
            </tr>
          </thead>
          <tbody>${shRows}</tbody>
        </table>
      </div>
    </div>

    <div class="card" style="margin-top:24px">
      <div class="card-header"><span class="card-title">Penalties &amp; Recovery Costs (O/D)</span></div>
      <div class="recovery-grid">
        <div class="recovery-item">
          <div class="recovery-val">${money(p.total_penalties)}</div>
          <div class="recovery-label">Penalties collected — O/D charges across all borrowers</div>
        </div>
        <div class="recovery-item">
          <div class="recovery-val">${money(p.total_seizings || 0)}</div>
          <div class="recovery-label">Seizing money spent — towing / recovery / garage</div>
        </div>
      </div>
    </div>
  `;
}

// The month-selectable "Earnings" block. `m` is a month-breakdown object
// (shape of get_portfolio_summary()['this_month'] / get_month_summary()).
function renderMonthSection(m) {
  m = m || {};
  const p = window._portfolioData || {};
  const sel = window._selMonth || m.month || '';
  const months = (p.available_months && p.available_months.length)
    ? p.available_months
    : [{ month: m.month, label: m.label }];
  const opts = months.map(o =>
    `<option value="${esc(o.month)}" ${o.month === sel ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

  const byModeStr = (m.by_mode && m.by_mode.length)
    ? m.by_mode.map(x => `${esc(x.mode)}: <strong>${money(x.amount)}</strong>`).join('&nbsp;&nbsp;·&nbsp;&nbsp;')
    : 'No payments in this month';

  const shList = (m.by_showroom && m.by_showroom.length)
    ? m.by_showroom.map(x => `
        <div class="msh-row">
          <span class="msh-name">${esc(x.showroom)}</span>
          <span class="msh-amt">${money(x.amount)}</span>
        </div>`).join('')
    : '<div class="fc-empty">No collection from any showroom in this month.</div>';

  return `
    <div class="section-heading month-heading">
      <span>Earnings for</span>
      <select class="filter-select" id="month-select" onchange="selectPortfolioMonth(this.value)">${opts}</select>
    </div>
    <div class="stat-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px">
      <div class="stat-card success">
        <div class="stat-label">Collected</div>
        <div class="stat-value success" style="font-size:22px">${money(m.collected || 0)}</div>
        <div class="stat-sub">${m.payments_count || 0} payment(s)</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Interest Earned</div>
        <div class="stat-value success" style="font-size:22px">${money(m.interest || 0)}</div>
        <div class="stat-sub">Interest portion of the collection</div>
      </div>
      <div class="stat-card gray">
        <div class="stat-label">Principal Returned</div>
        <div class="stat-value" style="font-size:22px">${money(m.principal || 0)}</div>
        <div class="stat-sub">Capital recovered</div>
      </div>
      <div class="stat-card ${(m.penalties || m.seizings) ? 'primary' : 'gray'}">
        <div class="stat-label">Penalty / Seizing</div>
        <div class="stat-value" style="font-size:22px">${money(m.penalties || 0)} <span style="font-size:13px;color:var(--text-muted)">/ ${money(m.seizings || 0)}</span></div>
        <div class="stat-sub">Penalties collected / seizing spent</div>
      </div>
    </div>
    <div class="card" style="margin-bottom:8px">
      <div style="padding:12px 20px;font-size:13px;color:var(--text-muted)">
        <strong style="color:var(--text)">By payment mode:</strong>&nbsp;&nbsp;${byModeStr}
      </div>
    </div>
    <div class="card" style="margin-bottom:24px">
      <div class="card-header"><span class="card-title">Collected by Showroom — ${esc(m.label || '')}</span></div>
      <div class="msh-list">${shList}</div>
    </div>`;
}

async function selectPortfolioMonth(ym) {
  window._selMonth = ym;
  const slot = document.getElementById('month-section');
  if (!slot) return;
  let m;
  // The current month is already in the cached payload — no need to refetch it.
  const p = window._portfolioData || {};
  if (p.this_month && p.this_month.month === ym) {
    m = p.this_month;
  } else {
    loading(true);
    try { m = await api('get_month_summary', ym); }
    finally { loading(false); }
  }
  slot.innerHTML = renderMonthSection(m);
}

// ── Payment Schedule modal ───────────────────────────────────────
async function showPaymentSchedule(borrowerId) {
  loading(true);
  let detail, schedule;
  try {
    [detail, schedule] = await Promise.all([
      api('get_borrower_detail', borrowerId),
      api('get_payment_schedule', borrowerId),
    ]);
  } finally { loading(false); }
  if (!detail) return;
  if (!Array.isArray(schedule)) schedule = [];

  const { borrower: b, summary: s } = detail;

  const statusIcon = { paid: '✅', overdue: '❌', upcoming: '⏳' };
  const statusLabel = { paid: 'Paid', overdue: 'Overdue', upcoming: 'Upcoming' };
  const rowCls = { paid: '', overdue: 'row-overdue', upcoming: '' };

  const rows = schedule.map(inst => `
    <tr class="${rowCls[inst.status]}">
      <td style="font-weight:600;color:var(--text-muted)">${inst.no}</td>
      <td>${fmtDate(inst.due_date)}</td>
      <td>${money(inst.amount)}</td>
      <td style="font-size:12px;color:var(--text-muted)">${money(inst.expected_cumulative)}</td>
      <td>${statusIcon[inst.status]} <span style="font-size:12px">${statusLabel[inst.status]}</span></td>
    </tr>`).join('');

  const paid = schedule.filter(i => i.status === 'paid').length;
  const overdue = schedule.filter(i => i.status === 'overdue').length;
  const upcoming = schedule.filter(i => i.status === 'upcoming').length;

  document.getElementById('modal-inner').innerHTML = `
    <div style="padding:24px 28px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <div>
          <div style="font-size:18px;font-weight:700">${esc(b.name)} — Payment Schedule</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:2px">
            ${esc(b.vehicle_no) || ''} &nbsp;·&nbsp; ${s.period_months} installments of ${money(s.installment_amount)}
          </div>
        </div>
        <button class="modal-close" onclick="showDetail(${b.id})">✕</button>
      </div>

      <div style="display:flex;gap:16px;margin:16px 0;flex-wrap:wrap">
        <span class="badge badge-success">✅ Paid: ${paid}</span>
        <span class="badge badge-danger">❌ Overdue: ${overdue}</span>
        <span class="badge badge-gray">⏳ Upcoming: ${upcoming}</span>
      </div>

      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>#</th><th>Due Date</th><th>Amount</th>
              <th>Cumulative Expected</th><th>Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>

      <div style="margin-top:16px;display:flex;gap:10px">
        <button class="btn btn-outline" onclick="showDetail(${b.id})">← Back to Details</button>
      </div>
    </div>`;
}

// ── Bootstrap ────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  refreshHasPassword();   // load password state so delete prompts know whether to ask
  loadAppSettings();      // text size + business name
  navigate('dashboard');
});

// Prevent mouse-wheel from silently changing a focused number input.
document.addEventListener('wheel', e => {
  if (e.target && e.target.type === 'number' && document.activeElement === e.target) {
    e.target.blur();
  }
}, { passive: true });

// Block keyboard up/down/PgUp/PgDn on number inputs — only manual typing
// should change the value. Tab, Enter, Backspace, Delete, ←/→ still work.
document.addEventListener('keydown', e => {
  if (e.target && e.target.type === 'number') {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
    }
  }
});

// Heartbeat: tells the local server "the window is still open".
// If these stop arriving for ~20s, the server shuts itself down,
// so closing the window actually closes the app (no ghost processes).
function _heartbeat() {
  fetch('/heartbeat', {
    method: 'POST',
    keepalive: true,
    headers: { 'X-Session-Token': window.SESSION_TOKEN || '' },
  }).catch(() => {});
}
_heartbeat();
setInterval(_heartbeat, 5000);
// Ping immediately when the window is shown again (returning from minimized /
// another app), so a throttled background tab doesn't get killed on resume.
document.addEventListener('visibilitychange', () => { if (!document.hidden) _heartbeat(); });
window.addEventListener('pageshow', _heartbeat);
