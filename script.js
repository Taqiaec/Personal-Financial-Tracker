// === DATA LAYER ===
const CATEGORIES = {
    income: ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Hadiah', 'Lainnya'],
    expense: ['Makanan', 'Transportasi', 'Belanja', 'Hiburan', 'Tagihan', 'Kesehatan', 'Pendidikan', 'Kendaraan', 'Lainnya']
};

const CHART_COLORS = [
    '#4f46e5', '#f43f5e', '#0ea5e9', '#10b981', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1'
];

function getTransactions() {
    return JSON.parse(localStorage.getItem('transactions') || '[]');
}

function saveTransactions(txns) {
    localStorage.setItem('transactions', JSON.stringify(txns));
}

// === ACCOUNTS DATA ===
function getAccounts() {
    return JSON.parse(localStorage.getItem('accounts') || '[]');
}

function saveAccounts(accs) {
    localStorage.setItem('accounts', JSON.stringify(accs));
}

function getAccountById(id) {
    return getAccounts().find(a => a.id === id);
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getSettings() {
    return JSON.parse(localStorage.getItem('settings') || '{"paydayStart":1}');
}

function saveSettings(settings) {
    localStorage.setItem('settings', JSON.stringify(settings));
}

function getPaydayStart() {
    return getSettings().paydayStart || 1;
}

function formatCurrency(n) {
    return new Intl.NumberFormat('id-ID').format(n);
}

function formatDate(dateStr) {
    const d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getMonthLabel(dateStr, paydayStart) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

function getMonthKey(dateStr, paydayStart) {
    if (!paydayStart || paydayStart === 1) {
        return dateStr.slice(0, 7);
    }
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDate();
    if (paydayStart <= 15) {
        // Early payday: money is for current month. Before payday = previous month.
        if (day >= paydayStart) return dateStr.slice(0, 7);
        const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        return prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
    } else {
        // Late payday: money is for next month. Before payday = current month, on/after = next month.
        if (day >= paydayStart) {
            const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
            return next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
        }
        return dateStr.slice(0, 7);
    }
}

// === NAVIGATION ===
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById('page-' + btn.dataset.page).classList.add('active');

        if (btn.dataset.page === 'dashboard') renderDashboard();
        if (btn.dataset.page === 'transactions') renderTransactions();
        if (btn.dataset.page === 'accounts') renderAccountsPage();
    });
});

// === FORM ===
const typeSelect = document.getElementById('type');
const categorySelect = document.getElementById('category');

function updateCategoryOptions() {
    const type = typeSelect.value;
    categorySelect.innerHTML = '';
    CATEGORIES[type].forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
    });
}

typeSelect.addEventListener('change', updateCategoryOptions);
updateCategoryOptions();

function populateAccountSelect() {
    const accounts = getAccounts();
    const select = document.getElementById('tx-account');
    const curVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Akun --</option>';
    accounts.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.bankName + ' (' + getAccountTypeLabel(a.accountType) + ')';
        select.appendChild(opt);
    });
    select.value = curVal;
}

function getAccountTypeLabel(type) {
    const map = { debit: 'Debit', credit: 'Kredit', ewallet: 'E-Wallet' };
    return map[type] || type;
}

populateAccountSelect();
document.getElementById('date').value = new Date().toISOString().slice(0, 10);

document.getElementById('transaction-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const desc = document.getElementById('desc').value.trim();
    const amount = parseInt(document.getElementById('amount').value);
    const type = typeSelect.value;
    const category = categorySelect.value;
    const date = document.getElementById('date').value;
    const accountId = document.getElementById('tx-account').value;

    if (!desc || !amount || !date || !accountId) return;

    const txns = getTransactions();
    txns.unshift({ id: generateId(), desc, amount, type, category, date, accountId });
    saveTransactions(txns);

    // Update account balance
    const accounts = getAccounts();
    const acc = accounts.find(a => a.id === accountId);
    if (acc) {
        acc.balance += type === 'income' ? amount : -amount;
        saveAccounts(accounts);
    }

    e.target.reset();
    document.getElementById('date').value = new Date().toISOString().slice(0, 10);
    updateCategoryOptions();
    populateAccountSelect();
    showToast('Transaksi berhasil disimpan!');

    if (document.getElementById('page-dashboard').classList.contains('active')) {
        renderDashboard();
    }
});

// === TOAST ===
let toastTimer;

function showToast(msg) {
    let toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.innerHTML = `
            <span style="display:flex;align-items:center;gap:8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                <span class="toast-msg"></span>
            </span>
        `;
        document.body.appendChild(toast);
    }
    toast.querySelector('.toast-msg').textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.classList.remove('show'); }, 2200);
}

