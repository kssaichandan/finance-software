'use strict';

// ── State ────────────────────────────────────────────────────────
let currentView = 'dashboard';
let searchQuery = '';
let showClosed = false;
let statusFilter = 'everything';
let pickDate = '';
let customMinDays = 0;     // threshold for the "Custom overdue" filter
let customMinAmount = 0;
let _viewDirty = false;   // set by mutating ops; closeModal refreshes only if true
let _formDirty = false;   // set by typing in a form; Cancel warns only if true

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

function pct(paid, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((paid / total) * 100));
}

function progressBar(paid, total) {
  const p = pct(paid, total);
  const cls = p >= 100 ? 'success' : p < 50 ? 'danger' : '';
  return `<div class="progress-wrap"><div class="progress-bar ${cls}" style="width:${p}%"></div></div> <span style="font-size:11px;color:var(--text-muted)">${p}%</span>`;
}

function badge(status) {
  const map = {
    'Overdue': 'danger', 'On time': 'success', 'Advance': 'success',
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
  return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

// Live validation for date text inputs — red border the moment the value is invalid.
function validateDateInput(el) {
  const ok = !el.value.trim() || parseUserDate(el.value) !== null;
  el.classList.toggle('input-invalid', !ok);
}

function loading(show) {
  document.getElementById('loader').classList.toggle('hidden', !show);
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  el.innerHTML = `<span>${icons[type]}</span><span>${esc(msg)}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slide-out 0.2s ease forwards';
    setTimeout(() => el.remove(), 200);
  }, 3200);
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

// ── Navigation ───────────────────────────────────────────────────
async function navigate(view) {
  currentView = view;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });
  const container = document.getElementById('view');
  container.innerHTML = '';
  if (view === 'dashboard') await renderDashboard();
  else if (view === 'borrowers') await renderBorrowers();
  else if (view === 'add') renderAddBorrower();
  else if (view === 'portfolio') await renderPortfolio();
  else if (view === 'help') renderHelp();
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

  // Due Today — next installment is due today or tomorrow (call them today)
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

  const view = document.getElementById('view');
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

    <div class="dash-grid">

      <div class="dash-section">
        <div class="dash-section-header due-today-header">
          <span class="dash-section-title">Due Today</span>
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
                  <span class="dash-days" style="${dStyle}">${dLabel}</span>
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
                  <span class="dash-days">${s.days_overdue}d ago</span>
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
        placeholder="Search name, phone, vehicle, book ref…"
        value="${esc(searchQuery)}"
        oninput="filterBorrowers(this.value)" />
      <select class="filter-select" id="status-filter-select"
        onchange="setStatusFilter(this.value)">
        <option value="everything" ${statusFilter==='everything'  ?'selected':''}>All Borrowers (Active + Closed)</option>
        <option value="all"         ${statusFilter==='all'         ?'selected':''}>Active Only</option>
        <option value="penalty"     ${statusFilter==='penalty'     ?'selected':''}>Has Penalty (Due or Paid Late)</option>
        <option value="overdue"     ${statusFilter==='overdue'     ?'selected':''}>Overdue (any)</option>
        <option value="od_1m"       ${statusFilter==='od_1m'       ?'selected':''}>Overdue > 1 month (30+ days)</option>
        <option value="od_2m"       ${statusFilter==='od_2m'       ?'selected':''}>Overdue > 2 months (60+ days)</option>
        <option value="od_3m"       ${statusFilter==='od_3m'       ?'selected':''}>Overdue > 3 months (90+ days)</option>
        <option value="od_1k"       ${statusFilter==='od_1k'       ?'selected':''}>Overdue > ₹1,000</option>
        <option value="od_5k"       ${statusFilter==='od_5k'       ?'selected':''}>Overdue > ₹5,000</option>
        <option value="od_custom"   ${statusFilter==='od_custom'   ?'selected':''}>Custom overdue filter…</option>
        <option value="ontime"      ${statusFilter==='ontime'      ?'selected':''}>On Time</option>
        <option value="advance"     ${statusFilter==='advance'     ?'selected':''}>Advance</option>
        <option value="closed"      ${statusFilter==='closed'      ?'selected':''}>Closed</option>
        <option value="due_today"   ${statusFilter==='due_today'   ?'selected':''}>Due Today</option>
        <option value="due_tomorrow"${statusFilter==='due_tomorrow'?'selected':''}>Due Tomorrow</option>
        <option value="due_3days"   ${statusFilter==='due_3days'   ?'selected':''}>Due in 3 Days</option>
        <option value="due_7days"   ${statusFilter==='due_7days'   ?'selected':''}>Due in 7 Days</option>
        <option value="pick_date"   ${statusFilter==='pick_date'   ?'selected':''}>Pick Date…</option>
      </select>
      <input type="text" id="pick-date-input" class="form-control pick-date-input"
        placeholder="dd-mm-yy" maxlength="10"
        value="${esc(fmtDate(pickDate))}"
        style="${statusFilter !== 'pick_date' ? 'display:none' : ''}"
        onchange="setPickDate(this.value)" />
      <input type="number" id="custom-min-days" class="form-control pick-date-input"
        placeholder="Min days overdue" min="0"
        value="${customMinDays || ''}"
        style="${statusFilter !== 'od_custom' ? 'display:none' : ''}"
        oninput="setCustomMinDays(this.value)" />
      <input type="number" id="custom-min-amount" class="form-control pick-date-input"
        placeholder="Min ₹ overdue" min="0"
        value="${customMinAmount || ''}"
        style="${statusFilter !== 'od_custom' ? 'display:none' : ''}"
        oninput="setCustomMinAmount(this.value)" />
      <label class="filter-label" id="closed-toggle"
        style="${statusFilter !== 'all' ? 'display:none' : ''}">
        <input type="checkbox" id="closed-check" ${showClosed ? 'checked' : ''}
          onchange="toggleClosed(this.checked)" />
        + Closed
      </label>
    </div>
    <div class="card">
      <div class="table-wrap table-scroll-full">
        <table class="data-table">
          <thead>
            <tr>
              <th>Book Ref</th><th>Name</th><th>Phone</th><th>Vehicle No</th><th>Loan Date</th>
              <th>Principal</th><th>Progress</th><th>Overdue</th><th>Status</th>
            </tr>
          </thead>
          <tbody id="borrow-tbody"></tbody>
        </table>
      </div>
    </div>
  `;

  window._allSummaries = summaries;
  filterBorrowers(searchQuery);
}

function filterBorrowers(q) {
  searchQuery = q;
  const summaries = window._allSummaries || [];
  const tbody = document.getElementById('borrow-tbody');
  if (!tbody) return;
  const today = new Date().toISOString().split('T')[0];

  const rows = summaries.filter(s => {
    // Status / date filter
    if (statusFilter === 'everything') {
      // show all borrowers — active and closed, no status filtering
    } else if (statusFilter === 'all') {
      if (!showClosed && s.closed) return false;
    } else if (statusFilter === 'penalty') {
      if (!hasPenalty(s)) return false;
    } else if (statusFilter === 'overdue') {
      if (!s.is_overdue) return false;
    } else if (statusFilter === 'od_1m') {
      if (!s.is_overdue || s.days_overdue < 30) return false;
    } else if (statusFilter === 'od_2m') {
      if (!s.is_overdue || s.days_overdue < 60) return false;
    } else if (statusFilter === 'od_3m') {
      if (!s.is_overdue || s.days_overdue < 90) return false;
    } else if (statusFilter === 'od_1k') {
      if (!s.is_overdue || s.overdue_amount < 1000) return false;
    } else if (statusFilter === 'od_5k') {
      if (!s.is_overdue || s.overdue_amount < 5000) return false;
    } else if (statusFilter === 'od_custom') {
      if (!s.is_overdue) return false;
      // OR logic: must meet EITHER threshold (when set). If both are 0, show all overdue.
      if (customMinDays > 0 || customMinAmount > 0) {
        const okDays = customMinDays > 0 && s.days_overdue >= customMinDays;
        const okAmt = customMinAmount > 0 && s.overdue_amount >= customMinAmount;
        if (!okDays && !okAmt) return false;
      }
    } else if (statusFilter === 'ontime') {
      if (s.closed || s.is_overdue || s.is_advance) return false;
    } else if (statusFilter === 'advance') {
      if (!s.is_advance) return false;
    } else if (statusFilter === 'closed') {
      if (!s.closed) return false;
    } else {
      const nd = nextDueDateFor(s);
      if (!nd) return false;
      const daysUntil = Math.round((new Date(nd) - new Date(today)) / 86400000);
      if (statusFilter === 'due_today'    && daysUntil !== 0) return false;
      if (statusFilter === 'due_tomorrow' && daysUntil !== 1) return false;
      if (statusFilter === 'due_3days'    && (daysUntil < 0 || daysUntil > 3)) return false;
      if (statusFilter === 'due_7days'    && (daysUntil < 0 || daysUntil > 7)) return false;
      if (statusFilter === 'pick_date'    && pickDate && nd !== pickDate) return false;
    }
    // Text search
    if (!q) return true;
    const lq = q.toLowerCase();
    return (s.name || '').toLowerCase().includes(lq)
      || (s.phone || '').toLowerCase().includes(lq)
      || (s.vehicle_no || '').toLowerCase().includes(lq)
      || (s.book_ref || '').toLowerCase().includes(lq);
  });

  const baseCount = statusFilter === 'all'
    ? summaries.filter(s => showClosed || !s.closed).length
    : summaries.length;
  document.getElementById('borrow-count').textContent =
    `Showing ${rows.length} of ${baseCount} borrowers`;

  tbody.innerHTML = '';
  if (rows.length === 0) {
    tbody.innerHTML = `<tr class="no-data"><td colspan="9">No borrowers found.</td></tr>`;
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
    tr.innerHTML = `
      <td>${bookRefTd}</td>
      <td><strong>${esc(s.name)}</strong></td>
      <td>${esc(s.phone) || '—'}</td>
      <td><code style="font-size:12px">${esc(s.vehicle_no) || '—'}</code></td>
      <td>${fmtDate(s.loan_date)}</td>
      <td>${money(s.loan_amount)}</td>
      <td>${progressBar(s.total_paid, s.total_payable)}</td>
      <td>${overdueTd}</td>
      <td>${badge(s.status_label)}</td>
    `;
    tr.style.cursor = 'pointer';
    tr.onclick = () => showDetail(s.borrower_id);
    tbody.appendChild(tr);
  });
}

function toggleClosed(val) {
  showClosed = val;
  filterBorrowers(searchQuery);
}

function setStatusFilter(val) {
  statusFilter = val;
  const pickInput = document.getElementById('pick-date-input');
  const closedLabel = document.getElementById('closed-toggle');
  const minDays = document.getElementById('custom-min-days');
  const minAmt = document.getElementById('custom-min-amount');
  if (pickInput) pickInput.style.display = val === 'pick_date' ? '' : 'none';
  if (closedLabel) closedLabel.style.display = val === 'all' ? '' : 'none';
  if (minDays) minDays.style.display = val === 'od_custom' ? '' : 'none';
  if (minAmt) minAmt.style.display = val === 'od_custom' ? '' : 'none';
  filterBorrowers(searchQuery);
}

function setPickDate(val) {
  // Accept dd-mm-yy from user; internally pickDate is YYYY-MM-DD to compare with next-due dates.
  const iso = parseUserDate(val);
  pickDate = iso || '';
  if (val && !iso) toast('Invalid date. Use dd-mm-yy.', 'error');
  filterBorrowers(searchQuery);
}

function setCustomMinDays(val) {
  customMinDays = Math.max(0, parseInt(val, 10) || 0);
  filterBorrowers(searchQuery);
}

function setCustomMinAmount(val) {
  customMinAmount = Math.max(0, parseFloat(val) || 0);
  filterBorrowers(searchQuery);
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
        <div class="form-section-title">Loan Terms</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Loan Date <span class="req">*</span></label>
            <input class="form-control" name="loan_date" type="text" required maxlength="10"
              placeholder="dd-mm-yy" inputmode="numeric"
              oninput="validateDateInput(this)"
              value="${esc(fmtDate(b.loan_date)) || todayDDMMYY()}" />
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
              value="${b.installment_amount || ''}" placeholder="Auto-filled" />
            <span class="form-hint">Auto-calculated. Override if needed.</span>
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

  recalcInstallment();
  loadSuggestions();
  // Reset and start tracking edits — Cancel will warn if anything's been typed.
  _formDirty = false;
  document.getElementById('borrower-form').addEventListener('input',
    () => { _formDirty = true; }, { once: true });
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
    return;
  }
  data.loan_date = iso;

  let result;
  if (existingId) {
    result = await api('update_borrower', existingId, data);
  } else {
    result = await api('add_borrower', data);
  }

  btn.disabled = false; btn.textContent = existingId ? '💾 Save Changes' : '✅ Create Loan';

  if (result.success) {
    _formDirty = false;
    toast(existingId ? 'Borrower updated.' : 'Loan created successfully!', 'success');
    navigate('borrowers');
  } else {
    toast('Error: ' + result.error, 'error');
  }
}

