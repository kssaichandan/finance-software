'use strict';

// ── State ────────────────────────────────────────────────────────
let currentView = 'dashboard';
let searchQuery = '';
let showClosed = false;
let statusFilter = 'overdue';
let pickDate = '';

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
    return await window.pywebview.api[method](...args);
  } catch (e) {
    toast(`API error: ${e}`, 'error');
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
}

async function refreshCurrentView() {
  await navigate(currentView);
}

// ── Dashboard view ───────────────────────────────────────────────
async function renderDashboard() {
  loading(true);
  const summaries = await api('get_all_borrowers');
  loading(false);

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
  const summaries = await api('get_all_borrowers');
  loading(false);

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
        <option value="all"         ${statusFilter==='all'         ?'selected':''}>All Active</option>
        <option value="overdue"     ${statusFilter==='overdue'     ?'selected':''}>Overdue</option>
        <option value="ontime"      ${statusFilter==='ontime'      ?'selected':''}>On Time</option>
        <option value="advance"     ${statusFilter==='advance'     ?'selected':''}>Advance</option>
        <option value="closed"      ${statusFilter==='closed'      ?'selected':''}>Closed</option>
        <option value="due_today"   ${statusFilter==='due_today'   ?'selected':''}>Due Today</option>
        <option value="due_tomorrow"${statusFilter==='due_tomorrow'?'selected':''}>Due Tomorrow</option>
        <option value="due_3days"   ${statusFilter==='due_3days'   ?'selected':''}>Due in 3 Days</option>
        <option value="due_7days"   ${statusFilter==='due_7days'   ?'selected':''}>Due in 7 Days</option>
        <option value="pick_date"   ${statusFilter==='pick_date'   ?'selected':''}>Pick Date…</option>
      </select>
      <input type="date" id="pick-date-input" class="form-control pick-date-input"
        value="${esc(pickDate)}"
        style="${statusFilter !== 'pick_date' ? 'display:none' : ''}"
        onchange="setPickDate(this.value)" />
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
    if (statusFilter === 'all') {
      if (!showClosed && s.closed) return false;
    } else if (statusFilter === 'overdue') {
      if (!s.is_overdue) return false;
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
      <td>${esc(s.loan_date)}</td>
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
  if (pickInput) pickInput.style.display = val === 'pick_date' ? '' : 'none';
  if (closedLabel) closedLabel.style.display = val === 'all' ? '' : 'none';
  filterBorrowers(searchQuery);
}

function setPickDate(val) {
  pickDate = val;
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
            <input class="form-control" name="father_name" value="${esc(b.father_name)}" placeholder="Father's name" />
          </div>
          <div class="form-group form-full">
            <label>Address</label>
            <textarea class="form-control" name="address" rows="2" placeholder="Village, Post, Taluk…">${esc(b.address)}</textarea>
          </div>
          <div class="form-group">
            <label>Phone</label>
            <input class="form-control" name="phone" type="tel" maxlength="10" value="${esc(b.phone)}" placeholder="10-digit mobile" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Guarantor</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Guarantor Name</label>
            <input class="form-control" name="guarantor_name" value="${esc(b.guarantor_name)}" placeholder="Name" />
          </div>
          <div class="form-group">
            <label>Guarantor Phone</label>
            <input class="form-control" name="guarantor_phone" type="tel" maxlength="10" value="${esc(b.guarantor_phone)}" placeholder="10-digit mobile" />
          </div>
          <div class="form-group form-full">
            <label>Guarantor Address</label>
            <textarea class="form-control" name="guarantor_address" rows="2" placeholder="Guarantor's address">${esc(b.guarantor_address)}</textarea>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Vehicle</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Vehicle Type</label>
            <input class="form-control" name="vehicle_type" value="${esc(b.vehicle_type)}" placeholder="e.g. Spl (T), Auto" />
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
            <input class="form-control" name="showroom" value="${esc(b.showroom)}" placeholder="Show room name" />
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-title">Loan Terms</div>
        <div class="form-grid">
          <div class="form-group">
            <label>Loan Date <span class="req">*</span></label>
            <input class="form-control" name="loan_date" type="date" required
              value="${esc(b.loan_date) || new Date().toISOString().slice(0,10)}" />
          </div>
          <div class="form-group">
            <label>Principal Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="loan_amount" type="number" min="1" required
              value="${b.loan_amount || ''}" placeholder="e.g. 75000"
              oninput="recalcInstallment()" />
          </div>
          <div class="form-group">
            <label>Interest Rate (flat %) <span class="req">*</span></label>
            <input class="form-control" name="interest_rate" type="number" min="0" max="100" step="0.1" required
              value="${b.interest_rate || 24}" placeholder="e.g. 24"
              oninput="recalcInstallment()" />
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
        <button type="button" class="btn btn-outline" onclick="navigate('${isEdit ? 'borrowers' : 'borrowers'}')">Cancel</button>
      </div>
    </form>
  `;

  recalcInstallment();
}

function recalcInstallment() {
  const principal = parseFloat(document.querySelector('[name=loan_amount]')?.value) || 0;
  const rate = parseFloat(document.querySelector('[name=interest_rate]')?.value) || 0;
  const period = parseInt(document.querySelector('[name=period_months]')?.value) || 1;
  const total = principal + (principal * rate / 100);
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

  let result;
  if (existingId) {
    result = await api('update_borrower', existingId, data);
  } else {
    result = await api('add_borrower', data);
  }

  btn.disabled = false; btn.textContent = existingId ? '💾 Save Changes' : '✅ Create Loan';

  if (result.success) {
    toast(existingId ? 'Borrower updated.' : 'Loan created successfully!', 'success');
    navigate('borrowers');
  } else {
    toast('Error: ' + result.error, 'error');
  }
}

// ── Borrower Detail modal ────────────────────────────────────────
async function showDetail(borrowerId) {
  loading(true);
  const data = await api('get_borrower_detail', borrowerId);
  loading(false);
  if (!data) { toast('Borrower not found.', 'error'); return; }

  const { borrower: b, summary: s, payments, penalties } = data;

  const statusColor = { Overdue: 'danger', 'On time': 'success', Advance: 'success', Closed: 'gray' };
  const sc = statusColor[s.status_label] || 'gray';

  const payRows = payments.length > 0
    ? payments.map(p => `
        <tr>
          <td>${esc(p.payment_date)}</td>
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
          <td>${esc(p.charge_date)}</td>
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
    : `<button class="btn btn-sm btn-danger" onclick="confirmCloseLoan(${b.id})">✔ Mark Closed</button>`;

  document.getElementById('modal-inner').innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-name">${esc(b.name)}</div>
        <div class="detail-meta">
          ${b.book_ref ? `<span class="book-ref-tag" style="font-size:13px">📒 ${esc(b.book_ref)}</span>` : ''}
          ${b.vehicle_no ? `<span>🏍 ${esc(b.vehicle_no)}</span>` : ''}
          ${b.phone ? `<span>📞 ${esc(b.phone)}</span>` : ''}
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
          ${infoRow('Guarantor', b.guarantor_name ? `${b.guarantor_name} — ${b.guarantor_phone || '—'}` : null)}
          ${infoRow('Guar. Address', b.guarantor_address)}
          ${infoRow('Vehicle Type', b.vehicle_type)}
          ${infoRow('Engine / Chassis', [b.engine_no, b.chassis_no].filter(Boolean).join(' / ') || null)}
          ${infoRow('Key No / S.No', [b.key_no, b.serial_no].filter(Boolean).join(' / ') || null)}
          ${infoRow('Show Room', b.showroom)}
          ${infoRow('Loan Date', b.loan_date)}
          ${infoRow('Principal', money(b.loan_amount))}
          ${infoRow('Interest', `${b.interest_rate}% flat`)}
          ${infoRow('Period', `${b.period_months} months`)}
          ${infoRow('Installment', money(b.installment_amount))}
        </div>
      </div>

      <div class="detail-summary">
        <div class="detail-section-title">Summary</div>
        <div class="summary-row"><span class="summary-key">Total Payable</span><span class="summary-val">${money(s.total_payable)}</span></div>
        <div class="summary-row"><span class="summary-key">Paid So Far</span><span class="summary-val primary">${money(s.total_paid)}</span></div>
        <div class="summary-row"><span class="summary-key">Remaining</span><span class="summary-val">${money(s.remaining)}</span></div>
        ${s.total_penalties > 0.01 ? `
        <div class="summary-row"><span class="summary-key">+ Penalties (O/D)</span><span class="summary-val danger">${money(s.total_penalties)}</span></div>
        <div class="summary-row total-owed-row"><span class="summary-key">Total Owed</span><span class="summary-val danger">${money(s.remaining + s.total_penalties)}</span></div>` : ''}
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
        <div class="summary-row"><span class="summary-key">Last Payment</span><span class="summary-val">${s.last_payment_date || '—'}</span></div>
      </div>
    </div>

    <div class="detail-actions">
      <button class="btn btn-sm btn-primary" onclick="showAddPayment(${b.id})">➕ Add Payment</button>
      <button class="btn btn-sm btn-outline" onclick="showAddPenalty(${b.id})">⚠ Add Penalty (O/D)</button>
      <button class="btn btn-sm btn-outline" onclick="showPaymentSchedule(${b.id})">📅 Schedule</button>
      <button class="btn btn-sm btn-outline" onclick="closeModal(); navigate('add'); loadEditForm(${b.id})">✏ Edit</button>
      ${closedBtn}
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

function infoRow(key, val) {
  if (!val) return '';
  return `<div class="info-row"><span class="info-key">${esc(key)}</span><span class="info-val">${esc(val)}</span></div>`;
}

// ── Add Payment / Penalty modals ─────────────────────────────────
function showAddPayment(borrowerId) {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('modal-inner').innerHTML = `
    <div class="mini-modal">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3>Add Payment</h3>
        <button class="modal-close" onclick="showDetail(${borrowerId})">✕</button>
      </div>
      <form onsubmit="submitPayment(event, ${borrowerId})">
        <div class="form-grid" style="margin-bottom:16px">
          <div class="form-group">
            <label>Payment Date <span class="req">*</span></label>
            <input class="form-control" name="payment_date" type="date" required value="${today}" />
          </div>
          <div class="form-group">
            <label>Receipt No</label>
            <input class="form-control" name="receipt_no" placeholder="Receipt number" />
          </div>
          <div class="form-group">
            <label>Amount (₹) <span class="req">*</span></label>
            <input class="form-control" name="amount" type="number" min="1" required placeholder="e.g. 7750" />
          </div>
          <div class="form-group">
            <label>Installment Label</label>
            <input class="form-control" name="installment_label" placeholder="e.g. 1st, 4-5, 10th" />
          </div>
          <div class="form-group form-full">
            <label>Notes</label>
            <input class="form-control" name="notes" placeholder="Optional notes" />
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <button type="submit" class="btn btn-primary">Save Payment</button>
          <button type="button" class="btn btn-outline" onclick="showDetail(${borrowerId})">Cancel</button>
        </div>
      </form>
    </div>`;
}

async function submitPayment(e, borrowerId) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const data = { borrower_id: borrowerId };
  fd.forEach((v, k) => { data[k] = v; });
  const result = await api('add_payment', data);
  if (result.success) { toast('Payment saved!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + result.error, 'error');
}

function showAddPenalty(borrowerId) {
  const today = new Date().toISOString().slice(0, 10);
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
            <input class="form-control" name="charge_date" type="date" required value="${today}" />
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
  const result = await api('add_penalty', data);
  if (result.success) { toast('Penalty saved!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + result.error, 'error');
}

// ── Delete payment / penalty ─────────────────────────────────────
async function deletePayment(paymentId, borrowerId) {
  if (!confirm('Delete this payment? This cannot be undone.')) return;
  const r = await api('delete_payment', paymentId);
  if (r.success) { toast('Payment deleted.', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

async function deletePenalty(penaltyId, borrowerId) {
  if (!confirm('Delete this penalty? This cannot be undone.')) return;
  const r = await api('delete_penalty', penaltyId);
  if (r.success) { toast('Penalty deleted.', 'success'); showDetail(borrowerId); }
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
            <input class="form-control" name="payment_date" type="date" required value="${esc(p.payment_date)}" />
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
  const r = await api('update_payment', paymentId, data);
  if (r.success) { toast('Payment updated!', 'success'); showDetail(borrowerId); }
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
            <input class="form-control" name="charge_date" type="date" required value="${esc(p.charge_date)}" />
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
  const r = await api('update_penalty', penaltyId, data);
  if (r.success) { toast('Penalty updated!', 'success'); showDetail(borrowerId); }
  else toast('Error: ' + r.error, 'error');
}

// ── Close / reopen loan ──────────────────────────────────────────
async function confirmCloseLoan(borrowerId) {
  if (!confirm('Mark this loan as fully closed? This removes it from the overdue list.')) return;
  const r = await api('close_loan', borrowerId);
  if (r.success) { toast('Loan marked as closed.', 'success'); closeModal(); refreshCurrentView(); }
  else toast('Error: ' + r.error, 'error');
}

async function reopenLoan(borrowerId) {
  const r = await api('reopen_loan', borrowerId);
  if (r.success) { toast('Loan re-opened.', 'success'); showDetail(borrowerId); refreshCurrentView(); }
  else toast('Error: ' + r.error, 'error');
}

// ── Edit borrower (from detail modal) ───────────────────────────
async function loadEditForm(borrowerId) {
  loading(true);
  const data = await api('get_borrower_detail', borrowerId);
  loading(false);
  if (!data) return;
  renderAddBorrower(data.borrower);
}

// ── CSV Export ───────────────────────────────────────────────────
async function exportCSV() {
  loading(true);
  const r = await api('export_csv');
  loading(false);
  if (r.cancelled) return;
  if (r.success) toast(`Exported ${r.count} row(s) to CSV.`, 'success');
  else toast('Export failed: ' + r.error, 'error');
}

// ── Modal helpers ────────────────────────────────────────────────
function openModal() {
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-inner').innerHTML = '';
  refreshCurrentView();
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
  const p = await api('get_portfolio_summary');
  loading(false);

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
  const [detail, schedule] = await Promise.all([
    api('get_borrower_detail', borrowerId),
    api('get_payment_schedule', borrowerId),
  ]);
  loading(false);
  if (!detail) return;

  const { borrower: b, summary: s } = detail;

  const statusIcon = { paid: '✅', overdue: '❌', upcoming: '⏳' };
  const statusLabel = { paid: 'Paid', overdue: 'Overdue', upcoming: 'Upcoming' };
  const rowCls = { paid: '', overdue: 'row-overdue', upcoming: '' };

  const rows = schedule.map(inst => `
    <tr class="${rowCls[inst.status]}">
      <td style="font-weight:600;color:var(--text-muted)">${inst.no}</td>
      <td>${inst.due_date}</td>
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
window.addEventListener('pywebviewready', () => navigate('dashboard'));