// === RENDER: DASHBOARD ===
function renderDashboard() {
    const txns = getTransactions();

    const incomeTotal = txns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expenseTotal = txns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const balance = incomeTotal - expenseTotal;

    document.getElementById('balance-display').textContent = 'Rp ' + formatCurrency(balance);
    document.getElementById('income-display').textContent = 'Rp ' + formatCurrency(incomeTotal);
    document.getElementById('expense-display').textContent = 'Rp ' + formatCurrency(expenseTotal);

    const recent = txns.slice(0, 5);
    document.getElementById('recent-list').innerHTML = renderTransactionItems(recent);

    renderBarChart(txns);

    // Populate pie chart month selector
    const select = document.getElementById('pie-month-select');
    const monthKeys = [...new Set(txns.map(t => getMonthKey(t.date, getPaydayStart())))].sort().reverse();
    const savedPieMonth = select.value || (monthKeys.length > 0 ? monthKeys[0] : '');
    select.innerHTML = monthKeys.map(k => `<option value="${k}">${getMonthLabel(k + '-01', getPaydayStart())}</option>`).join('');
    if (savedPieMonth) {
        const found = [...select.options].some(o => o.value === savedPieMonth);
        if (found) select.value = savedPieMonth;
    }
    renderPieChart(txns, select.value || null);
}

function renderTransactionItems(txns) {
    if (!txns.length) {
        return '<div class="empty-state">Belum ada transaksi</div>';
    }
    return txns.map(t => {
        const account = t.accountId ? getAccountById(t.accountId) : null;
        const accountBadge = account ? `<span class="tx-account-name">${escapeHtml(account.bankName)}</span>` : '';

        return `
        <div class="transaction-item">
            <div class="tx-left">
                <span class="tx-desc">${escapeHtml(t.desc)}</span>
                <span class="tx-meta">
                    <span>${formatDate(t.date)}</span>
                    <span class="tx-category">${t.category}</span>
                    ${accountBadge}
                </span>
            </div>
            <div class="tx-right">
                <span class="tx-amount tx-${t.type}">
                    ${t.type === 'income' ? '+' : '−'}Rp ${formatCurrency(t.amount)}
                </span>
                <button class="tx-delete" data-id="${t.id}" title="Hapus">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
            </div>
        </div>
    `;
    }).join('');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// === PIE CHART ===
function renderPieChart(txns, monthKey) {
    const canvas = document.getElementById('pieChart');
    const ctx = canvas.getContext('2d');
    const empty = document.getElementById('pie-empty');
    const parent = canvas.parentElement;

    let expenses = txns.filter(t => t.type === 'expense');
    if (monthKey) {
        expenses = expenses.filter(t => getMonthKey(t.date, getPaydayStart()) === monthKey);
    }
    if (!expenses.length) {
        canvas.style.display = 'none';
        empty.style.display = 'block';
        const legend = parent.querySelector('.pie-legend');
        if (legend) legend.remove();
        return;
    }

    canvas.style.display = 'block';
    empty.style.display = 'none';

    const map = {};
    expenses.forEach(t => { map[t.category] = (map[t.category] || 0) + t.amount; });

    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const labels = entries.map(e => e[0]);
    const values = entries.map(e => e[1]);
    const total = values.reduce((s, v) => s + v, 0);

    const dpr = window.devicePixelRatio || 1;
    const w = parent.clientWidth - 48;
    const size = Math.min(w, 280);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const cx = size / 2;
    const cy = size / 2;
    const r = Math.min(cx, cy) - 12;

    ctx.clearRect(0, 0, size, size);

    // Donut hole
    const innerR = r * 0.55;
    let startAngle = -Math.PI / 2;

    entries.forEach(([, v], i) => {
        const slice = (v / total) * Math.PI * 2;
        const endAngle = startAngle + slice;

        // Draw slice
        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle, endAngle);
        ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
        ctx.fill();

        // Percentage label (only if slice is big enough)
        const pct = Math.round(v / total * 100);
        if (pct >= 5) {
            const mid = startAngle + slice / 2;
            const labelR = (r + innerR) / 2;
            const lx = cx + Math.cos(mid) * labelR;
            const ly = cy + Math.sin(mid) * labelR;
            ctx.fillStyle = '#fff';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pct + '%', lx, ly);
        }

        startAngle = endAngle;
    });

    // Center text
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Total', cx, cy - 7);
    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Rp ' + formatCurrency(total), cx, cy + 10);

    // Legend
    const legendEl = parent.querySelector('.pie-legend');
    if (legendEl) legendEl.remove();

    const legend = document.createElement('div');
    legend.className = 'pie-legend';
    legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:14px;justify-content:center;font-size:.78rem;font-weight:500;';
    entries.forEach(([l], i) => {
        const item = document.createElement('span');
        item.style.cssText = 'display:flex;align-items:center;gap:6px;color:#475569;';
        item.innerHTML = `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${CHART_COLORS[i % CHART_COLORS.length]};flex-shrink:0;"></span> ${l}`;
        legend.appendChild(item);
    });
    parent.appendChild(legend);
}