// ── Borrower Detail modal ────────────────────────────────────────
async function showDetail(borrowerId) {
  loading(true);
  let data;
  try { data = await api('get_borrower_detail', borrowerId); }
  finally { loading(false); }
  if (!data) { toast('Borrower not found.', 'error'); return; }

  const { borrower: b, summary: s, payments, penalties } = data;

  const statusColor = { Overdue: 'danger', 'On time': 'success', Advance: 'success', Closed: 'gray' };
  const sc = statusColor[s.status_label] || 'gray';

  const payRows = payments.length > 0
    ? payments.map(p => `
        <tr>
          <td>${fmtDate(p.payment_date)}</td>
          <td>${esc(p.receipt_no) || '—'}</td>
          <td>${esc(p.installment_label) || '—'}</td>
          <td><strong>${money(p.amount)}</strong></td>
          <td>${esc(p.notes) || '—'}</td>
          <td class="action-cell">
            <button class="btn btn-xs btn-outline" onclick="showEditPayment(${p.id},${b.id})">✏</button>
            <button class="btn btn-xs btn-danger-sm" onclick="deletePayment(${p.id},${b.id})">🗑</button>
          </td>
        </tr>`).join('')
    : `<tr class="no-data"><td colspan="6">No payments recorded yet.</td></tr>`;

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
        <div class="summary-row"><span class="summary-key">Progress</span><span class="summary-val">${progressBar(s.total_paid, s.total_payable)}</span></div>
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
        <div class="summary-row"><span class="summary-key">Last Payment</span><span class="summary-val">${fmtDate(s.last_payment_date) || '—'}</span></div>
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn btn-sm btn-primary" onclick="showAddPayment(${b.id})">➕ Add Payment</button>
      <button class="btn btn-sm btn-outline" onclick="showAddPenalty(${b.id})">⚠ Add Penalty (O/D)</button>
      <button class="btn btn-sm btn-outline" onclick="showPaymentSchedule(${b.id})">📅 Schedule</button>
      <button class="btn btn-sm btn-outline" onclick="closeModal(); navigate('add'); loadEditForm(${b.id})">✏ Edit</button>
      ${closedBtn}
      <button class="btn btn-sm btn-danger" data-bid="${b.id}" data-bname="${esc(b.name)}" onclick="confirmDeleteBorrower(this)">🗑 Delete Borrower</button>
    </div>

    <div class="detail-tables">
      <div class="detail-table-section">
        <h4>Payments</h4>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Date</th><th>Receipt</th><th>Inst#</th><th>Amount</th><th>Notes</th><th></th></tr></thead>
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

function showAddPayment(borrowerId) {
  let countOpts = '';
  for (let i = 1; i <= 12; i++) countOpts += `<option value="${i}">${i}</option>`;
  countOpts += `<option value="custom">Custom…</option>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3>Add Payment</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <div style="display:flex;gap:12px;align-items:flex-end;margin-bottom:14px;flex-wrap:wrap">
        <div class="form-group" style="margin:0;max-width:240px">
          <label>How many payments to add at once?</label>
          <select class="form-control" id="pay-count-select" onchange="onPaymentCountChange(this.value)">
            ${countOpts}
          </select>
        </div>
        <div class="form-group" id="pay-custom-wrap" style="margin:0;max-width:170px;display:none">
          <label>Enter number (max ${MAX_PAYMENTS_AT_ONCE})</label>
          <input class="form-control" id="pay-custom-count" type="number" min="1" max="${MAX_PAYMENTS_AT_ONCE}"
            placeholder="e.g. 18" oninput="onCustomCountChange(this.value)" />
        </div>
      </div>
      <form onsubmit="submitPaymentBatch(event, ${borrowerId})">
        <div class="pay-blocks-wrap" id="pay-blocks-wrap"></div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button type="submit" class="btn btn-primary">Save All Payments</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
    </div>`;
  buildPaymentBlocks(1);
}

function onPaymentCountChange(val) {
  const customWrap = document.getElementById('pay-custom-wrap');
  if (val === 'custom') {
    customWrap.style.display = '';
    const c = parseInt(document.getElementById('pay-custom-count').value, 10);
    buildPaymentBlocks(c > 0 ? c : 1);
  } else {
    customWrap.style.display = 'none';
    buildPaymentBlocks(parseInt(val, 10) || 1);
  }
}

function onCustomCountChange(val) {
  let n = parseInt(val, 10) || 1;
  if (n < 1) n = 1;
  if (n > MAX_PAYMENTS_AT_ONCE) n = MAX_PAYMENTS_AT_ONCE;
  buildPaymentBlocks(n);
}

// Read whatever is currently typed in the payment blocks (preserved across rebuilds).
function _readPaymentBlocks() {
  const out = [];
  document.querySelectorAll('#pay-blocks-wrap .pay-block').forEach(blk => {
    const get = sel => { const el = blk.querySelector(sel); return el ? el.value : ''; };
    out.push({
      payment_date: get('.pb-date'),
      receipt_no: get('.pb-receipt'),
      amount: get('.pb-amount'),
      installment_label: get('.pb-label'),
      notes: get('.pb-notes'),
    });
  });
  return out;
}

function buildPaymentBlocks(count) {
  count = Math.max(1, Math.min(MAX_PAYMENTS_AT_ONCE, count || 1));
  const existing = _readPaymentBlocks();   // keep anything already typed
  const today = todayDDMMYY();
  let html = '';
  for (let i = 1; i <= count; i++) {
    const prev = existing[i - 1];   // undefined for newly-added blocks
    const d = prev ? prev.payment_date : today;
    const r = prev ? prev.receipt_no : '';
    const a = prev ? prev.amount : '';
    const l = prev ? prev.installment_label : '';
    const n = prev ? prev.notes : '';
    html += `
      <div class="pay-block">
        <div class="pay-block-title">Payment ${i}</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Payment Date <span class="req">*</span></label>
            <input class="form-control pb-date" type="text" maxlength="10"
              placeholder="dd-mm-yy" inputmode="numeric"
              oninput="validateDateInput(this)" value="${esc(d)}" />
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
            <label>Notes</label>
            <input class="form-control pb-notes" placeholder="Optional notes" value="${esc(n)}" />
          </div>
        </div>
      </div>`;
  }
  document.getElementById('pay-blocks-wrap').innerHTML = html;
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
    });
  }
  const r = await api('add_payments_batch', borrowerId, payments);
  if (r.success) {
    _viewDirty = true;
    toast(`${r.count} payment(s) saved!`, 'success');
    showDetail(borrowerId);
  } else {
    toast('Error: ' + r.error, 'error');
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
            <input class="form-control" name="charge_date" type="text" required maxlength="10"
              placeholder="dd-mm-yy" inputmode="numeric"
              oninput="validateDateInput(this)" value="${today}" />
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
async function deletePayment(paymentId, borrowerId) {
  if (!confirm('Delete this payment? This cannot be undone.')) return;
  const r = await api('delete_payment', paymentId);
  if (r.success) { _viewDirty = true; toast('Payment deleted.', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

async function deletePenalty(penaltyId, borrowerId) {
  if (!confirm('Delete this penalty? This cannot be undone.')) return;
  const r = await api('delete_penalty', penaltyId);
  if (r.success) { _viewDirty = true; toast('Penalty deleted.', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

// ── Edit payment / penalty ───────────────────────────────────────
async function showEditPayment(paymentId, borrowerId) {
  const detail = await api('get_borrower_detail', borrowerId);
  const p = detail.payments.find(x => x.id === paymentId);
  if (!p) return;
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
            <label>Notes</label>
            <input class="form-control" name="notes" value="${esc(p.notes || '')}" />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn btn-primary">Update Payment</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
    </div>`;
}

async function submitEditPayment(e, paymentId, borrowerId) {
  e.preventDefault();
  const data = {};
  new FormData(e.target).forEach((v, k) => { data[k] = v; });
  const iso = parseUserDate(data.payment_date);
  if (!iso) { toast('Payment Date invalid. Use dd-mm-yy.', 'error'); return; }
  data.payment_date = iso;
  const r = await api('update_payment', paymentId, data);
  if (r.success) { _viewDirty = true; toast('Payment updated!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

async function showEditPenalty(penaltyId, borrowerId) {
  const detail = await api('get_borrower_detail', borrowerId);
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

async function confirmDeleteBorrower(btn) {
  const borrowerId = parseInt(btn.dataset.bid, 10);
  const name = btn.dataset.bname || 'this borrower';
  const msg = `PERMANENTLY DELETE "${name}"?\n\n` +
              `This will also delete ALL their payments and penalties.\n` +
              `This CANNOT be undone.\n\n` +
              `Click OK to delete, Cancel to keep.`;
  if (!confirm(msg)) return;
  // Second safety check
  if (!confirm(`Really delete "${name}"? Last chance — click OK to confirm.`)) return;
  const r = await api('delete_borrower', borrowerId);
  if (r.success) {
    _viewDirty = true;
    toast(`${name} deleted permanently.`, 'success');
    closeModal();
  } else {
    toast('Error: ' + r.error, 'error');
  }
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

  document.getElementById('view').innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Portfolio Summary</div>
        <div class="page-subtitle">Overall health of your lending book</div>
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

    <div class="card" style="margin-top:24px">
      <div class="card-header">
        <span class="card-title">Penalties Collected (O/D)</span>
      </div>
      <div style="padding:20px 24px;display:flex;align-items:center;gap:24px">
        <div style="font-size:28px;font-weight:700;color:var(--warning)">${money(p.total_penalties)}</div>
        <div style="font-size:13px;color:var(--text-muted)">Total O/D penalty charges collected across all borrowers</div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-header"><span class="card-title">Collection Progress</span></div>
      <div style="padding:20px 24px">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-muted);margin-bottom:8px">
          <span>Collected: ${money(p.total_collected)}</span>
          <span>${collectedPct}%</span>
          <span>Total Payable: ${money(p.total_payable)}</span>
        </div>
        <div style="height:14px;background:var(--border);border-radius:999px;overflow:hidden">
          <div style="height:100%;width:${collectedPct}%;background:var(--primary);border-radius:999px;transition:width 0.5s"></div>
        </div>
      </div>
    </div>
  `;
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
window.addEventListener('DOMContentLoaded', () => navigate('dashboard'));

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