// === BAR CHART ===
function renderBarChart(txns) {
    const canvas = document.getElementById('barChart');
    const ctx = canvas.getContext('2d');
    const empty = document.getElementById('bar-empty');

    if (!txns.length) {
        canvas.style.display = 'none';
        empty.style.display = 'block';
        const legend = canvas.parentElement.querySelector('.bar-legend');
        if (legend) legend.remove();
        return;
    }

    canvas.style.display = 'block';
    empty.style.display = 'none';

    const paydayStart = getPaydayStart();
    const now = new Date();
    let currentFinMonth;
    if (paydayStart === 1) {
        currentFinMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (paydayStart <= 15) {
        // Early payday: current fin month is this month if today >= payday, else last month
        currentFinMonth = now.getDate() >= paydayStart
            ? new Date(now.getFullYear(), now.getMonth(), 1)
            : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    } else {
        // Late payday: current fin month is this month if today < payday, else next month
        currentFinMonth = now.getDate() >= paydayStart
            ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
            : new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const months = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(currentFinMonth.getFullYear(), currentFinMonth.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const inc = txns.filter(t => t.type === 'income' && getMonthKey(t.date, paydayStart) === key).reduce((s, t) => s + t.amount, 0);
        const exp = txns.filter(t => t.type === 'expense' && getMonthKey(t.date, paydayStart) === key).reduce((s, t) => s + t.amount, 0);
        months.push({ label: d.toLocaleDateString('id-ID', { month: 'short' }), inc, exp });
    }

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.parentElement.clientWidth - 48;
    const cw = Math.min(w, 500);
    const ch = 250;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad = { top: 16, right: 20, bottom: 38, left: 52 };
    const chartW = cw - pad.left - pad.right;
    const chartH = ch - pad.top - pad.bottom;

    ctx.clearRect(0, 0, cw, ch);

    const allVals = months.flatMap(m => [m.inc, m.exp]);
    const maxVal = Math.max(...allVals, 1);

    // Y-axis grid
    const gridLines = 4;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i++) {
        const y = pad.top + (chartH / gridLines) * i;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(cw - pad.right, y);
        ctx.stroke();

        const val = Math.round(maxVal * (1 - i / gridLines));
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatCurrency(val), pad.left - 8, y);
    }

    const barGroupW = chartW / months.length;
    const barW = barGroupW * 0.28;
    const gap = barGroupW * 0.08;

    months.forEach((m, i) => {
        const groupX = pad.left + i * barGroupW;

        // Income bar (left of center)
        const incH = Math.max((m.inc / maxVal) * chartH, m.inc > 0 ? 2 : 0);
        const incX = groupX + barGroupW / 2 - barW - gap / 2;
        const incY = pad.top + chartH - incH;
        const incGradient = ctx.createLinearGradient(incX, incY, incX, pad.top + chartH);
        incGradient.addColorStop(0, '#10b981');
        incGradient.addColorStop(1, '#34d399');
        ctx.fillStyle = incGradient;
        ctx.beginPath();
        roundRect(ctx, incX, incY, barW, incH, 4);
        ctx.fill();

        // Expense bar (right of center)
        const expH = Math.max((m.exp / maxVal) * chartH, m.exp > 0 ? 2 : 0);
        const expX = groupX + barGroupW / 2 + gap / 2;
        const expY = pad.top + chartH - expH;
        const expGradient = ctx.createLinearGradient(expX, expY, expX, pad.top + chartH);
        expGradient.addColorStop(0, '#ef4444');
        expGradient.addColorStop(1, '#f87171');
        ctx.fillStyle = expGradient;
        ctx.beginPath();
        roundRect(ctx, expX, expY, barW, expH, 4);
        ctx.fill();

        // X-axis label
        ctx.fillStyle = '#64748b';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(m.label, groupX + barGroupW / 2, pad.top + chartH + 8);
    });

    // Legend
    const parent = canvas.parentElement;
    const legendEl = parent.querySelector('.bar-legend');
    if (legendEl) legendEl.remove();
    const legend = document.createElement('div');
    legend.className = 'bar-legend';
    legend.style.cssText = 'display:flex;gap:20px;justify-content:center;margin-top:10px;font-size:.78rem;font-weight:500;color:#475569;';
    legend.innerHTML = `
        <span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#10b981;"></span> Pemasukan</span>
        <span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#ef4444;"></span> Pengeluaran</span>
    `;
    parent.appendChild(legend);
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// === RENDER: TRANSACTIONS ===
function renderTransactions() {
    const txns = getTransactions();
    const typeFilter = document.getElementById('filter-type').value;
    const catFilter = document.getElementById('filter-category').value;
    const monthFilter = document.getElementById('filter-month').value;

    const catSelect = document.getElementById('filter-category');
    const curCat = catSelect.value;
    catSelect.innerHTML = '<option value="all">Semua Kategori</option>';
    const allCats = [...new Set(txns.map(t => t.category))];
    allCats.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        catSelect.appendChild(opt);
    });
    catSelect.value = curCat;

    const monthSelect = document.getElementById('filter-month');
    const curMonth = monthSelect.value;
    monthSelect.innerHTML = '<option value="all">Semua Bulan</option>';
    const monthKeys = [...new Set(txns.map(t => getMonthKey(t.date, getPaydayStart())))].sort().reverse();
    monthKeys.forEach(k => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = (new Date(k + '-01')).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        monthSelect.appendChild(opt);
    });
    monthSelect.value = curMonth;

    const finalType = document.getElementById('filter-type').value;
    const finalCat = document.getElementById('filter-category').value;
    const finalMonth = document.getElementById('filter-month').value;

    let filtered = txns;
    if (finalType !== 'all') filtered = filtered.filter(t => t.type === finalType);
    if (finalCat !== 'all') filtered = filtered.filter(t => t.category === finalCat);
    if (finalMonth !== 'all') filtered = filtered.filter(t => getMonthKey(t.date, getPaydayStart()) === finalMonth);

    document.getElementById('transaction-list').innerHTML = renderTransactionItems(filtered);
}

document.getElementById('filter-type').addEventListener('change', renderTransactions);
document.getElementById('filter-category').addEventListener('change', renderTransactions);
document.getElementById('filter-month').addEventListener('change', renderTransactions);

// Pie chart month selector
document.getElementById('pie-month-select').addEventListener('change', () => {
    const txns = getTransactions();
    renderPieChart(txns, document.getElementById('pie-month-select').value || null);
});

// Export CSV
document.getElementById('export-btn').addEventListener('click', () => {
    const txns = getTransactions();
    if (!txns.length) { showToast('Belum ada data untuk di-export'); return; }

    let csv = 'Tanggal,Deskripsi,Tipe,Kategori,Jumlah\n';
    txns.forEach(t => {
        csv += `${t.date},${t.desc},${t.type === 'income' ? 'Pemasukan' : 'Pengeluaran'},${t.category},${t.amount}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'transactions.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Data berhasil di-export!');
});

// Delete transaction (event delegation)
document.addEventListener('click', (e) => {
    const deleteBtn = e.target.closest('.tx-delete');
    if (!deleteBtn) return;

    const id = deleteBtn.dataset.id;
    if (!confirm('Hapus transaksi ini?')) return;

    let txns = getTransactions();
    const txToDelete = txns.find(t => t.id === id);

    txns = txns.filter(t => t.id !== id);
    saveTransactions(txns);

    // Reverse account balance
    if (txToDelete && txToDelete.accountId) {
        const accounts = getAccounts();
        const acc = accounts.find(a => a.id === txToDelete.accountId);
        if (acc) {
            acc.balance -= txToDelete.type === 'income' ? txToDelete.amount : -txToDelete.amount;
            saveAccounts(accounts);
        }
    }

    const activePage = document.querySelector('.page.active');
    if (activePage.id === 'page-dashboard') renderDashboard();
    else if (activePage.id === 'page-transactions') renderTransactions();
    else if (activePage.id === 'page-accounts') renderAccountsPage();

    showToast('Transaksi dihapus');
});

// === RENDER: ACCOUNTS PAGE ===
function renderAccountsPage() {
    const accounts = getAccounts();
    const grid = document.getElementById('accounts-grid');
    const totalEl = document.getElementById('accounts-total');
    const totalValue = document.getElementById('accounts-total-value');

    // Unassigned transactions (no accountId)
    const allTxns = getTransactions();
    const unassignedTxns = allTxns.filter(t => !t.accountId);
    const unassignedIncome = unassignedTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const unassignedExpense = unassignedTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const unassignedBalance = unassignedIncome - unassignedExpense;

    if (!accounts.length && !unassignedTxns.length) {
        totalEl.style.display = 'none';
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Belum ada akun. Tambahkan akun bank atau e-wallet Anda.</div>';
        return;
    }

    const totalBalance = accounts.reduce((s, a) => s + a.balance, 0) + unassignedBalance;
    totalEl.style.display = 'flex';
    totalValue.textContent = 'Rp ' + formatCurrency(totalBalance);

    let unassignedCard = '';
    if (unassignedTxns.length > 0) {
        unassignedCard = `
        <div class="account-card type-unassigned">
            <div class="account-card-header">
                <span class="account-bank-name">Tanpa Akun</span>
                <span class="account-type-badge badge-unassigned">Belum Diatur</span>
            </div>
            <span class="account-balance">Rp ${formatCurrency(unassignedBalance)}</span>
            <div class="account-card-meta">
                <span>${unassignedTxns.length} transaksi (${unassignedIncome > 0 ? '+' + formatCurrency(unassignedIncome) : 'Rp 0'}  / −Rp ${formatCurrency(unassignedExpense)})</span>
            </div>
            <div class="account-card-actions">
                <span class="account-hint">Transaksi ini belum terhubung ke akun manapun</span>
            </div>
        </div>`;
    }

    grid.innerHTML = unassignedCard + accounts.map(a => `
        <div class="account-card type-${a.accountType}">
            <div class="account-card-header">
                <span class="account-bank-name">${escapeHtml(a.bankName)}</span>
                <span class="account-type-badge badge-${a.accountType}">${getAccountTypeLabel(a.accountType)}</span>
            </div>
            <span class="account-balance">Rp ${formatCurrency(a.balance)}</span>
            <div class="account-card-actions">
                <button class="btn-icon edit" data-edit-account="${a.id}" title="Edit">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="btn-icon delete" data-delete-account="${a.id}" title="Hapus">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                </button>
            </div>
        </div>
    `).join('');
}

// === ACCOUNT MODAL ===
const modal = document.getElementById('account-modal');
const modalTitle = document.getElementById('modal-title');
const modalSubmitBtn = document.getElementById('modal-submit-btn');
const accIdInput = document.getElementById('acc-id');
const accBankInput = document.getElementById('acc-bank');
const accTypeInput = document.getElementById('acc-type');
const accBalanceInput = document.getElementById('acc-balance');

document.getElementById('btn-add-account').addEventListener('click', () => openAccountModal());

document.getElementById('modal-close').addEventListener('click', closeAccountModal);

modal.addEventListener('click', (e) => {
    if (e.target === modal) closeAccountModal();
});

function openAccountModal(account) {
    if (account) {
        modalTitle.textContent = 'Edit Akun';
        modalSubmitBtn.textContent = 'Simpan Perubahan';
        accIdInput.value = account.id;
        accBankInput.value = account.bankName;
        accTypeInput.value = account.accountType;
        accBalanceInput.value = account.balance;
        accBalanceInput.disabled = true;
        document.getElementById('acc-balance').parentElement.querySelector('label').textContent = 'Saldo Saat Ini (Rp)';
    } else {
        modalTitle.textContent = 'Tambah Akun';
        modalSubmitBtn.textContent = 'Simpan Akun';
        document.getElementById('account-form').reset();
        accIdInput.value = '';
        accBalanceInput.disabled = false;
        accBalanceInput.value = '0';
        document.getElementById('acc-balance').parentElement.querySelector('label').textContent = 'Saldo Awal (Rp)';
    }
    modal.classList.add('show');
}

function closeAccountModal() {
    modal.classList.remove('show');
}

document.getElementById('account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = accIdInput.value;
    const bankName = accBankInput.value.trim();
    const accountType = accTypeInput.value;
    let balance = parseInt(accBalanceInput.value) || 0;

    if (!bankName) return;

    let accounts = getAccounts();

    if (id) {
        // Edit mode — only update name and type, preserve balance
        const acc = accounts.find(a => a.id === id);
        if (acc) {
            acc.bankName = bankName;
            acc.accountType = accountType;
        }
    } else {
        // Add mode
        accounts.push({
            id: generateId(),
            bankName,
            accountType,
            balance
        });
    }

    saveAccounts(accounts);
    closeAccountModal();
    populateAccountSelect();
    renderAccountsPage();
    showToast(id ? 'Akun berhasil diperbarui!' : 'Akun berhasil ditambahkan!');
});

// Edit & Delete account (event delegation)
document.addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-edit-account]');
    if (editBtn) {
        const id = editBtn.dataset.editAccount;
        const account = getAccounts().find(a => a.id === id);
        if (account) openAccountModal(account);
        return;
    }

    const deleteBtn = e.target.closest('[data-delete-account]');
    if (deleteBtn) {
        const id = deleteBtn.dataset.deleteAccount;
        const account = getAccounts().find(a => a.id === id);
        if (!account) return;
        if (!confirm('Hapus akun "' + account.bankName + '"? Transaksi terkait tidak akan dihapus.')) return;

        let accounts = getAccounts();
        accounts = accounts.filter(a => a.id !== id);
        saveAccounts(accounts);
        populateAccountSelect();
        renderAccountsPage();
        showToast('Akun berhasil dihapus');
        return;
    }
});

// === SCANNER: AI IMAGE PARSING ===
let scannerImageData = null; // { base64, mediaType }

// DOM refs
const scannerSection = document.getElementById('scanner-body');
const btnToggle = document.getElementById('btn-scanner-toggle');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('scanner-file');
const previewArea = document.getElementById('preview-area');
const previewImage = document.getElementById('preview-image');
const btnRemove = document.getElementById('btn-remove-image');
const btnParse = document.getElementById('btn-parse');
const parseResult = document.getElementById('parse-result');
const parseFields = document.getElementById('parse-fields');
const parseConfidence = document.getElementById('parse-confidence');
const parseError = document.getElementById('parse-error');
const providerSelect = document.getElementById('ai-provider');
const apiKeyInput = document.getElementById('ai-key');
const rememberKeyCheckbox = document.getElementById('remember-key');

let parsedData = null;

// Toggle scanner
btnToggle.addEventListener('click', () => {
    const open = scannerSection.classList.toggle('open');
    btnToggle.classList.toggle('active', open);
});

// Click to upload
uploadZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
});

// Drag & drop
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});
uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
});

// Remove image
btnRemove.addEventListener('click', () => {
    scannerImageData = null;
    fileInput.value = '';
    previewArea.style.display = 'none';
    uploadZone.style.display = 'block';
    parseResult.style.display = 'none';
    parseError.style.display = 'none';
    parsedData = null;
    updateParseButton();
});

function updateParseButton() {
    btnParse.disabled = !(scannerImageData && apiKeyInput.value.trim());
}

// === API KEY PERSISTENCE ===
function loadSavedApiKey() {
    try {
        const saved = JSON.parse(localStorage.getItem('ai-key'));
        if (saved && saved.key) {
            apiKeyInput.value = saved.key;
            if (saved.provider) providerSelect.value = saved.provider;
            rememberKeyCheckbox.checked = true;
            updateParseButton();
        }
    } catch (e) { /* corrupted data, ignore */ }
}

function persistApiKey() {
    if (rememberKeyCheckbox.checked) {
        const key = apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem('ai-key', JSON.stringify({
                key: key,
                provider: providerSelect.value
            }));
        } else {
            localStorage.removeItem('ai-key');
        }
    } else {
        localStorage.removeItem('ai-key');
    }
}

rememberKeyCheckbox.addEventListener('change', persistApiKey);
apiKeyInput.addEventListener('input', () => {
    updateParseButton();
    persistApiKey();
});
providerSelect.addEventListener('change', () => {
    updateParseButton();
    persistApiKey();
});

// === CLIPBOARD PASTE ===
document.addEventListener('paste', (e) => {
    if (!scannerSection.classList.contains('open')) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.match(/^image\//)) {
            e.preventDefault();
            const blob = items[i].getAsFile();
            handleImageFile(blob);
            return;
        }
    }
});

function handleImageFile(file) {
    if (!file.type.match(/^image\/(jpeg|png|webp)$/)) {
        showParseError('Format tidak didukung. Gunakan JPG, PNG, atau WebP.');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        const mediaType = file.type;
        scannerImageData = { base64, mediaType };

        // Show preview
        previewImage.src = reader.result;
        uploadZone.style.display = 'none';
        previewArea.style.display = 'block';
        parseResult.style.display = 'none';
        parseError.style.display = 'none';
        parsedData = null;
        updateParseButton();
    };
    reader.readAsDataURL(file);
}

// Parse button
btnParse.addEventListener('click', () => {
    if (!scannerImageData || !apiKeyInput.value.trim()) return;
    parseImage();
});

async function parseImage() {
    const apiKey = apiKeyInput.value.trim();
    const provider = providerSelect.value;

    // Show loading state
    btnParse.disabled = true;
    btnParse.querySelector('.btn-parse-text').style.display = 'none';
    btnParse.querySelector('.btn-parse-loading').style.display = 'flex';
    parseResult.style.display = 'none';
    parseError.style.display = 'none';

    try {
        // Compress if needed
        let imageData = scannerImageData.base64;
        if (imageData.length > 5 * 1024 * 1024 / 4 * 3) {
            imageData = await resizeImage(imageData, scannerImageData.mediaType);
        }

        let result;
        if (provider === 'claude') {
            result = await callClaudeAPI(imageData, scannerImageData.mediaType, apiKey);
        } else if (provider === 'gemini') {
            result = await callGeminiAPI(imageData, scannerImageData.mediaType, apiKey);
        } else {
            result = await callOpenAIAPI(imageData, scannerImageData.mediaType, apiKey);
        }

        parsedData = normalizeResult(result);
        displayParseResult(parsedData);
    } catch (err) {
        showParseError(err.message);
    } finally {
        btnParse.disabled = false;
        btnParse.querySelector('.btn-parse-text').style.display = 'flex';
        btnParse.querySelector('.btn-parse-loading').style.display = 'none';
    }
}

async function callClaudeAPI(base64, mediaType, apiKey) {
    const prompt = buildScanPrompt();

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 512,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                    { type: 'text', text: prompt }
                ]
            }]
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Claude API error: ' + response.status);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    return extractJSON(text);
}

async function callOpenAIAPI(base64, mediaType, apiKey) {
    const prompt = buildScanPrompt();
    const dataUrl = 'data:' + mediaType + ';base64,' + base64;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'gpt-4o',
            max_tokens: 512,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: dataUrl } },
                    { type: 'text', text: prompt }
                ]
            }]
        })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || 'OpenAI API error: ' + response.status);
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return extractJSON(text);
}

async function callGeminiAPI(base64, mediaType, apiKey) {
    const prompt = buildScanPrompt();

    const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(apiKey),
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { inlineData: { mimeType: mediaType, data: base64 } },
                        { text: prompt }
                    ]
                }]
            })
        }
    );

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || 'Gemini API error: ' + response.status);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return extractJSON(text);
}

function buildScanPrompt() {
    const accounts = getAccounts();
    const accountList = accounts.length
        ? accounts.map(a => a.bankName + ' (' + getAccountTypeLabel(a.accountType) + ')').join(', ')
        : '(belum ada akun)';

    return `Anda adalah parser data transaksi keuangan Indonesia. Tugas Anda: membaca gambar struk/nota/screenshot transaksi dan mengembalikan JSON yang akurat.

SEBELUM menulis JSON, pikirkan dulu:
1. Transaksi ini untuk apa sebenarnya? (bukan apa yang tertulis literal di struk)
2. Kategori apa yang paling tepat berdasarkan TUJUAN transaksi?

Kategori Pengeluaran (expense):
- Makanan: restoran, warteg, delivery food (GoFood/GrabFood), kopi, catering, jajanan
- Transportasi: ojek online (Gojek/Grab), taksi, bus, KRL, MRT, kereta api, pesawat
- Kendaraan: BBM (Pertamina/Shell), tol, parkir, top-up e-toll (Flazz/e-Money/Brizzi/BNI TapCash), servis mobil/motor, cuci kendaraan, ganti oli
- Belanja: retail (Indomaret/Alfamart/Superindo), online shopping (Shopee/Tokopedia/TikTok Shop), fashion, elektronik, perlengkapan rumah
- Hiburan: bioskop, streaming (Netflix/Spotify), game, konser, wisata, langganan digital
- Tagihan: listrik (PLN), air (PDAM), internet, pulsa/paket data, sewa, iuran, cicilan
- Kesehatan: dokter, rumah sakit, obat/apotek, BPJS/asuransi kesehatan, optik
- Pendidikan: SPP/kuliah, kursus, buku, alat tulis, langganan belajar online
- Lainnya: hanya jika benar-benar tidak cocok dengan kategori di atas

Kategori Pemasukan (income):
- Gaji: gaji bulanan, THR, bonus dari kantor
- Freelance: proyek lepas, upah harian, komisi
- Investasi: dividen, return saham/reksadana, capital gain
- Bisnis: hasil jualan, pendapatan usaha
- Hadiah: uang pemberian, hadiah lomba
- Lainnya: pemasukan yang tidak masuk kategori di atas

Aturan description:
- Normalisasi deskripsi, jangan salin mentah teks dari gambar
- Buang kata status: "berhasil", "sukses", "successful", "transaction approved"
- Standarisasi istilah: "top up"/"topup"/"isi ulang" → "Isi Ulang"
- Format: [Jenis Transaksi] [Nama Merchant/Layanan] (maks 5 kata, bahasa Indonesia)

Aturan amount:
- Angka saja, tanpa Rp, tanpa titik, tanpa koma (contoh: 50000 bukan "Rp 50.000")
- Jika terdeteksi refund/pengembalian, tetap tulis nominal positif, sesuaikan type

Aturan date:
- Format YYYY-MM-DD, ambil dari tanggal transaksi di gambar
- Jika tidak ada tanggal, gunakan hari ini

Aturan accountHint:
- Tulis nama bank/e-wallet yang terlihat di gambar (contoh: "BCA", "GoPay", "OVO", "ShopeePay")
- Akun pengguna yang tersedia: ${accountList}
- Jika tidak jelas, kosongkan string

Contoh parsing yang benar:

1. Screenshot top-up Flazz Rp 100.000 lewat BCA Mobile
→ {"description": "Isi Ulang Flazz", "amount": 100000, "type": "expense", "category": "Kendaraan", "date": "2026-05-24", "accountHint": "BCA"}

2. Nota GoFood dari resto Sate Taichan Rp 45.000
→ {"description": "GoFood Sate Taichan", "amount": 45000, "type": "expense", "category": "Makanan", "date": "2026-05-24", "accountHint": "GoPay"}

3. Slip gaji diterima Rp 8.500.000 transfer dari perusahaan
→ {"description": "Gaji Bulanan", "amount": 8500000, "type": "income", "category": "Gaji", "date": "2026-05-24", "accountHint": "BCA"}

4. Struk SPBU Pertamina isi bensin Rp 200.000
→ {"description": "BBM Pertamina", "amount": 200000, "type": "expense", "category": "Kendaraan", "date": "2026-05-24", "accountHint": ""}

Kembalikan HANYA JSON valid tanpa teks pembuka, penutup, atau markdown:
{
  "description": "...",
  "amount": ...,
  "type": "...",
  "category": "...",
  "date": "YYYY-MM-DD",
  "accountHint": "..."
}`;
}

function extractJSON(text) {
    // Try to find JSON block
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Tidak dapat menemukan JSON dalam response AI.');
}

function normalizeResult(result) {
    const cats = result.type === 'income' ? CATEGORIES.income : CATEGORIES.expense;
    return {
        description: result.description || '',
        amount: parseInt(result.amount) || 0,
        type: result.type === 'income' ? 'income' : 'expense',
        category: cats.includes(result.category) ? result.category : cats[cats.length - 1],
        date: result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : new Date().toISOString().slice(0, 10),
        accountHint: result.accountHint || ''
    };
}

function displayParseResult(data) {
    const accounts = getAccounts();
    const matchedAccount = data.accountHint
        ? accounts.find(a => a.bankName.toLowerCase().includes(data.accountHint.toLowerCase()))
        : null;

    parseFields.innerHTML = `
        <div class="parse-field">
            <span class="parse-field-label">Deskripsi</span>
            <span class="parse-field-value ${data.description ? '' : 'missing'}">${escapeHtml(data.description || '(tidak terdeteksi)')}</span>
        </div>
        <div class="parse-field">
            <span class="parse-field-label">Jumlah</span>
            <span class="parse-field-value">Rp ${formatCurrency(data.amount)}</span>
        </div>
        <div class="parse-field">
            <span class="parse-field-label">Tipe</span>
            <span class="parse-field-value">${data.type === 'income' ? 'Pemasukan' : 'Pengeluaran'}</span>
        </div>
        <div class="parse-field">
            <span class="parse-field-label">Kategori</span>
            <span class="parse-field-value">${escapeHtml(data.category)}</span>
        </div>
        <div class="parse-field">
            <span class="parse-field-label">Tanggal</span>
            <span class="parse-field-value">${formatDate(data.date)}</span>
        </div>
        <div class="parse-field">
            <span class="parse-field-label">Akun</span>
            <span class="parse-field-value ${matchedAccount ? '' : 'missing'}">${matchedAccount ? escapeHtml(matchedAccount.bankName) : (data.accountHint || '(pilih manual)')}</span>
        </div>
    `;

    parseConfidence.textContent = matchedAccount ? 'Cocok' : 'Review';
    parseConfidence.style.background = matchedAccount ? '#dcfce7' : '#fef3c7';
    parseConfidence.style.color = matchedAccount ? '#15803d' : '#92400e';

    parseResult.style.display = 'block';
    parseError.style.display = 'none';
}

function showParseError(msg) {
    parseError.textContent = msg;
    parseError.style.display = 'block';
    parseResult.style.display = 'none';
}

// Apply parsed data to form
document.getElementById('btn-apply').addEventListener('click', () => {
    if (!parsedData) return;

    document.getElementById('desc').value = parsedData.description;
    document.getElementById('amount').value = parsedData.amount || '';
    typeSelect.value = parsedData.type;
    updateCategoryOptions();
    document.getElementById('category').value = parsedData.category;
    document.getElementById('date').value = parsedData.date;

    // Try to match account
    if (parsedData.accountHint) {
        const accounts = getAccounts();
        const match = accounts.find(a =>
            a.bankName.toLowerCase().includes(parsedData.accountHint.toLowerCase())
        );
        if (match) {
            document.getElementById('tx-account').value = match.id;
        }
    }

    showToast('Form terisi dari hasil scan! Silakan periksa kembali.');
});

document.getElementById('btn-cancel-parse').addEventListener('click', () => {
    parseResult.style.display = 'none';
    parsedData = null;
});

// Image resize via canvas (target: under ~4MB base64)
function resizeImage(base64, mediaType) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const maxDim = 1200;
            let w = img.width;
            let h = img.height;
            if (w > maxDim || h > maxDim) {
                const ratio = Math.min(maxDim / w, maxDim / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            const resized = canvas.toDataURL(mediaType, 0.8).split(',')[1];
            resolve(resized);
        };
        img.src = 'data:' + mediaType + ';base64,' + base64;
    });
}

// === SETTINGS INIT ===
(function() {
    var paydayInput = document.getElementById('payday-start');
    if (!paydayInput) return;
    paydayInput.value = getPaydayStart();
    paydayInput.addEventListener('change', function() {
        var val = parseInt(paydayInput.value) || 1;
        val = Math.max(1, Math.min(28, val));
        paydayInput.value = val;
        var settings = getSettings();
        settings.paydayStart = val;
        saveSettings(settings);
        if (document.getElementById('page-dashboard').classList.contains('active')) {
            renderDashboard();
        }
        if (document.getElementById('page-transactions').classList.contains('active')) {
            renderTransactions();
        }
    });
})();

// === INIT ===
renderDashboard();
loadSavedApiKey();

// Debounced resize for charts
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (document.getElementById('page-dashboard').classList.contains('active')) {
            renderDashboard();
        }
    }, 250);
});
