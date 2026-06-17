// === CONSTANTS ===
const CATEGORIES = {
    income: ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Hadiah', 'Lainnya'],
    expense: ['Makanan', 'Tagihan', 'Transportasi', 'Belanja', 'Zakat & Donasi', 'Kesehatan', 'Hiburan & Hobi', 'Lainnya']
};

const ACCOUNT_SUB_TYPE_DEFAULTS = {
    passive: ['Spending', 'Tabungan', 'Payroll'],
    investment: ['Reksadana', 'Emas', 'Saham DN', 'Saham LN'],
    credit: ['Revolving', 'Cicilan']
};

const CHART_COLORS = [
    '#4f46e5', '#f43f5e', '#0ea5e9', '#10b981', '#f59e0b',
    '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#6366f1'
];

function isExcludedFromCharts(t) {
    return t.type === 'expense' && t.category === 'Hutang';
}

// === DATA CACHE (populated by Firestore listeners) ===
var txCache = [];
var accCache = [];
var settingsCache = { paydayStart: 1, geminiApiKey: '' };
var budgetCache = {};
var subTypeCache = null;
var paydayOverridesCache = {};
var debtCache = [];
var debtPaymentsCache = {}; // { debtId: [payment, ...] }
var uid = null;

// Listener unsubscribe functions
var unsubTx = null;
var unsubAcc = null;
var unsubSettings = null;
var unsubBudget = null;
var unsubSubType = null;
var unsubPaydayOverrides = null;
var unsubDebt = null;

function initDataListeners(userUid) {
    uid = userUid;
    var userRef = db.collection('users').doc(uid);

    // Transactions listener (ordered by createdAt descending)
    unsubTx = userRef.collection('transactions')
        .orderBy('createdAt', 'desc')
        .onSnapshot(function (snap) {
            txCache = snap.docs.map(function (doc) {
                var data = doc.data();
                return { id: doc.id, desc: data.desc, amount: data.amount, type: data.type, category: data.category || '', date: data.date, accountId: data.accountId || '', transferToAccountId: data.transferToAccountId || '' };
            });
            renderActivePage();
        }, function (err) {
            showToast('Gagal memuat transaksi: ' + err.message);
            console.error(err);
        });

    // Accounts listener
    unsubAcc = userRef.collection('accounts')
        .onSnapshot(function (snap) {
            accCache = snap.docs.map(function (doc) {
                var data = doc.data();
                return { id: doc.id, bankName: data.bankName, accountType: data.accountType, accountSubType: data.accountSubType || '', initialBalance: data.initialBalance || 0, currentValue: data.currentValue != null ? data.currentValue : null, lastAdjustedAt: data.lastAdjustedAt || null, creditLimit: data.creditLimit, interestRate: data.interestRate, dueDate: data.dueDate, minimumPaymentRate: data.minimumPaymentRate, totalLoan: data.totalLoan, tenorMonths: data.tenorMonths, monthlyInstallment: data.monthlyInstallment, startDate: data.startDate };
            });
            renderActivePage();
        }, function (err) {
            showToast('Gagal memuat akun: ' + err.message);
            console.error(err);
        });

    // Settings listener
    unsubSettings = userRef.collection('settings').doc('main')
        .onSnapshot(function (doc) {
            if (doc.exists) {
                settingsCache = doc.data();
                // Sync payday input display
                var paydayInput = document.getElementById('payday-start');
                if (paydayInput && paydayInput !== document.activeElement) {
                    paydayInput.value = settingsCache.paydayStart || 1;
                }
            }
            renderActivePage();
        }, function (err) {
            console.error('Settings listener error:', err);
        });

    // Budget listener
    unsubBudget = userRef.collection('settings').doc('budgets')
        .onSnapshot(function (doc) {
            if (doc.exists) {
                budgetCache = doc.data();
            } else {
                budgetCache = {};
            }
            renderActivePage();
        }, function (err) {
            console.error('Budget listener error:', err);
        });

    // Sub-type settings listener
    unsubSubType = userRef.collection('settings').doc('accountSubTypes')
        .onSnapshot(function (doc) {
            if (doc.exists) {
                subTypeCache = doc.data();
            } else {
                subTypeCache = null;
            }
            renderActivePage();
        }, function (err) {
            console.error('SubType listener error:', err);
        });

    // Payday overrides listener
    unsubPaydayOverrides = userRef.collection('settings').doc('paydayOverrides')
        .onSnapshot(function (doc) {
            if (doc.exists) {
                paydayOverridesCache = doc.data();
            } else {
                paydayOverridesCache = {};
            }
            renderActivePage();
        }, function (err) {
            console.error('PaydayOverrides listener error:', err);
        });

    // Debt listener
    unsubDebt = userRef.collection('debts')
        .onSnapshot(function (snap) {
            debtCache = snap.docs.map(function (doc) {
                var data = doc.data();
                return {
                    id: doc.id,
                    person: data.person,
                    type: data.type,
                    amount: data.amount,
                    description: data.description || '',
                    date: data.date,
                    accountId: data.accountId || '',
                    remainingAmount: data.remainingAmount != null ? data.remainingAmount : data.amount,
                    status: data.status || 'pending',
                    createdAt: data.createdAt,
                    settledAt: data.settledAt || null
                };
            });
            // Fetch payments subcollection for each debt
            var debtIds = debtCache.map(function (d) { return d.id; });
            debtPaymentsCache = {};
            if (debtIds.length > 0) {
                Promise.all(debtIds.map(function (debtId) {
                    return userRef.collection('debts').doc(debtId).collection('payments')
                        .orderBy('createdAt', 'asc').get()
                        .then(function (paySnap) {
                            debtPaymentsCache[debtId] = paySnap.docs.map(function (pd) {
                                var p = pd.data();
                                return { id: pd.id, amount: p.amount, date: p.date, accountId: p.accountId || '', note: p.note || '', createdAt: p.createdAt };
                            });
                        });
                })).then(function () { renderActivePage(); });
            } else {
                renderActivePage();
            }
        }, function (err) {
            showToast('Gagal memuat data hutang/piutang: ' + err.message);
            console.error(err);
        });
}

function getSubTypes(accountType) {
    if (subTypeCache && subTypeCache[accountType]) return subTypeCache[accountType];
    return ACCOUNT_SUB_TYPE_DEFAULTS[accountType] || [];
}

function cleanupDataListeners() {
    if (unsubTx) { unsubTx(); unsubTx = null; }
    if (unsubAcc) { unsubAcc(); unsubAcc = null; }
    if (unsubSettings) { unsubSettings(); unsubSettings = null; }
    if (unsubBudget) { unsubBudget(); unsubBudget = null; }
    if (unsubSubType) { unsubSubType(); unsubSubType = null; }
    if (unsubPaydayOverrides) { unsubPaydayOverrides(); unsubPaydayOverrides = null; }
    if (unsubDebt) { unsubDebt(); unsubDebt = null; }
    txCache = [];
    accCache = [];
    budgetCache = {};
    paydayOverridesCache = {};
    debtCache = [];
    debtPaymentsCache = {};
    uid = null;
}

function renderActivePage() {
    var activePage = document.querySelector('.page.active');
    if (!activePage) return;
    if (activePage.id === 'page-dashboard') { renderDashboard(); renderPaydayOverrides(); }
    else if (activePage.id === 'page-transactions') renderTransactions();
    else if (activePage.id === 'page-accounts') { renderAccountsPage(); renderSubTypeSettings(); }
    else if (activePage.id === 'page-budgets') renderBudgets();
    else if (activePage.id === 'page-debts') renderDebts();
    populateAccountSelect();
}

// === UTILITY: ACCOUNT BALANCE (computed dynamically) ===
function getAccountBalance(accountId) {
    var account = getAccountById(accountId);
    var isCredit = account && account.accountType === 'credit';
    var creditMode = isCredit ? getCreditMode(account) : null;

    var txBalance = txCache.reduce(function (sum, t) {
        if (t.type === 'transfer') {
            if (t.accountId === accountId) {
                if (isCredit) return sum + t.amount; // cash advance: +usage
                return sum - t.amount;
            }
            if (t.transferToAccountId === accountId) {
                if (isCredit) {
                    if (creditMode === 'installment') return sum + t.amount; // payment: +paid
                    return sum - t.amount; // revolving payment: -usage
                }
                return sum + t.amount;
            }
            return sum;
        }
        if (t.accountId !== accountId) return sum;
        if (isCredit) {
            if (creditMode === 'installment') return sum; // installment: expense/income don't apply
            return sum + (t.type === 'income' ? -t.amount : t.amount); // revolving: expense=+usage
        }
        return sum + (t.type === 'income' ? t.amount : -t.amount);
    }, 0);

    if (!isCredit && debtCache && debtCache.length > 0) {
        debtCache.forEach(function (d) {
            if (d.type === 'piutang' && d.accountId === accountId) {
                txBalance -= (d.remainingAmount || 0);
            }
            var dpmts = debtPaymentsCache[d.id] || [];
            dpmts.forEach(function (p) {
                if (p.accountId === accountId) {
                    txBalance += (d.type === 'piutang' ? p.amount : -p.amount);
                }
            });
        });
    }

    return txBalance;
}

function getAccountDisplayBalance(account) {
    if (account.accountType === 'credit') {
        if (getCreditMode(account) === 'installment') {
            var totalPaid = (account.initialBalance || 0) + getAccountBalance(account.id);
            var remaining = Math.max(0, (account.totalLoan || 0) - totalPaid);
            return -remaining;
        }
        // Revolving (default)
        var usage = (account.initialBalance || 0) + getAccountBalance(account.id);
        return -Math.max(0, usage);
    }
    if (account.accountType === 'investment' && account.currentValue != null) {
        return account.currentValue;
    }
    return (account.initialBalance || 0) + getAccountBalance(account.id);
}

// === CREDIT HELPERS ===
function getCreditMode(account) {
    if (account.accountSubType === 'Cicilan') return 'installment';
    return 'revolving';
}

function getCreditModeLabel(mode) {
    var map = { revolving: 'Revolving (Kartu Kredit)', installment: 'Cicilan (KPR, dll)' };
    return map[mode] || mode || 'Revolving';
}

function getCreditUsage(account) {
    if (account.accountType !== 'credit' || getCreditMode(account) === 'installment') return 0;
    return Math.max(0, (account.initialBalance || 0) + getAccountBalance(account.id));
}

function getCreditPaid(account) {
    if (account.accountType !== 'credit' || getCreditMode(account) !== 'installment') return 0;
    return Math.max(0, (account.initialBalance || 0) + getAccountBalance(account.id));
}

function getCreditRemaining(account) {
    if (account.accountType !== 'credit' || getCreditMode(account) !== 'installment') return 0;
    return Math.max(0, (account.totalLoan || 0) - getCreditPaid(account));
}

function getCreditProgress(account) {
    if (account.accountType !== 'credit') return { current: 0, total: 0, pct: 0 };
    if (getCreditMode(account) === 'installment') {
        var paid = getCreditPaid(account);
        var total = account.totalLoan || 0;
        var pct = total > 0 ? Math.min(Math.round(paid / total * 100), 100) : 0;
        return { current: paid, total: total, pct: pct };
    }
    // Revolving
    var usage = getCreditUsage(account);
    var limit = account.creditLimit || 0;
    var pct = limit > 0 ? Math.min(Math.round(usage / limit * 100), 100) : 0;
    return { current: usage, total: limit, pct: pct };
}

function getAccountById(id) {
    return accCache.find(function (a) { return a.id === id; });
}

// === UTILITY FUNCTIONS ===
function getPaydayStart(monthKey) {
    if (monthKey && paydayOverridesCache[monthKey]) {
        return paydayOverridesCache[monthKey];
    }
    return settingsCache.paydayStart || 1;
}

function formatCurrency(n) {
    return new Intl.NumberFormat('id-ID').format(n);
}

function formatDate(dateStr) {
    var d = new Date(dateStr + (dateStr.includes('T') ? '' : 'T00:00:00'));
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getMonthLabel(dateStr, paydayStart) {
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
}

function getMonthKey(dateStr, paydayStart) {
    if (!paydayStart || paydayStart === 1) {
        return dateStr.slice(0, 7);
    }
    var d = new Date(dateStr + 'T00:00:00');
    var day = d.getDate();
    if (paydayStart <= 15) {
        if (day >= paydayStart) return dateStr.slice(0, 7);
        var prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        return prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
    } else {
        if (day >= paydayStart) {
            var next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
            return next.getFullYear() + '-' + String(next.getMonth() + 1).padStart(2, '0');
        }
        return dateStr.slice(0, 7);
    }
}

function getAccountTypeLabel(type) {
    var map = { passive: 'Pasif', investment: 'Investasi', credit: 'Kredit' };
    return map[type] || type;
}

function getAccountSubTypeLabel(subType) {
    return subType || '';
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// === HAMBURGER ===
(function () {
    var hamburger = document.getElementById('hamburger');
    var navMenu = document.getElementById('nav-menu');
    if (!hamburger || !navMenu) return;

    hamburger.addEventListener('click', function () {
        var isOpen = navMenu.classList.toggle('open');
        hamburger.classList.toggle('open', isOpen);
    });

    // Close menu when a nav button is clicked
    navMenu.querySelectorAll('.nav-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            navMenu.classList.remove('open');
            hamburger.classList.remove('open');
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', function (e) {
        if (!navMenu.classList.contains('open')) return;
        if (!navMenu.contains(e.target) && e.target !== hamburger && !hamburger.contains(e.target)) {
            navMenu.classList.remove('open');
            hamburger.classList.remove('open');
        }
    });
})();

// === NAVIGATION ===
document.querySelectorAll('.nav-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
        document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
        document.getElementById('page-' + btn.dataset.page).classList.add('active');

        if (btn.dataset.page === 'dashboard') { renderDashboard(); renderPaydayOverrides(); }
        if (btn.dataset.page === 'transactions') renderTransactions();
        if (btn.dataset.page === 'accounts') { renderAccountsPage(); renderSubTypeSettings(); }
        if (btn.dataset.page === 'budgets') renderBudgets();
        if (btn.dataset.page === 'debts') renderDebts();
        if (btn.dataset.page === 'add') { updateFormForType(); populateAccountSelect(); }
    });
});

// === FORM ===
var currentType = 'expense';
var categorySelect = document.getElementById('category');
var typeTabs = document.getElementById('type-tabs');

typeTabs.addEventListener('click', function (e) {
    var tab = e.target.closest('.type-tab');
    if (!tab) return;
    currentType = tab.dataset.type;
    typeTabs.querySelectorAll('.type-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    updateFormForType();
});

function updateFormForType() {
    var isTransfer = currentType === 'transfer';
    var isDebt = currentType === 'debt';
    // Show/hide transaction form fields
    var txFields = ['scanner-section', 'category-group', 'source-account-group', 'transfer-to-group', 'admin-fee-row', 'split-bill-section'];
    txFields.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.style.display = isDebt ? 'none' : '';
    });
    // Show/hide desc, amount, date (transaction form fields)
    var descGroup = document.getElementById('desc').closest('.form-group');
    var amountGroup = document.getElementById('amount').closest('.form-group');
    var dateGroup = document.getElementById('date').closest('.form-group');
    var editIdEl = document.getElementById('edit-tx-id');
    var formActions = document.getElementById('form-actions');
    if (descGroup) descGroup.style.display = isDebt ? 'none' : '';
    if (amountGroup) amountGroup.style.display = isDebt ? 'none' : '';
    if (dateGroup) dateGroup.style.display = isDebt ? 'none' : '';
    if (editIdEl) editIdEl.style.display = isDebt ? 'none' : '';
    if (formActions) formActions.style.display = isDebt ? 'none' : '';
    // Show/hide debt form section
    var debtSection = document.getElementById('debt-form-section');
    if (debtSection) debtSection.style.display = isDebt ? '' : 'none';
    // Update h2
    var h2 = document.querySelector('#page-add .form-card h2');
    if (h2) h2.textContent = isDebt ? 'Tambah Hutang/Piutang' : (editIdEl && editIdEl.value ? 'Edit Transaksi' : 'Tambah Transaksi');

    document.getElementById('source-account-label').textContent = isTransfer ? 'Akun Asal' : 'Akun';
    var isEdit = !!document.getElementById('edit-tx-id').value;
    document.getElementById('admin-fee-row').style.display = (isTransfer && !isEdit) ? '' : 'none';
    // Split bill section — expense only, not edit mode
    var isEdit2 = !!document.getElementById('edit-tx-id').value;
    var splitSection = document.getElementById('split-bill-section');
    if (splitSection) {
        splitSection.style.display = (currentType === 'expense' && !isEdit2) ? '' : 'none';
        if (currentType !== 'expense' || isEdit2) {
            resetSplitBillForm();
        }
    }
    if (!isTransfer && !isDebt) updateCategoryOptions();
    populateAccountSelect();
    if (isTransfer) populateTransferToAccountSelect();
    if (isDebt) populateDebtAccountDropdown();
}

function updateCategoryOptions() {
    if (currentType === 'transfer') return;
    categorySelect.innerHTML = '';
    CATEGORIES[currentType].forEach(function (cat) {
        var opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        categorySelect.appendChild(opt);
    });
}

updateCategoryOptions();

function populateAccountSelect() {
    var select = document.getElementById('tx-account');
    var curVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Akun --</option>';
    var cashOpt = document.createElement('option');
    cashOpt.value = '__cash__';
    cashOpt.textContent = 'Cash (Tanpa Akun)';
    select.appendChild(cashOpt);
    accCache.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.bankName + ' (' + getAccountTypeLabel(a.accountType) + ')';
        select.appendChild(opt);
    });
    select.value = curVal;
}

function populateTransferToAccountSelect() {
    var select = document.getElementById('tx-transfer-to-account');
    var curVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Akun Tujuan --</option>';
    accCache.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.bankName + ' (' + getAccountTypeLabel(a.accountType) + ')';
        select.appendChild(opt);
    });
    select.value = curVal;
}

// === DEBT FORM (Add Page) ===
function populateDebtAccountDropdown() {
    var select = document.getElementById('add-debt-account');
    if (!select) return;
    select.innerHTML = '<option value="">-- Pilih Akun --</option>';
    accCache.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.bankName + ' (' + getAccountTypeLabel(a.accountType) + ')';
        select.appendChild(opt);
    });
}

// Debt type tabs (hutang/piutang)
document.getElementById('debt-type-tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.type-tab');
    if (!tab) return;
    document.querySelectorAll('#debt-type-tabs .type-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
    document.getElementById('add-debt-type').value = tab.dataset.debtType;
});

// Debt form submit
document.getElementById('add-debt-submit').addEventListener('click', function () {
    if (!uid) return;
    var debtType = document.getElementById('add-debt-type').value;
    var person = document.getElementById('add-debt-person').value.trim();
    var amount = parseInt(document.getElementById('add-debt-amount').value) || 0;
    var desc = document.getElementById('add-debt-desc').value.trim();
    var date = document.getElementById('add-debt-date').value;
    var accountId = document.getElementById('add-debt-account').value;
    var category = document.getElementById('add-debt-category').value;

    if (!person || amount <= 0 || !date || !category) {
        showToast('Mohon isi nama, jumlah, tanggal, dan kategori');
        return;
    }

    db.collection('users').doc(uid).collection('debts').add({
        person: person,
        type: debtType,
        amount: amount,
        description: desc,
        date: date,
        accountId: accountId,
        category: category,
        remainingAmount: amount,
        status: 'pending',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        settledAt: null
    }).then(function () {
        showToast('Hutang/Piutang berhasil ditambahkan');
        // Reset debt form
        document.getElementById('add-debt-person').value = '';
        document.getElementById('add-debt-amount').value = '';
        document.getElementById('add-debt-desc').value = '';
        document.getElementById('add-debt-date').value = new Date().toISOString().slice(0, 10);
        document.getElementById('add-debt-account').value = '';
        document.getElementById('add-debt-category').value = '';
        // Switch back to expense tab
        currentType = 'expense';
        document.querySelectorAll('#type-tabs .type-tab').forEach(function (t) { t.classList.remove('active'); });
        document.querySelector('#type-tabs .type-tab[data-type="expense"]').classList.add('active');
        updateFormForType();
    }).catch(function (err) {
        showToast('Gagal menambahkan: ' + err.message);
    });
});

// Set default date for debt form
document.getElementById('add-debt-date').value = new Date().toISOString().slice(0, 10);

populateAccountSelect();
document.getElementById('date').value = new Date().toISOString().slice(0, 10);

document.getElementById('transaction-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var desc = document.getElementById('desc').value.trim();
    var amount = parseInt(document.getElementById('amount').value);
    var date = document.getElementById('date').value;
    var accountId = document.getElementById('tx-account').value;
    if (accountId === '__cash__') accountId = '';

    if (!desc || !amount || !date) return;
    if (!uid) return;

    var editId = document.getElementById('edit-tx-id').value;

    // --- Transfer path ---
    if (currentType === 'transfer') {
        var destAccountId = document.getElementById('tx-transfer-to-account').value;
        var adminFee = parseInt(document.getElementById('tx-admin-fee').value) || 0;

        if (!accountId || !destAccountId) return;
        if (accountId === destAccountId) {
            showToast('Akun asal dan tujuan tidak boleh sama.');
            return;
        }

        // Block transfer FROM credit accounts
        var srcAccount = getAccountById(accountId);
        if (srcAccount && srcAccount.accountType === 'credit') {
            showToast('Transfer dari akun kredit belum didukung.');
            return;
        }

        var transferData = {
            desc: desc,
            amount: amount,
            type: 'transfer',
            category: '',
            date: date,
            accountId: accountId,
            transferToAccountId: destAccountId
        };

        var transferPromise;
        if (editId) {
            transferPromise = db.collection('users').doc(uid).collection('transactions').doc(editId).update(transferData);
        } else {
            transferData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            transferPromise = db.collection('users').doc(uid).collection('transactions').add(transferData);
        }

        transferPromise.then(function () {
            if (adminFee > 0 && !editId) {
                db.collection('users').doc(uid).collection('transactions').add({
                    desc: 'Biaya Admin: ' + desc,
                    amount: adminFee,
                    type: 'expense',
                    category: 'Lainnya',
                    date: date,
                    accountId: accountId,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                }).catch(function (err) { console.error('Admin fee save failed:', err); });
            }
            resetTransactionForm();
            showToast('Transfer berhasil disimpan!');
        }).catch(function (err) {
            showToast('Gagal menyimpan: ' + err.message);
        });
        return;
    }

    // --- Income/Expense path ---
    var category = document.getElementById('category').value;

    // Credit account validation (only when account is selected)
    if (accountId) {
        var txAccount = getAccountById(accountId);
        if (txAccount && txAccount.accountType === 'credit') {
            if (getCreditMode(txAccount) === 'installment') {
                showToast('Akun cicilan hanya untuk pembayaran (transfer masuk), bukan pengeluaran.');
                return;
            }
            if (currentType === 'expense' && txAccount.creditLimit > 0) {
                var currentUsage = getCreditUsage(txAccount);
                if ((currentUsage + amount) > txAccount.creditLimit) {
                    if (!confirm('Transaksi ini akan melebihi limit kredit Rp ' + formatCurrency(txAccount.creditLimit) + '. Lanjutkan?')) {
                        return;
                    }
                }
            }
        }
    }

    var txData = {
        desc: desc,
        amount: amount,
        type: currentType,
        category: category,
        date: date,
        accountId: accountId || ''
    };

    // Clean up transfer-only fields when editing to non-transfer type
    if (editId && currentType !== 'transfer') {
        txData.transferToAccountId = firebase.firestore.FieldValue.delete();
    }

    var promise;
    if (editId) {
        promise = db.collection('users').doc(uid).collection('transactions').doc(editId).update(txData);
    } else {
        txData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        promise = db.collection('users').doc(uid).collection('transactions').add(txData);
    }

    // --- Split Bill ---
    var splitEnabled = document.getElementById('split-bill-enabled').checked;
    var splitDebtData = null;
    if (currentType === 'expense' && splitEnabled && !editId) {
        var splitMode = document.querySelector('input[name="split-mode"]:checked').value;
        var totalAmount = parseInt(document.getElementById('amount').value) || 0;
        splitDebtData = [];

        if (splitMode === 'equal') {
            var totalPeople = parseInt(document.getElementById('split-total-people').value) || 0;
            if (totalPeople >= 2) {
                var perPerson = Math.floor(totalAmount / totalPeople);
                for (var si = 0; si < totalPeople - 1; si++) {
                    var amt = (si === totalPeople - 2) ? totalAmount - perPerson * (totalPeople - 1) : perPerson;
                    splitDebtData.push({ person: 'Teman ' + (si + 1), amount: amt });
                }
            }
        } else {
            var rows = document.querySelectorAll('#split-participants-list .split-participant-row');
            rows.forEach(function (row) {
                var name = (row.querySelector('.split-part-name').value || 'Teman').trim();
                var amt = parseInt(row.querySelector('.split-part-amount').value) || 0;
                if (amt > 0) splitDebtData.push({ person: name, amount: amt });
            });
        }
    }

    promise.then(function () {
        // Create piutang debts for split bill
        if (splitDebtData && splitDebtData.length > 0) {
            var debtColl = db.collection('users').doc(uid).collection('debts');
            var promises = splitDebtData.map(function (d) {
                return debtColl.add({
                    person: d.person,
                    type: 'piutang',
                    amount: d.amount,
                    description: desc,
                    date: date,
                    accountId: '',
                    remainingAmount: d.amount,
                    status: 'pending',
                    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                    settledAt: null
                });
            });
            Promise.all(promises).then(function () {
                resetTransactionForm();
                resetSplitBillForm();
                updateCategoryOptions();
                showToast('Split bill disimpan! 1 expense + ' + splitDebtData.length + ' piutang');
            }).catch(function (err) {
                showToast('Gagal menyimpan piutang: ' + err.message);
            });
        } else {
            resetTransactionForm();
            updateCategoryOptions();
            showToast(editId ? 'Transaksi diperbarui!' : 'Transaksi berhasil disimpan!');
        }
    }).catch(function (err) {
        showToast('Gagal menyimpan: ' + err.message);
    });
});

// Cancel edit button
document.getElementById('btn-cancel-edit').addEventListener('click', function () {
    resetTransactionForm();
    // Navigate back to transactions page
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelector('[data-page="transactions"]').classList.add('active');
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('page-transactions').classList.add('active');
});

// === TOAST ===
var toastTimer;

function showToast(msg) {
    var toast = document.getElementById('toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast';
        toast.innerHTML = '<span style="display:flex;align-items:center;gap:8px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span class="toast-msg"></span></span>';
        document.body.appendChild(toast);
    }
    toast.querySelector('.toast-msg').textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 2200);
}

function renderPaydayOverrides() {
    var list = document.getElementById('payday-override-list');
    if (!list) return;

    // Toggle behavior — start collapsed
    var body = document.getElementById('payday-overrides-body');
    var chevron = document.querySelector('.payday-chevron');
    if (body && !body.dataset.initialized) {
        body.style.display = 'none';
        chevron.style.transform = 'rotate(-90deg)';
        body.dataset.initialized = '1';
        document.getElementById('payday-toggle').addEventListener('click', function () {
            var isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
        });
    }

    var entries = Object.keys(paydayOverridesCache).sort();
    if (entries.length === 0) {
        list.innerHTML = '<span class="settings-hint" style="padding:4px 0;display:block;">Belum ada pengecualian</span>';
    } else {
        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
        list.innerHTML = entries.map(function (mk) {
            var parts = mk.split('-');
            var label = monthNames[parseInt(parts[1], 10) - 1] + ' ' + parts[0];
            return '<div class="override-row"><span class="override-label">' + label + ' → <strong>' + paydayOverridesCache[mk] + '</strong></span><button type="button" class="override-remove" data-month="' + mk + '" title="Hapus">&times;</button></div>';
        }).join('');
    }

    // Delete handlers — use FieldValue.delete() to properly remove field
    list.querySelectorAll('.override-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var mk = btn.dataset.month;
            delete paydayOverridesCache[mk];
            if (uid) {
                var updateData = {};
                updateData[mk] = firebase.firestore.FieldValue.delete();
                db.collection('users').doc(uid).collection('settings').doc('paydayOverrides')
                    .update(updateData)
                    .then(function () { showToast('Pengecualian dihapus'); })
                    .catch(function (err) { showToast('Gagal: ' + err.message); });
            }
        });
    });
}

// === RENDER: DASHBOARD ===
function renderDashboard() {
    var txns = txCache;

    var piutangTotal = txns.filter(function (t) { return t.type === 'income' && t.category === '💰 Piutang'; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var incomeTotal = txns.filter(function (t) { return t.type === 'income' && t.category !== '💰 Piutang'; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var expenseTotal = Math.max(0, txns.filter(function (t) { return t.type === 'expense' && !isExcludedFromCharts(t); }).reduce(function (s, t) { return s + t.amount; }, 0) - piutangTotal);
    var accountTotal = accCache.reduce(function (s, a) { return s + getAccountDisplayBalance(a); }, 0);
    var unassignedNet = txns.filter(function (t) { return !t.accountId && t.type !== 'transfer'; }).reduce(function (s, t) { return s + (t.type === 'income' ? t.amount : -t.amount); }, 0);
    var balance = accountTotal + unassignedNet;

    document.getElementById('balance-display').textContent = 'Rp ' + formatCurrency(balance);
    document.getElementById('income-display').textContent = 'Rp ' + formatCurrency(incomeTotal);
    document.getElementById('expense-display').textContent = 'Rp ' + formatCurrency(expenseTotal);

    var recent = txns.slice(0, 5);
    document.getElementById('recent-list').innerHTML = renderTransactionItems(recent);

    renderBarChart(txns);

    // Populate pie chart month selector
    var select = document.getElementById('pie-month-select');
    var monthKeys = [];
    var seen = {};
    txns.forEach(function (t) {
        var k = getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7)));
        if (!seen[k]) { seen[k] = true; monthKeys.push(k); }
    });
    monthKeys.sort().reverse();
    var savedPieMonth = select.value || (monthKeys.length > 0 ? monthKeys[0] : '');
    select.innerHTML = monthKeys.map(function (k) { return '<option value="' + k + '">' + getMonthLabel(k + '-01', getPaydayStart(k)) + '</option>'; }).join('');
    if (savedPieMonth) {
        var found = Array.from(select.options).some(function (o) { return o.value === savedPieMonth; });
        if (found) select.value = savedPieMonth;
    }
    renderPieChart(txns, select.value || null);
    renderBudgetProgress();
    renderBudgetAlerts();
    renderPortfolio();
    renderCreditSummary();
    renderDebtDashboardSummary();
    initSimulasiPage();
}

function renderTransactionItems(txns) {
    if (!txns.length) {
        return '<div class="empty-state">Belum ada transaksi</div>';
    }
    return txns.map(function (t) {
        if (t.type === 'transfer') {
            var srcAccount = t.accountId ? getAccountById(t.accountId) : null;
            var dstAccount = t.transferToAccountId ? getAccountById(t.transferToAccountId) : null;
            var srcName = srcAccount ? escapeHtml(srcAccount.bankName) : '?';
            var dstName = dstAccount ? escapeHtml(dstAccount.bankName) : '?';
            var transferBadge = '<span class="tx-account-name" style="background:#e0e7ff;color:#4338ca;">' + srcName + ' → ' + dstName + '</span>';

            return '<div class="transaction-item"><div class="tx-left"><span class="tx-desc">' + escapeHtml(t.desc) + '</span><span class="tx-meta"><span>' + formatDate(t.date) + '</span><span class="tx-category" style="background:#e0e7ff;color:#4338ca;">Transfer</span>' + transferBadge + '</span></div><div class="tx-right"><span class="tx-amount tx-transfer">Rp ' + formatCurrency(t.amount) + '</span><div class="tx-actions"><button class="tx-edit" data-id="' + t.id + '" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="tx-delete" data-id="' + t.id + '" title="Hapus"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div></div></div>';
        }

        var account = t.accountId ? getAccountById(t.accountId) : null;
        var accountBadge = account ? '<span class="tx-account-name">' + escapeHtml(account.bankName) + '</span>' : '';

        return '<div class="transaction-item"><div class="tx-left"><span class="tx-desc">' + escapeHtml(t.desc) + '</span><span class="tx-meta"><span>' + formatDate(t.date) + '</span><span class="tx-category">' + t.category + '</span>' + accountBadge + '</span></div><div class="tx-right"><span class="tx-amount tx-' + t.type + '">' + (t.type === 'income' ? '+' : '−') + 'Rp ' + formatCurrency(t.amount) + '</span><div class="tx-actions"><button class="tx-edit" data-id="' + t.id + '" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="tx-delete" data-id="' + t.id + '" title="Hapus"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button></div></div></div>';
    }).join('');
}

// === PIE CHART ===
function renderPieChart(txns, monthKey) {
    var canvas = document.getElementById('pieChart');
    var ctx = canvas.getContext('2d');
    var empty = document.getElementById('pie-empty');
    var parent = canvas.parentElement;

    var expenses = txns.filter(function (t) { return t.type === 'expense' && !isExcludedFromCharts(t); });
    if (monthKey) {
        expenses = expenses.filter(function (t) { return getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === monthKey; });
    }
    if (!expenses.length) {
        canvas.style.display = 'none';
        empty.style.display = 'block';
        var legend = parent.querySelector('.pie-legend');
        if (legend) legend.remove();
        return;
    }

    canvas.style.display = 'block';
    empty.style.display = 'none';

    // Subtract piutang payments from expense total
    var piutangPayments = txns.filter(function (t) { return t.type === 'income' && t.category === '💰 Piutang'; });
    if (monthKey) {
        piutangPayments = piutangPayments.filter(function (t) { return getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === monthKey; });
    }
    var piutangOffset = piutangPayments.reduce(function (s, t) { return s + t.amount; }, 0);

    var map = {};
    expenses.forEach(function (t) { map[t.category] = (map[t.category] || 0) + t.amount; });

    var entries = Object.entries(map).sort(function (a, b) { return b[1] - a[1]; });
    var labels = entries.map(function (e) { return e[0]; });
    var values = entries.map(function (e) { return e[1]; });
    var total = Math.max(0, values.reduce(function (s, v) { return s + v; }, 0) - piutangOffset);
    if (total <= 0) {
        canvas.style.display = 'none';
        empty.style.display = 'block';
        return;
    }

    var dpr = window.devicePixelRatio || 1;
    var w = parent.clientWidth - 48;
    var size = Math.min(w, 280);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var cx = size / 2;
    var cy = size / 2;
    var r = Math.min(cx, cy) - 12;

    ctx.clearRect(0, 0, size, size);

    var innerR = r * 0.55;
    var startAngle = -Math.PI / 2;

    entries.forEach(function (e, i) {
        var slice = (e[1] / total) * Math.PI * 2;
        var endAngle = startAngle + slice;

        ctx.beginPath();
        ctx.arc(cx, cy, r, startAngle, endAngle);
        ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
        ctx.closePath();
        ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
        ctx.fill();

        var pct = Math.round(e[1] / total * 100);
        if (pct >= 5) {
            var mid = startAngle + slice / 2;
            var labelR = (r + innerR) / 2;
            var lx = cx + Math.cos(mid) * labelR;
            var ly = cy + Math.sin(mid) * labelR;
            ctx.fillStyle = '#fff';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pct + '%', lx, ly);
        }

        startAngle = endAngle;
    });

    ctx.fillStyle = '#0f172a';
    ctx.font = '800 14px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Total', cx, cy - 7);
    ctx.font = '600 11px Inter, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('Rp ' + formatCurrency(total), cx, cy + 10);

    var legendEl = parent.querySelector('.pie-legend');
    if (legendEl) legendEl.remove();

    var legendDiv = document.createElement('div');
    legendDiv.className = 'pie-legend';
    legendDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:14px;justify-content:center;font-size:.78rem;font-weight:500;';
    entries.forEach(function (e, i) {
        var item = document.createElement('span');
        item.style.cssText = 'display:flex;align-items:center;gap:6px;color:#475569;';
        item.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + CHART_COLORS[i % CHART_COLORS.length] + ';flex-shrink:0;"></span> ' + e[0];
        legendDiv.appendChild(item);
    });
    parent.appendChild(legendDiv);
}

// === BAR CHART ===
function renderBarChart(txns) {
    var canvas = document.getElementById('barChart');
    var ctx = canvas.getContext('2d');
    var empty = document.getElementById('bar-empty');

    if (!txns.length) {
        canvas.style.display = 'none';
        empty.style.display = 'block';
        var legend = canvas.parentElement.querySelector('.bar-legend');
        if (legend) legend.remove();
        return;
    }

    canvas.style.display = 'block';
    empty.style.display = 'none';

    var now = new Date();
    var todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var defaultPayday = getPaydayStart(todayStr);
    var currentFinMonth;
    if (defaultPayday === 1) {
        currentFinMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (defaultPayday <= 15) {
        currentFinMonth = now.getDate() >= defaultPayday
            ? new Date(now.getFullYear(), now.getMonth(), 1)
            : new Date(now.getFullYear(), now.getMonth() - 1, 1);
    } else {
        currentFinMonth = now.getDate() >= defaultPayday
            ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
            : new Date(now.getFullYear(), now.getMonth(), 1);
    }

    var months = [];
    for (var i = 5; i >= 0; i--) {
        var d = new Date(currentFinMonth.getFullYear(), currentFinMonth.getMonth() - i, 1);
        var key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        var inc = txns.filter(function (t) { return t.type === 'income' && t.category !== '💰 Piutang' && getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === key; }).reduce(function (s, t) { return s + t.amount; }, 0);
        var piutangInMonth = txns.filter(function (t) { return t.type === 'income' && t.category === '💰 Piutang' && getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === key; }).reduce(function (s, t) { return s + t.amount; }, 0);
        var exp = Math.max(0, txns.filter(function (t) { return t.type === 'expense' && !isExcludedFromCharts(t) && getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === key; }).reduce(function (s, t) { return s + t.amount; }, 0) - piutangInMonth);
        months.push({ label: d.toLocaleDateString('id-ID', { month: 'short' }), inc: inc, exp: exp });
    }

    var dpr = window.devicePixelRatio || 1;
    var w = canvas.parentElement.clientWidth - 48;
    var cw = Math.min(w, 500);
    var ch = 250;
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var pad = { top: 16, right: 20, bottom: 38, left: 52 };
    var chartW = cw - pad.left - pad.right;
    var chartH = ch - pad.top - pad.bottom;

    ctx.clearRect(0, 0, cw, ch);

    var allVals = months.flatMap(function (m) { return [m.inc, m.exp]; });
    var maxVal = Math.max.apply(Math, allVals.concat([1]));

    var gridLines = 4;
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    for (var j = 0; j <= gridLines; j++) {
        var y = pad.top + (chartH / gridLines) * j;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(cw - pad.right, y);
        ctx.stroke();

        var val = Math.round(maxVal * (1 - j / gridLines));
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatCurrency(val), pad.left - 8, y);
    }

    var barGroupW = chartW / months.length;
    var barW = barGroupW * 0.28;
    var gap = barGroupW * 0.08;

    months.forEach(function (m, i) {
        var groupX = pad.left + i * barGroupW;

        var incH = Math.max((m.inc / maxVal) * chartH, m.inc > 0 ? 2 : 0);
        var incX = groupX + barGroupW / 2 - barW - gap / 2;
        var incY = pad.top + chartH - incH;
        var incGradient = ctx.createLinearGradient(incX, incY, incX, pad.top + chartH);
        incGradient.addColorStop(0, '#10b981');
        incGradient.addColorStop(1, '#34d399');
        ctx.fillStyle = incGradient;
        ctx.beginPath();
        roundRect(ctx, incX, incY, barW, incH, 4);
        ctx.fill();

        var expH = Math.max((m.exp / maxVal) * chartH, m.exp > 0 ? 2 : 0);
        var expX = groupX + barGroupW / 2 + gap / 2;
        var expY = pad.top + chartH - expH;
        var expGradient = ctx.createLinearGradient(expX, expY, expX, pad.top + chartH);
        expGradient.addColorStop(0, '#ef4444');
        expGradient.addColorStop(1, '#f87171');
        ctx.fillStyle = expGradient;
        ctx.beginPath();
        roundRect(ctx, expX, expY, barW, expH, 4);
        ctx.fill();

        ctx.fillStyle = '#64748b';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(m.label, groupX + barGroupW / 2, pad.top + chartH + 8);
    });

    var parent = canvas.parentElement;
    var legendEl = parent.querySelector('.bar-legend');
    if (legendEl) legendEl.remove();
    var legendDiv = document.createElement('div');
    legendDiv.className = 'bar-legend';
    legendDiv.style.cssText = 'display:flex;gap:20px;justify-content:center;margin-top:10px;font-size:.78rem;font-weight:500;color:#475569;';
    legendDiv.innerHTML = '<span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#10b981;"></span> Pemasukan</span><span style="display:flex;align-items:center;gap:6px;"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:#ef4444;"></span> Pengeluaran</span>';
    parent.appendChild(legendDiv);
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
    var txns = txCache;
    var typeFilter = document.getElementById('filter-type').value;
    var catFilter = document.getElementById('filter-category').value;
    var monthFilter = document.getElementById('filter-month').value;

    var catSelect = document.getElementById('filter-category');
    var curCat = catSelect.value;
    catSelect.innerHTML = '<option value="all">Semua Kategori</option>';
    var allCats = [];
    var seenCats = {};
    txns.forEach(function (t) {
        if (t.category && !seenCats[t.category]) { seenCats[t.category] = true; allCats.push(t.category); }
    });
    allCats.forEach(function (c) {
        var opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        catSelect.appendChild(opt);
    });
    catSelect.value = curCat;

    var monthSelect = document.getElementById('filter-month');
    var curMonth = monthSelect.value;
    monthSelect.innerHTML = '<option value="all">Semua Bulan</option>';
    var monthKeys = [];
    var seenMonths = {};
    txns.forEach(function (t) {
        var k = getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7)));
        if (!seenMonths[k]) { seenMonths[k] = true; monthKeys.push(k); }
    });
    monthKeys.sort().reverse();
    monthKeys.forEach(function (k) {
        var opt = document.createElement('option');
        opt.value = k;
        opt.textContent = (new Date(k + '-01')).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        monthSelect.appendChild(opt);
    });
    monthSelect.value = curMonth;

    var finalType = document.getElementById('filter-type').value;
    var finalCat = document.getElementById('filter-category').value;
    var finalMonth = document.getElementById('filter-month').value;

    var filtered = txns;
    if (finalType !== 'all') filtered = filtered.filter(function (t) { return t.type === finalType; });
    if (finalCat !== 'all') filtered = filtered.filter(function (t) { return t.category === finalCat; });
    if (finalMonth !== 'all') filtered = filtered.filter(function (t) { return getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === finalMonth; });

    document.getElementById('transaction-list').innerHTML = renderTransactionItems(filtered);
}

document.getElementById('filter-type').addEventListener('change', function () {
    var catSelect = document.getElementById('filter-category');
    if (this.value === 'transfer') {
        catSelect.value = 'all';
        catSelect.disabled = true;
        catSelect.style.opacity = '0.5';
    } else {
        catSelect.disabled = false;
        catSelect.style.opacity = '';
    }
    renderTransactions();
});
document.getElementById('filter-category').addEventListener('change', renderTransactions);
document.getElementById('filter-month').addEventListener('change', renderTransactions);

// Pie chart month selector
document.getElementById('pie-month-select').addEventListener('change', function () {
    renderPieChart(txCache, document.getElementById('pie-month-select').value || null);
});

// Export CSV
document.getElementById('export-btn').addEventListener('click', function () {
    var txns = txCache;
    if (!txns.length) { showToast('Belum ada data untuk di-export'); return; }

    var csv = 'Tanggal,Deskripsi,Tipe,Kategori,Jumlah\n';
    txns.forEach(function (t) {
        var typeLabel;
        var category;
        if (t.type === 'transfer') {
            typeLabel = 'Transfer';
            var src = t.accountId ? (getAccountById(t.accountId) ? getAccountById(t.accountId).bankName : '?') : '?';
            var dst = t.transferToAccountId ? (getAccountById(t.transferToAccountId) ? getAccountById(t.transferToAccountId).bankName : '?') : '?';
            category = src + ' → ' + dst;
        } else {
            typeLabel = t.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
            category = t.category;
        }
        var escapedDesc = t.desc.replace(/"/g, '""');
        csv += t.date + ',"' + escapedDesc + '",' + typeLabel + ',' + category + ',' + t.amount + '\n';
    });

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'transactions.csv';
    link.click();
    URL.revokeObjectURL(link.href);
    showToast('Data berhasil di-export!');
});

// Delete + Edit transaction (event delegation)
document.addEventListener('click', function (e) {
    var deleteBtn = e.target.closest('.tx-delete');
    if (deleteBtn) {
        var id = deleteBtn.dataset.id;
        if (!confirm('Hapus transaksi ini?')) return;
        if (!uid) return;

        db.collection('users').doc(uid).collection('transactions').doc(id).delete()
            .then(function () { showToast('Transaksi dihapus'); })
            .catch(function (err) { showToast('Gagal menghapus: ' + err.message); });
        return;
    }

    var editBtn = e.target.closest('.tx-edit');
    if (editBtn) {
        editTransaction(editBtn.dataset.id);
    }
});

function editTransaction(id) {
    var tx = txCache.find(function (t) { return t.id === id; });
    if (!tx) return;

    // Set type tabs
    currentType = tx.type;
    typeTabs.querySelectorAll('.type-tab').forEach(function (t) { t.classList.remove('active'); });
    var targetTab = typeTabs.querySelector('[data-type="' + tx.type + '"]');
    if (targetTab) targetTab.classList.add('active');
    updateFormForType();

    document.getElementById('desc').value = tx.desc;
    document.getElementById('amount').value = tx.amount;
    document.getElementById('date').value = tx.date;
    document.getElementById('tx-account').value = tx.accountId || '';
    document.getElementById('edit-tx-id').value = tx.id;

    if (tx.type === 'transfer') {
        populateTransferToAccountSelect();
        document.getElementById('tx-transfer-to-account').value = tx.transferToAccountId || '';
    } else {
        updateCategoryOptions();
        document.getElementById('category').value = tx.category;
    }

    document.querySelector('#page-add .form-card h2').textContent = 'Edit Transaksi';
    document.getElementById('submit-tx-btn').textContent = 'Update Transaksi';
    document.getElementById('btn-cancel-edit').style.display = '';

    // Navigate to add page
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelector('[data-page="add"]').classList.add('active');
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('page-add').classList.add('active');
    document.getElementById('page-add').scrollIntoView({ behavior: 'smooth' });
}

function resetTransactionForm() {
    document.getElementById('transaction-form').reset();
    document.getElementById('edit-tx-id').value = '';
    document.getElementById('date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('tx-admin-fee').value = '0';
    resetSplitBillForm();
    // Reset debt form fields
    var debtPerson = document.getElementById('add-debt-person');
    if (debtPerson) debtPerson.value = '';
    var debtAmount = document.getElementById('add-debt-amount');
    if (debtAmount) debtAmount.value = '';
    var debtDesc = document.getElementById('add-debt-desc');
    if (debtDesc) debtDesc.value = '';
    var debtDate = document.getElementById('add-debt-date');
    if (debtDate) debtDate.value = new Date().toISOString().slice(0, 10);
    var debtAccount = document.getElementById('add-debt-account');
    if (debtAccount) debtAccount.value = '';
    var debtType = document.getElementById('add-debt-type');
    if (debtType) debtType.value = 'hutang';
    document.querySelectorAll('#debt-type-tabs .type-tab').forEach(function (t) { t.classList.remove('active'); });
    var hutangTab = document.querySelector('#debt-type-tabs .type-tab[data-debt-type="hutang"]');
    if (hutangTab) hutangTab.classList.add('active');
    // Reset type tabs to expense
    currentType = 'expense';
    typeTabs.querySelectorAll('.type-tab').forEach(function (t) { t.classList.remove('active'); });
    typeTabs.querySelector('[data-type="expense"]').classList.add('active');
    updateFormForType();
    updateCategoryOptions();
    document.querySelector('#page-add .form-card h2').textContent = 'Tambah Transaksi';
    document.getElementById('submit-tx-btn').textContent = 'Simpan Transaksi';
    document.getElementById('btn-cancel-edit').style.display = 'none';
}

// === SPLIT BILL ===
var splitBillEnabled = document.getElementById('split-bill-enabled');
if (splitBillEnabled) {
    splitBillEnabled.addEventListener('change', function () {
        var body = document.getElementById('split-bill-body');
        body.style.display = this.checked ? '' : 'none';
        if (this.checked) {
            if (document.getElementById('split-participants-list').children.length === 0) {
                addParticipantRow('Teman');
            }
            updateEqualSplitSummary();
            updateCustomSplitSummary();
        }
    });

    document.querySelectorAll('input[name="split-mode"]').forEach(function (r) {
        r.addEventListener('change', function () {
            var isEqual = this.value === 'equal';
            document.getElementById('split-equal-row').style.display = isEqual ? '' : 'none';
            document.getElementById('split-custom-row').style.display = isEqual ? 'none' : '';
            if (isEqual) updateEqualSplitSummary();
            else updateCustomSplitSummary();
        });
    });

    document.getElementById('split-total-people').addEventListener('input', updateEqualSplitSummary);

    document.getElementById('btn-add-participant').addEventListener('click', function () {
        addParticipantRow('');
    });

    // Wire amount changes to update split summaries
    document.getElementById('amount').addEventListener('input', function () {
        if (document.getElementById('split-bill-enabled').checked) {
            updateEqualSplitSummary();
            updateCustomSplitSummary();
        }
    });
}

function addParticipantRow(nameHint) {
    var list = document.getElementById('split-participants-list');
    var row = document.createElement('div');
    row.className = 'split-participant-row';
    row.innerHTML =
        '<input type="text" class="split-part-name" placeholder="Nama" value="' + escapeHtml(nameHint || '') + '">' +
        '<input type="number" class="split-part-amount" placeholder="Jumlah (Rp)" min="1">' +
        '<button type="button" class="btn-remove-participant" title="Hapus">&times;</button>';
    row.querySelector('.btn-remove-participant').addEventListener('click', function () {
        row.remove();
        updateCustomSplitSummary();
        updateRemoveButtons();
    });
    row.querySelector('.split-part-amount').addEventListener('input', updateCustomSplitSummary);
    row.querySelector('.split-part-name').addEventListener('input', updateCustomSplitSummary);
    list.appendChild(row);
    updateRemoveButtons();
}

function updateRemoveButtons() {
    var rows = document.querySelectorAll('#split-participants-list .split-participant-row');
    rows.forEach(function (row) {
        var btn = row.querySelector('.btn-remove-participant');
        if (btn) btn.style.display = (rows.length <= 1) ? 'none' : '';
    });
}

function updateEqualSplitSummary() {
    var totalAmount = parseInt(document.getElementById('amount').value) || 0;
    var totalPeople = parseInt(document.getElementById('split-total-people').value) || 0;
    var perPersonEl = document.getElementById('split-per-person');
    var yourShareEl = document.getElementById('split-your-share-eq');
    var totalPiutangEl = document.getElementById('split-total-piutang-eq');
    if (totalAmount > 0 && totalPeople >= 2) {
        var perPerson = Math.floor(totalAmount / totalPeople);
        var yourShare = perPerson;
        var totalPiutang = totalAmount - yourShare;
        perPersonEl.textContent = 'Rp ' + formatCurrency(perPerson);
        yourShareEl.textContent = 'Rp ' + formatCurrency(yourShare);
        totalPiutangEl.textContent = 'Rp ' + formatCurrency(totalPiutang);
    } else {
        perPersonEl.textContent = 'Rp 0';
        yourShareEl.textContent = 'Rp 0';
        totalPiutangEl.textContent = 'Rp 0';
    }
}

function updateCustomSplitSummary() {
    var totalAmount = parseInt(document.getElementById('amount').value) || 0;
    var rows = document.querySelectorAll('#split-participants-list .split-participant-row');
    var friendsTotal = 0;
    rows.forEach(function (row) {
        friendsTotal += parseInt(row.querySelector('.split-part-amount').value) || 0;
    });
    var yourShare = Math.max(0, totalAmount - friendsTotal);
    document.getElementById('split-total-amount').textContent = formatCurrency(totalAmount);
    document.getElementById('split-friends-total').textContent = formatCurrency(friendsTotal);
    var yourShareCustom = document.getElementById('split-your-share-custom');
    yourShareCustom.textContent = formatCurrency(yourShare);
    yourShareCustom.style.color = (friendsTotal > totalAmount) ? 'var(--expense)' : '#1e293b';
}

function resetSplitBillForm() {
    var toggleEl = document.getElementById('split-bill-enabled');
    if (toggleEl) toggleEl.checked = false;
    var bodyEl = document.getElementById('split-bill-body');
    if (bodyEl) bodyEl.style.display = 'none';
    var listEl = document.getElementById('split-participants-list');
    if (listEl) listEl.innerHTML = '';
    var equalRadio = document.querySelector('input[name="split-mode"][value="equal"]');
    if (equalRadio) equalRadio.checked = true;
    var equalRow = document.getElementById('split-equal-row');
    if (equalRow) equalRow.style.display = '';
    var customRow = document.getElementById('split-custom-row');
    if (customRow) customRow.style.display = 'none';
    var peopleInput = document.getElementById('split-total-people');
    if (peopleInput) peopleInput.value = '';
    var perPerson = document.getElementById('split-per-person');
    if (perPerson) perPerson.textContent = 'Rp 0';
    var yourShareEq = document.getElementById('split-your-share-eq');
    if (yourShareEq) yourShareEq.textContent = 'Rp 0';
    var totalPiutangEq = document.getElementById('split-total-piutang-eq');
    if (totalPiutangEq) totalPiutangEq.textContent = 'Rp 0';
    var yourShareCustom = document.getElementById('split-your-share-custom');
    if (yourShareCustom) { yourShareCustom.textContent = '0'; yourShareCustom.style.color = '#1e293b'; }
}

// === RENDER: BUDGETS PAGE ===
function renderBudgets() {
    var list = document.getElementById('budget-list');
    if (!list) return;

    var cats = CATEGORIES.expense;
    var html = '';
    cats.forEach(function (cat) {
        var val = budgetCache[cat] || '';
        html += '<div class="budget-item">' +
            '<span class="budget-label">' + cat + '</span>' +
            '<input type="number" class="budget-input" data-cat="' + cat + '" value="' + val + '" min="0" placeholder="0">' +
            '</div>';
    });
    list.innerHTML = html;
}

// === SUB-TYPE MANAGEMENT (rendered on budgets page) ===
function renderSubTypeSettings() {
    var content = document.getElementById('subtype-content');
    if (!content) return;

    var types = ['passive', 'investment', 'credit'];
    var typeLabels = { passive: 'Pasif', investment: 'Investasi', credit: 'Kredit' };
    var html = '';

    types.forEach(function (t) {
        var subs = getSubTypes(t);
        html += '<div class="subtype-group-label">' + typeLabels[t] + '</div>';
        html += '<div class="subtype-tags" id="subtype-tags-' + t + '">';
        subs.forEach(function (s) {
            html += '<span class="subtype-tag">' + escapeHtml(s) + '<button type="button" class="tag-remove" data-type="' + t + '" data-value="' + escapeHtml(s) + '" title="Hapus">&times;</button></span>';
        });
        html += '</div>';
        html += '<div class="subtype-add-row">';
        html += '<input type="text" id="subtype-add-input-' + t + '" placeholder="Tambah sub tipe baru...">';
        html += '<button type="button" class="subtype-add-btn" data-type="' + t + '">+ Tambah</button>';
        html += '</div>';
    });

    content.innerHTML = html;

    // Toggle expand/collapse — start collapsed
    var body = document.getElementById('subtype-body');
    var chevron = document.querySelector('.subtype-chevron');
    if (body && !body.dataset.initialized) {
        body.style.display = 'none';
        chevron.style.transform = 'rotate(-90deg)';
        body.dataset.initialized = '1';
        document.getElementById('subtype-toggle').addEventListener('click', function () {
            var isHidden = body.style.display === 'none';
            body.style.display = isHidden ? 'block' : 'none';
            chevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
        });
    }

    // Add button handlers
    content.querySelectorAll('.subtype-add-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var t = btn.dataset.type;
            var input = document.getElementById('subtype-add-input-' + t);
            var val = input.value.trim();
            if (!val) return;
            var tagsDiv = document.getElementById('subtype-tags-' + t);
            var tag = document.createElement('span');
            tag.className = 'subtype-tag';
            tag.innerHTML = escapeHtml(val) + '<button type="button" class="tag-remove" data-type="' + t + '" data-value="' + escapeHtml(val) + '" title="Hapus">&times;</button>';
            tagsDiv.appendChild(tag);
            input.value = '';
            tag.querySelector('.tag-remove').addEventListener('click', function () {
                tag.remove();
            });
        });
    });

    // Remove button handlers (delegation)
    content.addEventListener('click', function (e) {
        var removeBtn = e.target.closest('.tag-remove');
        if (removeBtn) {
            removeBtn.closest('.subtype-tag').remove();
        }
    });
}

function saveSubTypeSettings() {
    if (!uid) return;
    var data = { passive: [], investment: [], credit: [] };
    ['passive', 'investment', 'credit'].forEach(function (t) {
        var tagsDiv = document.getElementById('subtype-tags-' + t);
        if (!tagsDiv) return;
        tagsDiv.querySelectorAll('.subtype-tag').forEach(function (tag) {
            var text = tag.textContent.replace(/×/g, '').trim();
            if (text) data[t].push(text);
        });
    });

    db.collection('users').doc(uid).collection('settings').doc('accountSubTypes')
        .set(data, { merge: true })
        .then(function () { showToast('Sub tipe disimpan!'); })
        .catch(function (err) { showToast('Gagal: ' + err.message); });
}

document.addEventListener('click', function (e) {
    if (e.target.closest('#btn-save-subtypes')) {
        saveSubTypeSettings();
        return;
    }

    if (!e.target.closest('#btn-save-budget')) return;

    var inputs = document.querySelectorAll('#budget-list .budget-input');
    var data = {};
    inputs.forEach(function (inp) {
        var v = parseInt(inp.value, 10);
        if (v > 0) data[inp.dataset.cat] = v;
    });

    if (!uid) return;
    db.collection('users').doc(uid).collection('settings').doc('budgets')
        .set(data, { merge: true })
        .then(function () { showToast('Budget disimpan!'); })
        .catch(function (err) { showToast('Gagal menyimpan: ' + err.message); });
});

// === BUDGET PROGRESS (rendered on dashboard) ===
function renderBudgetProgress() {
    var container = document.getElementById('budget-progress');
    var section = document.getElementById('budget-progress-section');
    if (!container || !section) return;

    var today = new Date().toISOString().split('T')[0];
    var currentMonth = getMonthKey(today, getPaydayStart(today.slice(0, 7)));

    var monthTxns = txCache.filter(function (t) {
        return t.type === 'expense' && !isExcludedFromCharts(t) && getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === currentMonth;
    });

    var catMap = {};
    monthTxns.forEach(function (t) {
        catMap[t.category] = (catMap[t.category] || 0) + t.amount;
    });

    // Subtract paid piutang from split bill expenses
    var monthPiutang = debtCache.filter(function (d) {
        return d.type === 'piutang' && getMonthKey(d.date, getPaydayStart(d.date.slice(0, 7))) === currentMonth;
    });
    monthPiutang.forEach(function (d) {
        var paid = d.amount - (d.remainingAmount != null ? d.remainingAmount : d.amount);
        if (paid <= 0) return;
        var matchTx = monthTxns.find(function (t) {
            return t.desc === d.description && t.date === d.date;
        });
        if (matchTx && catMap[matchTx.category]) {
            catMap[matchTx.category] = Math.max(0, catMap[matchTx.category] - paid);
        }
    });

    var items = [];
    Object.keys(budgetCache).forEach(function (cat) {
        var limit = budgetCache[cat];
        if (!limit || limit <= 0) return;
        var spent = catMap[cat] || 0;
        var pct = Math.min(Math.round(spent / limit * 100), 100);
        items.push({ cat: cat, spent: spent, limit: limit, pct: pct });
    });

    if (!items.length) {
        section.style.display = 'none';
        return;
    }

    items.sort(function (a, b) { return b.pct - a.pct; });
    section.style.display = '';

    container.innerHTML = items.map(function (a) {
        var barColor;
        if (a.pct >= 100) barColor = '#dc2626';
        else if (a.pct >= 80) barColor = '#f59e0b';
        else barColor = '#4f46e5';
        return '<div class="budget-progress-item">' +
            '<div class="budget-progress-label">' +
                '<span>' + a.cat + '</span>' +
                '<span class="budget-progress-val">Rp ' + formatCurrency(a.spent) + ' / Rp ' + formatCurrency(a.limit) + '</span>' +
            '</div>' +
            '<div class="budget-progress-bar">' +
                '<div class="budget-progress-fill" style="width:' + a.pct + '%;background:' + barColor + ';"></div>' +
            '</div>' +
            '<span class="budget-progress-pct">' + a.pct + '%</span>' +
            '</div>';
    }).join('');
}

// === BUDGET ALERTS (rendered on dashboard) ===
function renderBudgetAlerts() {
    var container = document.getElementById('budget-alerts');
    if (!container) return;

    var today = new Date().toISOString().split('T')[0];
    var currentMonth = getMonthKey(today, getPaydayStart(today.slice(0, 7)));

    var monthTxns = txCache.filter(function (t) {
        return t.type === 'expense' && !isExcludedFromCharts(t) && getMonthKey(t.date, getPaydayStart(t.date.slice(0, 7))) === currentMonth;
    });

    var catMap = {};
    monthTxns.forEach(function (t) {
        catMap[t.category] = (catMap[t.category] || 0) + t.amount;
    });

    // Subtract paid piutang from split bill expenses
    var monthPiutang = debtCache.filter(function (d) {
        return d.type === 'piutang' && getMonthKey(d.date, getPaydayStart(d.date.slice(0, 7))) === currentMonth;
    });
    monthPiutang.forEach(function (d) {
        var paid = d.amount - (d.remainingAmount != null ? d.remainingAmount : d.amount);
        if (paid <= 0) return;
        var matchTx = monthTxns.find(function (t) {
            return t.desc === d.description && t.date === d.date;
        });
        if (matchTx && catMap[matchTx.category]) {
            catMap[matchTx.category] = Math.max(0, catMap[matchTx.category] - paid);
        }
    });

    var alerts = [];
    Object.keys(budgetCache).forEach(function (cat) {
        var spent = catMap[cat] || 0;
        var limit = budgetCache[cat];
        if (!limit || spent === 0) return;
        var pct = Math.round(spent / limit * 100);
        if (pct >= 100) {
            alerts.push({ cat: cat, spent: spent, limit: limit, pct: pct, level: 'over' });
        } else if (pct >= 80) {
            alerts.push({ cat: cat, spent: spent, limit: limit, pct: pct, level: 'warn' });
        }
    });

    alerts.sort(function (a, b) { return b.pct - a.pct; });

    if (!alerts.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = alerts.map(function (a) {
        var cls = a.level === 'over' ? 'budget-alert over' : 'budget-alert warn';
        var icon = a.level === 'over' ? '🔴' : '🟡';
        return '<div class="' + cls + '">' +
            icon + ' <b>' + a.cat + '</b>: Rp ' + formatCurrency(a.spent) +
            ' dari Rp ' + formatCurrency(a.limit) +
            ' (' + a.pct + '%)' +
            '</div>';
    }).join('');
}

// === PORTFOLIO (investment accounts on dashboard) ===
function renderPortfolio() {
    var section = document.getElementById('portfolio-section');
    var totalEl = document.getElementById('portfolio-total');
    var listEl = document.getElementById('portfolio-list');
    if (!section || !totalEl || !listEl) return;

    var invAccounts = accCache.filter(function (a) { return a.accountType === 'investment'; });
    if (!invAccounts.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';
    var totalValue = invAccounts.reduce(function (s, a) { return s + getAccountDisplayBalance(a); }, 0);
    totalEl.innerHTML = 'Total Investasi: <b>Rp ' + formatCurrency(totalValue) + '</b>';

    var today = new Date().toISOString().split('T')[0];
    var currentMonth = getMonthKey(today, getPaydayStart(today.slice(0, 7)));

    listEl.innerHTML = invAccounts.map(function (a) {
        var value = getAccountDisplayBalance(a);
        var pnlHtml = '';
        if (a.lastAdjustedAt) {
            var adjMonth = getMonthKey(a.lastAdjustedAt, getPaydayStart(a.lastAdjustedAt.slice(0, 7)));
            if (adjMonth === currentMonth) {
                var costBasis = a.initialBalance || 0;
                var totalPnl = value - costBasis;
                var pnlClass = totalPnl >= 0 ? 'positive' : 'negative';
                var pnlSign = totalPnl >= 0 ? '+' : '';
                pnlHtml = '<span class="portfolio-item-pnl portfolio-pnl ' + pnlClass + '">' + pnlSign + 'Rp ' + formatCurrency(totalPnl) + '</span>';
            }
        }
        var subLabel = a.accountSubType ? ' <span class="badge-subtype">' + escapeHtml(a.accountSubType) + '</span>' : '';
        return '<div class="portfolio-item">' +
            '<span class="portfolio-item-name">' + escapeHtml(a.bankName) + subLabel + '</span>' +
            '<span><span class="portfolio-item-value">Rp ' + formatCurrency(value) + '</span>' + pnlHtml + '</span>' +
            '</div>';
    }).join('');
}

// === CREDIT SUMMARY (dashboard) ===
function renderCreditSummary() {
    var section = document.getElementById('credit-summary-section');
    var totalEl = document.getElementById('credit-summary-total');
    var listEl = document.getElementById('credit-summary-list');
    var row = document.getElementById('dash-bottom-row');
    if (!section || !totalEl || !listEl) return;

    var creditAccounts = accCache.filter(function (a) { return a.accountType === 'credit'; });

    section.style.display = creditAccounts.length ? '' : 'none';
    if (row) {
        row.style.display = '';
        row.style.gridTemplateColumns = creditAccounts.length ? '' : '1fr';
    }
    var totalDebt = creditAccounts.reduce(function (s, a) { return s + getAccountDisplayBalance(a); }, 0);
    totalEl.innerHTML = 'Total Kredit: <b style="color:var(--expense);">−Rp ' + formatCurrency(Math.abs(totalDebt)) + '</b>';

    // Check for past-due revolving accounts
    var today = new Date().getDate();
    var pastDueAccounts = creditAccounts.filter(function (a) {
        return getCreditMode(a) !== 'installment' && a.dueDate && today > a.dueDate && getCreditUsage(a) > 0;
    });
    var alertHtml = '';
    if (pastDueAccounts.length > 0) {
        alertHtml = '<div class="budget-alert over" style="margin-bottom:12px;">' +
            'Lewat jatuh tempo: ' + pastDueAccounts.map(function (a) { return escapeHtml(a.bankName); }).join(', ') +
            '</div>';
    }

    listEl.innerHTML = alertHtml + creditAccounts.map(function (a) {
        var progress = getCreditProgress(a);
        var pct = progress.pct;
        var barColor;
        if (getCreditMode(a) === 'installment') {
            barColor = pct >= 100 ? '#10b981' : (pct >= 50 ? '#4f46e5' : '#f59e0b');
        } else {
            barColor = pct >= 100 ? '#dc2626' : (pct >= 80 ? '#f59e0b' : '#4f46e5');
        }
        var balance = getAccountDisplayBalance(a);
        var modeLabel = getCreditMode(a) === 'installment' ? 'Cicilan' : 'Revolving';
        var subBadge = a.accountSubType ? ' <span class="badge-subtype">' + escapeHtml(a.accountSubType) + '</span>' : '';

        var dueDateHtml = '';
        if (getCreditMode(a) !== 'installment' && a.dueDate) {
            var dueDay = a.dueDate;
            var dueClass = today > dueDay ? 'due-past' : (dueDay - today <= 3 ? 'due-soon' : 'due-ok');
            dueDateHtml = '<span class="due-date-badge ' + dueClass + '">Jatuh Tempo: tgl ' + dueDay + '</span>';
        }

        var infoHtml = '';
        if (getCreditMode(a) === 'installment') {
            if (pct >= 100) {
                infoHtml = '<span class="badge-lunas">Lunas</span>';
            } else {
                var remaining = getCreditRemaining(a);
                var monthsLeft = a.monthlyInstallment > 0 ? Math.ceil(remaining / a.monthlyInstallment) : 0;
                infoHtml = '<span class="credit-installment-info">Rp ' + formatCurrency(a.monthlyInstallment || 0) + '/bln · ' + monthsLeft + ' bln lagi</span>';
            }
        } else {
            if (a.creditLimit > 0) {
                var usage = getCreditUsage(a);
                var available = Math.max(0, a.creditLimit - usage);
                infoHtml = '<span class="credit-available-info">Tersedia: Rp ' + formatCurrency(available) + '</span>';
                if (a.minimumPaymentRate && usage > 0) {
                    infoHtml += ' · <span class="credit-min-payment">Min: Rp ' + formatCurrency(Math.round(usage * a.minimumPaymentRate / 100)) + '</span>';
                }
            }
        }

        var progressLabel = getCreditMode(a) === 'installment'
            ? 'Terbayar: Rp ' + formatCurrency(progress.current) + ' / Rp ' + formatCurrency(progress.total)
            : 'Terpakai: Rp ' + formatCurrency(progress.current) + ' / Rp ' + formatCurrency(progress.total);

        return '<div class="credit-item">' +
            '<div class="credit-item-header">' +
                '<span class="credit-item-name">' + escapeHtml(a.bankName) + subBadge + '</span>' +
                '<span class="credit-item-mode badge-mode-' + (getCreditMode(a) || 'revolving') + '">' + modeLabel + '</span>' +
                dueDateHtml +
            '</div>' +
            '<span class="credit-item-balance" style="color:var(--expense);">Rp ' + formatCurrency(balance) + '</span>' +
            '<div class="credit-progress-section">' +
                '<div class="credit-progress-label"><span>' + progressLabel + '</span></div>' +
                '<div class="budget-progress-bar"><div class="budget-progress-fill" style="width:' + pct + '%;background:' + barColor + ';"></div></div>' +
                '<div class="credit-progress-info">' + infoHtml + '<span class="credit-progress-pct">' + pct + '%</span></div>' +
            '</div>' +
            '</div>';
    }).join('');
}

// === RENDER: ACCOUNTS PAGE ===
function renderAccountsPage() {
    var accounts = accCache;
    var grid = document.getElementById('accounts-grid');
    var totalEl = document.getElementById('accounts-total-row');
    var totalValue = document.getElementById('accounts-total-value');

    // Unassigned transactions (no accountId)
    var unassignedTxns = txCache.filter(function (t) { return !t.accountId; });
    var unassignedIncome = unassignedTxns.filter(function (t) { return t.type === 'income' && t.category !== '💰 Piutang'; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var unassignedPiutang = unassignedTxns.filter(function (t) { return t.type === 'income' && t.category === '💰 Piutang'; }).reduce(function (s, t) { return s + t.amount; }, 0);
    var unassignedExpense = unassignedTxns.filter(function (t) { return t.type === 'expense' && !isExcludedFromCharts(t); }).reduce(function (s, t) { return s + t.amount; }, 0);
    var unassignedBalance = unassignedIncome + unassignedPiutang - unassignedExpense;

    if (!accounts.length && !unassignedTxns.length) {
        totalEl.style.display = 'none';
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">Belum ada akun. Tambahkan akun bank atau e-wallet Anda.</div>';
        return;
    }

    var totalBalance = accounts.reduce(function (s, a) { return s + getAccountDisplayBalance(a); }, 0) + unassignedBalance;
    totalEl.style.display = '';
    totalValue.textContent = 'Rp ' + formatCurrency(totalBalance);

    // Debt-adjusted balance
    var activePiutang = debtCache.filter(function (d) { return d.type === 'piutang' && d.status !== 'paid'; })
        .reduce(function (s, d) { return s + (d.remainingAmount || 0); }, 0);
    var activeHutang = debtCache.filter(function (d) { return d.type === 'hutang' && d.status !== 'paid'; })
        .reduce(function (s, d) { return s + (d.remainingAmount || 0); }, 0);
    var afterDebtBalance = totalBalance + activePiutang - activeHutang;
    document.getElementById('accounts-total-after-value').textContent = 'Rp ' + formatCurrency(afterDebtBalance);

    // Debt summary section
    var debtSection = document.getElementById('accounts-debt-section');
    if (activePiutang > 0 || activeHutang > 0) {
        debtSection.style.display = '';
        document.getElementById('acc-hutang-val').textContent = '−Rp ' + formatCurrency(activeHutang);
        document.getElementById('acc-piutang-val').textContent = '+Rp ' + formatCurrency(activePiutang);
        var netDebt = activePiutang - activeHutang;
        var netEl = document.getElementById('acc-debt-net-val');
        netEl.textContent = (netDebt >= 0 ? '+' : '') + 'Rp ' + formatCurrency(netDebt);
        netEl.style.color = netDebt >= 0 ? 'var(--income)' : 'var(--expense)';
    } else {
        debtSection.style.display = 'none';
    }

    var unassignedCard = '';
    if (unassignedTxns.length > 0) {
        unassignedCard = '<div class="account-card type-unassigned"><div class="account-card-header"><span class="account-bank-name">Tanpa Akun</span><span class="account-type-badge badge-unassigned">Belum Diatur</span></div><span class="account-balance">Rp ' + formatCurrency(unassignedBalance) + '</span><div class="account-card-meta"><span>' + unassignedTxns.length + ' transaksi (' + (unassignedIncome > 0 ? '+' + formatCurrency(unassignedIncome) : 'Rp 0') + ' /−Rp ' + formatCurrency(unassignedExpense) + ')</span></div><div class="account-card-actions"><span class="account-hint">Transaksi ini belum terhubung ke akun manapun</span></div></div>';
    }

    grid.innerHTML = unassignedCard + accounts.map(function (a) {
        var balance = getAccountDisplayBalance(a);
        var subBadge = a.accountSubType ? '<span class="badge-subtype">' + escapeHtml(a.accountSubType) + '</span>' : '';
        var adjustBtn = a.accountType === 'investment'
            ? '<button class="btn-icon adjust" data-adjust-account="' + a.id + '" title="Sesuaikan Saldo"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></button>'
            : '';

        // Credit-specific content
        var creditContent = '';
        var balanceClass = '';
        if (a.accountType === 'credit') {
            balanceClass = ' credit-balance';
            var modeBadge = '<span class="badge-credit-mode badge-mode-' + (getCreditMode(a) || 'revolving') + '">' + getCreditModeLabel(getCreditMode(a)) + '</span>';
            var progress = getCreditProgress(a);
            var pct = progress.pct;
            var barColor;
            if (getCreditMode(a) === 'installment') {
                if (pct >= 100) barColor = '#10b981';
                else if (pct >= 50) barColor = '#4f46e5';
                else barColor = '#f59e0b';
            } else {
                if (pct >= 100) barColor = '#dc2626';
                else if (pct >= 80) barColor = '#f59e0b';
                else barColor = '#4f46e5';
            }
            var dueDateHtml = '';
            if (getCreditMode(a) !== 'installment' && a.dueDate) {
                var today = new Date().getDate();
                var dueDay = a.dueDate;
                var dueClass = today > dueDay ? 'due-past' : (dueDay - today <= 3 ? 'due-soon' : 'due-ok');
                dueDateHtml = '<span class="due-date-badge ' + dueClass + '">Jatuh Tempo: tgl ' + dueDay + '</span>';
            }
            var infoHtml = '';
            if (getCreditMode(a) === 'installment') {
                var remaining = getCreditRemaining(a);
                if (pct >= 100) {
                    infoHtml = '<span class="badge-lunas">Lunas</span>';
                } else if (a.monthlyInstallment) {
                    var monthsLeft = a.monthlyInstallment > 0 ? Math.ceil(remaining / a.monthlyInstallment) : 0;
                    infoHtml = '<span class="credit-installment-info">Cicilan: Rp ' + formatCurrency(a.monthlyInstallment) + '/bln · ' + monthsLeft + ' bln lagi</span>';
                }
            } else {
                if (a.creditLimit > 0) {
                    var usage = getCreditUsage(a);
                    var available = Math.max(0, a.creditLimit - usage);
                    infoHtml = '<span class="credit-available-info">Tersedia: Rp ' + formatCurrency(available) + '</span>';
                    if (a.minimumPaymentRate && usage > 0) {
                        var minPayment = Math.round(usage * a.minimumPaymentRate / 100);
                        infoHtml += ' · <span class="credit-min-payment">Min. Bayar: Rp ' + formatCurrency(minPayment) + '</span>';
                    }
                }
            }
            var progressLabel = getCreditMode(a) === 'installment'
                ? 'Terbayar: Rp ' + formatCurrency(progress.current) + ' / Rp ' + formatCurrency(progress.total)
                : 'Terpakai: Rp ' + formatCurrency(progress.current) + ' / Rp ' + formatCurrency(progress.total);
            creditContent = modeBadge + dueDateHtml +
                '<div class="credit-progress-section">' +
                    '<div class="credit-progress-label"><span>' + progressLabel + '</span></div>' +
                    '<div class="budget-progress-bar"><div class="budget-progress-fill" style="width:' + pct + '%;background:' + barColor + ';"></div></div>' +
                    '<div class="credit-progress-info">' + infoHtml + '<span class="credit-progress-pct">' + pct + '%</span></div>' +
                '</div>';
        }

        return '<div class="account-card type-' + a.accountType + '"><div class="account-card-header"><span class="account-bank-name">' + escapeHtml(a.bankName) + '</span><span class="account-type-badge badge-' + a.accountType + '">' + getAccountTypeLabel(a.accountType) + '</span>' + subBadge + '</div><span class="account-balance' + balanceClass + '">Rp ' + formatCurrency(balance) + '</span>' + creditContent + '<div class="account-card-actions">' + adjustBtn + '<button class="btn-icon edit" data-edit-account="' + a.id + '" title="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button><button class="btn-icon delete" data-delete-account="' + a.id + '" title="Hapus"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button></div></div>';
    }).join('');
}

// === DEBT RENDERING ===
function renderDebtDashboardSummary() {
    var totalHutang = debtCache.filter(function (d) { return d.type === 'hutang' && d.status !== 'paid'; })
        .reduce(function (s, d) { return s + (d.remainingAmount || 0); }, 0);
    var totalPiutang = debtCache.filter(function (d) { return d.type === 'piutang' && d.status !== 'paid'; })
        .reduce(function (s, d) { return s + (d.remainingAmount || 0); }, 0);
    var debtCard = document.getElementById('debt-summary-section');
    if (debtCard) {
        document.getElementById('dash-hutang-val').textContent = 'Rp ' + formatCurrency(totalHutang);
        document.getElementById('dash-piutang-val').textContent = 'Rp ' + formatCurrency(totalPiutang);
        var dashNet = totalPiutang - totalHutang;
        var dashNetEl = document.getElementById('dash-debt-net');
        dashNetEl.textContent = (dashNet >= 0 ? '+' : '') + 'Rp ' + formatCurrency(dashNet);
        dashNetEl.style.color = dashNet >= 0 ? 'var(--income)' : 'var(--expense)';
        debtCard.style.display = (totalHutang > 0 || totalPiutang > 0) ? '' : 'none';
    }
}

function renderDebts() {
    var debts = debtCache;
    var typeFilter = document.getElementById('debt-filter-type').value;
    var statusFilter = document.getElementById('debt-filter-status').value;

    var filtered = debts;
    if (typeFilter !== 'all') filtered = filtered.filter(function (d) { return d.type === typeFilter; });
    if (statusFilter === 'active') filtered = filtered.filter(function (d) { return d.status !== 'paid'; });
    else if (statusFilter !== 'all') filtered = filtered.filter(function (d) { return d.status === statusFilter; });

    var totalHutang = debts.filter(function (d) { return d.type === 'hutang' && d.status !== 'paid'; })
        .reduce(function (s, d) { return s + (d.remainingAmount || 0); }, 0);
    var totalPiutang = debts.filter(function (d) { return d.type === 'piutang' && d.status !== 'paid'; })
        .reduce(function (s, d) { return s + (d.remainingAmount || 0); }, 0);

    document.getElementById('debt-hutang-display').textContent = 'Rp ' + formatCurrency(totalHutang);
    document.getElementById('debt-piutang-display').textContent = 'Rp ' + formatCurrency(totalPiutang);
    var netDebt = totalPiutang - totalHutang;
    var netEl = document.getElementById('debt-net-display');
    netEl.textContent = (netDebt >= 0 ? '+' : '') + 'Rp ' + formatCurrency(netDebt);
    netEl.style.color = netDebt >= 0 ? 'var(--income)' : 'var(--expense)';

    document.getElementById('debt-list').innerHTML = renderDebtItems(filtered);
    populateDebtAccountSelect();
}

function renderDebtItems(debts) {
    if (!debts.length) {
        return '<div class="empty-state">Belum ada data hutang/piutang</div>';
    }
    return debts.map(function (d) {
        var typeLabel = d.type === 'hutang' ? 'Hutang' : 'Piutang';
        var typeClass = d.type === 'hutang' ? 'debt-hutang' : 'debt-piutang';
        var statusLabel = { pending: 'Belum Dibayar', partial: 'Cicilan', paid: 'Lunas' }[d.status] || d.status;
        var statusClass = 'debt-status-' + d.status;
        var account = d.accountId ? getAccountById(d.accountId) : null;
        var accountBadge = account ? ' <span class="tx-account-name">' + escapeHtml(account.bankName) + '</span>' : '';
        var paymentsHtml = '';
        var debtPayments = debtPaymentsCache[d.id] || [];
        if (debtPayments.length > 0) {
            paymentsHtml = '<div class="debt-payments">' + debtPayments.map(function (p, idx) {
                var pAccount = p.accountId ? getAccountById(p.accountId) : null;
                var pAccName = pAccount ? escapeHtml(pAccount.bankName) : 'Tanpa Akun';
                return '<div class="debt-payment-item">' +
                    '<span class="debt-payment-amount">' + (d.type === 'piutang' ? '+' : '−') + 'Rp ' + formatCurrency(p.amount) + '</span>' +
                    '<span class="debt-payment-meta">' + formatDate(p.date) + ' · ' + pAccName + (p.note ? ' · ' + escapeHtml(p.note) : '') + '</span>' +
                    '<button class="debt-payment-delete" data-debt-id="' + d.id + '" data-payment-idx="' + idx + '" title="Hapus Pembayaran"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
                    '</div>';
            }).join('') + '</div>';
        }
        var actionBtn = '';
        if (d.status !== 'paid') {
            actionBtn = '<button class="btn-debt-pay" data-debt-id="' + d.id + '">' +
                (d.type === 'hutang' ? 'Bayar' : 'Terima') + '</button>';
        }
        return '<div class="debt-item ' + typeClass + '">' +
            '<div class="debt-item-header">' +
                '<span class="debt-person">' + escapeHtml(d.person) + '</span>' +
                '<span class="debt-type-badge ' + typeClass + '">' + typeLabel + '</span>' +
                '<span class="debt-status-badge ' + statusClass + '">' + statusLabel + '</span>' +
            '</div>' +
            '<div class="debt-item-body">' +
                '<span class="debt-desc">' + escapeHtml(d.description) + '</span>' +
                '<span class="debt-meta">' + formatDate(d.date) + accountBadge + '</span>' +
            '</div>' +
            '<div class="debt-item-amounts">' +
                '<span class="debt-amount">Rp ' + formatCurrency(d.amount) + '</span>' +
                (d.status !== 'pending' ? '<span class="debt-remaining">Sisa: Rp ' + formatCurrency(d.remainingAmount) + '</span>' : '') +
            '</div>' +
            paymentsHtml +
            '<div class="debt-item-actions">' +
                actionBtn +
                '<button class="btn-icon edit" data-edit-debt="' + d.id + '" title="Edit"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>' +
                '<button class="btn-icon delete" data-delete-debt="' + d.id + '" title="Hapus"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>' +
            '</div>' +
            '</div>';
    }).join('');
}

function populateDebtAccountSelect() {
    var select = document.getElementById('debt-account');
    if (!select) return;
    var curVal = select.value;
    select.innerHTML = '<option value="">-- Pilih Akun --</option>';
    accCache.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.bankName + ' (' + getAccountTypeLabel(a.accountType) + ')';
        select.appendChild(opt);
    });
    select.value = curVal;
}

// === ACCOUNT MODAL ===
var modal = document.getElementById('account-modal');
var modalTitle = document.getElementById('modal-title');
var modalSubmitBtn = document.getElementById('modal-submit-btn');
var accIdInput = document.getElementById('acc-id');
var accBankInput = document.getElementById('acc-bank');
var accTypeInput = document.getElementById('acc-type');
var accSubTypeInput = document.getElementById('acc-subtype');
var accBalanceInput = document.getElementById('acc-balance');
var creditFields = document.getElementById('credit-fields');
var creditFieldsRevolving = document.getElementById('credit-fields-revolving');
var creditFieldsInstallment = document.getElementById('credit-fields-installment');
var accCreditLimitInput = document.getElementById('acc-credit-limit');
var accInterestRateInput = document.getElementById('acc-interest-rate');
var accDueDateInput = document.getElementById('acc-due-date');
var accMinPaymentRateInput = document.getElementById('acc-min-payment-rate');
var accTotalLoanInput = document.getElementById('acc-total-loan');
var accInterestRateInstInput = document.getElementById('acc-interest-rate-inst');
var accTenorMonthsInput = document.getElementById('acc-tenor-months');
var accMonthlyInstallmentInput = document.getElementById('acc-monthly-installment');
var accStartDateInput = document.getElementById('acc-start-date');

document.getElementById('btn-add-account').addEventListener('click', function () { openAccountModal(); });

document.getElementById('modal-close').addEventListener('click', closeAccountModal);

modal.addEventListener('click', function (e) {
    if (e.target === modal) closeAccountModal();
});

function populateSubTypeSelect(accountType) {
    accSubTypeInput.innerHTML = '<option value="">-- Pilih Sub Tipe --</option>';
    var subs = getSubTypes(accountType);
    subs.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        accSubTypeInput.appendChild(opt);
    });
}

function openAccountModal(account) {
    if (account) {
        modalTitle.textContent = 'Edit Akun';
        modalSubmitBtn.textContent = 'Simpan Perubahan';
        accIdInput.value = account.id;
        accBankInput.value = account.bankName;
        accTypeInput.value = account.accountType;
        populateSubTypeSelect(account.accountType);
        accSubTypeInput.value = account.accountSubType || '';
        accBalanceInput.value = account.initialBalance || 0;
        accBalanceInput.disabled = false;

        // Credit fields
        var isCredit = account.accountType === 'credit';
        creditFields.style.display = isCredit ? '' : 'none';
        var balLabel = document.getElementById('acc-balance').parentElement.querySelector('label');
        if (isCredit) {
            var isInstallment = (account.accountSubType || '') === 'Cicilan';
            balLabel.textContent = isInstallment ? 'Sudah Terbayar (Rp)' : 'Pemakaian Awal (Rp)';
            creditFieldsRevolving.style.display = isInstallment ? 'none' : '';
            creditFieldsInstallment.style.display = isInstallment ? '' : 'none';
            // Revolving fields
            accCreditLimitInput.value = account.creditLimit || 0;
            accInterestRateInput.value = account.interestRate || 0;
            accDueDateInput.value = account.dueDate || 15;
            accMinPaymentRateInput.value = account.minimumPaymentRate || 10;
            // Installment fields
            accTotalLoanInput.value = account.totalLoan || 0;
            accInterestRateInstInput.value = account.interestRate || 0;
            accTenorMonthsInput.value = account.tenorMonths || 12;
            accMonthlyInstallmentInput.value = account.monthlyInstallment || 0;
            accStartDateInput.value = account.startDate || '';
        } else {
            balLabel.textContent = 'Saldo Awal (Rp)';
        }
    } else {
        modalTitle.textContent = 'Tambah Akun';
        modalSubmitBtn.textContent = 'Simpan Akun';
        document.getElementById('account-form').reset();
        accIdInput.value = '';
        populateSubTypeSelect('passive');
        accSubTypeInput.value = '';
        accBalanceInput.disabled = false;
        accBalanceInput.value = '0';
        document.getElementById('acc-balance').parentElement.querySelector('label').textContent = 'Saldo Awal (Rp)';
        creditFields.style.display = 'none';
        creditFieldsRevolving.style.display = '';
        creditFieldsInstallment.style.display = 'none';
    }
    modal.classList.add('show');
}

// Update sub-type options and credit fields when account type changes
accTypeInput.addEventListener('change', function () {
    populateSubTypeSelect(accTypeInput.value);
    var isCredit = accTypeInput.value === 'credit';
    creditFields.style.display = isCredit ? '' : 'none';
    var balLabel = document.getElementById('acc-balance').parentElement.querySelector('label');
    if (isCredit) {
        var isInstallment = accSubTypeInput.value === 'Cicilan';
        balLabel.textContent = isInstallment ? 'Sudah Terbayar (Rp)' : 'Pemakaian Awal (Rp)';
        creditFieldsRevolving.style.display = isInstallment ? 'none' : '';
        creditFieldsInstallment.style.display = isInstallment ? '' : 'none';
    } else {
        balLabel.textContent = 'Saldo Awal (Rp)';
        creditFieldsRevolving.style.display = '';
        creditFieldsInstallment.style.display = 'none';
    }
});

// Toggle revolving/installment sub-fields based on sub-type selection
accSubTypeInput.addEventListener('change', function () {
    if (accTypeInput.value !== 'credit') return;
    var isInstallment = accSubTypeInput.value === 'Cicilan';
    creditFieldsRevolving.style.display = isInstallment ? 'none' : '';
    creditFieldsInstallment.style.display = isInstallment ? '' : 'none';
    var balLabel = document.getElementById('acc-balance').parentElement.querySelector('label');
    if (balLabel) balLabel.textContent = isInstallment ? 'Sudah Terbayar (Rp)' : 'Pemakaian Awal (Rp)';
});

function closeAccountModal() {
    modal.classList.remove('show');
}

document.getElementById('account-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = accIdInput.value;
    var bankName = accBankInput.value.trim();
    var accountType = accTypeInput.value;
    var accountSubType = accSubTypeInput.value;
    var initialBalance = parseInt(accBalanceInput.value) || 0;

    if (!bankName) return;
    if (!uid) return;

    var data = {
        bankName: bankName,
        accountType: accountType,
        accountSubType: accountSubType,
        initialBalance: initialBalance
    };

    // Credit-specific fields
    if (accountType === 'credit') {
        var creditMode = accountSubType === 'Cicilan' ? 'installment' : 'revolving';
        data.creditMode = creditMode;
        data.interestRate = parseFloat((creditMode === 'installment' ? accInterestRateInstInput : accInterestRateInput).value) || 0;
        if (creditMode === 'installment') {
            data.totalLoan = parseInt(accTotalLoanInput.value) || 0;
            data.tenorMonths = parseInt(accTenorMonthsInput.value) || 0;
            data.monthlyInstallment = parseInt(accMonthlyInstallmentInput.value) || 0;
            data.startDate = accStartDateInput.value || '';
        } else {
            data.creditLimit = parseInt(accCreditLimitInput.value) || 0;
            data.dueDate = parseInt(accDueDateInput.value) || 15;
            data.minimumPaymentRate = parseFloat(accMinPaymentRateInput.value) || 10;
        }
    }

    if (id) {
        // Edit mode
        db.collection('users').doc(uid).collection('accounts').doc(id).update(data).then(function () {
            closeAccountModal();
            showToast('Akun berhasil diperbarui!');
        }).catch(function (err) {
            showToast('Gagal memperbarui: ' + err.message);
        });
    } else {
        // Add mode
        data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        db.collection('users').doc(uid).collection('accounts').add(data).then(function () {
            closeAccountModal();
            showToast('Akun berhasil ditambahkan!');
        }).catch(function (err) {
            showToast('Gagal menambah: ' + err.message);
        });
    }
});

// === INVESTMENT ADJUSTMENT MODAL ===
var adjModal = document.getElementById('adjustment-modal');
var adjAccountId = document.getElementById('adj-account-id');
var adjCurrentInput = document.getElementById('adj-current-balance');
var adjNewInput = document.getElementById('adj-new-balance');
var adjDateInput = document.getElementById('adj-date');
var adjPreview = document.getElementById('adj-preview');

function openAdjustmentModal(account) {
    adjAccountId.value = account.id;
    var currentBalance = getAccountDisplayBalance(account);
    adjCurrentInput.value = 'Rp ' + formatCurrency(currentBalance);
    adjNewInput.value = '';
    adjDateInput.value = new Date().toISOString().slice(0, 10);
    adjPreview.style.display = 'none';
    document.getElementById('adjustment-modal-title').textContent = 'Sesuaikan: ' + account.bankName;
    adjModal.classList.add('show');
}

// Live P/L preview as user types
adjNewInput.addEventListener('input', function () {
    var currentStr = adjCurrentInput.value.replace(/[^0-9]/g, '');
    var currentVal = parseInt(currentStr) || 0;
    var newVal = parseInt(adjNewInput.value) || 0;
    if (newVal === 0 || currentVal === 0) {
        adjPreview.style.display = 'none';
        return;
    }
    var diff = newVal - currentVal;
    var isProfit = diff > 0;
    adjPreview.style.display = 'flex';
    adjPreview.innerHTML = '<span class="adj-label">' + (isProfit ? 'Keuntungan' : 'Kerugian') + '</span>' +
        '<span class="adj-diff ' + (isProfit ? 'adj-profit' : 'adj-loss') + '">' +
        (isProfit ? '+' : '−') + 'Rp ' + formatCurrency(Math.abs(diff)) + '</span>';
});

// Form submit
document.getElementById('adjustment-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var accountId = adjAccountId.value;
    var currentStr = adjCurrentInput.value.replace(/[^0-9]/g, '');
    var previousValue = parseInt(currentStr) || 0;
    var newValue = parseInt(adjNewInput.value) || 0;
    var date = adjDateInput.value;
    var diff = newValue - previousValue;

    if (!uid || !accountId) return;
    if (!newValue && newValue !== 0) return;

    var adjData = {
        date: date,
        previousValue: previousValue,
        newValue: newValue,
        difference: diff,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('users').doc(uid).collection('accounts').doc(accountId)
        .collection('adjustments').add(adjData)
        .then(function () {
            return db.collection('users').doc(uid).collection('accounts').doc(accountId).update({
                currentValue: newValue,
                lastAdjustedAt: date
            });
        })
        .then(function () {
            adjModal.classList.remove('show');
            showToast('Saldo investasi disesuaikan!');
        })
        .catch(function (err) {
            showToast('Gagal: ' + err.message);
        });
});

// Close button
document.getElementById('adjustment-modal-close').addEventListener('click', function () {
    adjModal.classList.remove('show');
});

// Click outside to close
adjModal.addEventListener('click', function (e) {
    if (e.target === adjModal) adjModal.classList.remove('show');
});

// Edit & Delete account (event delegation)
document.addEventListener('click', function (e) {
    var adjustBtn = e.target.closest('[data-adjust-account]');
    if (adjustBtn) {
        var adjustId = adjustBtn.dataset.adjustAccount;
        var account = accCache.find(function (a) { return a.id === adjustId; });
        if (account) openAdjustmentModal(account);
        return;
    }

    var editBtn = e.target.closest('[data-edit-account]');
    if (editBtn) {
        var editId = editBtn.dataset.editAccount;
        var account = accCache.find(function (a) { return a.id === editId; });
        if (account) openAccountModal(account);
        return;
    }

    var deleteBtn = e.target.closest('[data-delete-account]');
    if (deleteBtn) {
        var deleteId = deleteBtn.dataset.deleteAccount;
        var acc = accCache.find(function (a) { return a.id === deleteId; });
        if (!acc) return;
        if (!confirm('Hapus akun "' + acc.bankName + '"? Transaksi terkait tidak akan dihapus.')) return;
        if (!uid) return;

        db.collection('users').doc(uid).collection('accounts').doc(deleteId).delete()
            .then(function () {
                showToast('Akun berhasil dihapus');
            })
            .catch(function (err) {
                showToast('Gagal menghapus: ' + err.message);
            });
        return;
    }
});

// === DEBT MODALS ===
var debtModal = document.getElementById('debt-modal');
var paymentModal = document.getElementById('payment-modal');
var editingDebtId = null;

// --- Debt Form Modal ---
document.getElementById('btn-add-debt').addEventListener('click', function () { openDebtModal(); });

function openDebtModal(debt) {
    editingDebtId = debt ? debt.id : null;
    document.getElementById('debt-id').value = debt ? debt.id : '';
    document.getElementById('debt-modal-title').textContent = debt ? 'Edit Hutang/Piutang' : 'Tambah Hutang/Piutang';
    document.getElementById('debt-type').value = debt ? debt.type : 'hutang';
    document.getElementById('debt-person').value = debt ? debt.person : '';
    document.getElementById('debt-amount').value = debt ? debt.amount : '';
    document.getElementById('debt-desc').value = debt ? (debt.description || '') : '';
    document.getElementById('debt-date').value = debt ? debt.date : new Date().toISOString().slice(0, 10);
    populateDebtAccountSelect();
    document.getElementById('debt-account').value = debt ? (debt.accountId || '') : '';
    document.getElementById('debt-submit-btn').textContent = debt ? 'Update' : 'Simpan';
    debtModal.classList.add('show');
}

document.getElementById('debt-modal-close').addEventListener('click', function () {
    debtModal.classList.remove('show');
    editingDebtId = null;
});

debtModal.addEventListener('click', function (e) {
    if (e.target === debtModal) { debtModal.classList.remove('show'); editingDebtId = null; }
});

document.getElementById('debt-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!uid) return;

    var type = document.getElementById('debt-type').value;
    var person = document.getElementById('debt-person').value.trim();
    var amount = parseInt(document.getElementById('debt-amount').value) || 0;
    var desc = document.getElementById('debt-desc').value.trim();
    var date = document.getElementById('debt-date').value;
    var accountId = document.getElementById('debt-account').value;
    var category = document.getElementById('debt-category').value;

    if (!person || amount <= 0 || !date || !category) {
        showToast('Mohon isi nama, jumlah, tanggal, dan kategori');
        return;
    }

    var debtData = {
        person: person,
        type: type,
        amount: amount,
        description: desc,
        date: date,
        accountId: accountId,
        category: category
    };

    var debtId = document.getElementById('debt-id').value;
    if (debtId) {
        // Update existing debt
        var existing = debtCache.find(function (d) { return d.id === debtId; });
        if (existing) {
            var existingPayments = debtPaymentsCache[debtId] || [];
            var totalPaid = existingPayments.reduce(function (s, p) { return s + p.amount; }, 0);
            var newRemaining = Math.max(0, amount - totalPaid);
            var newStatus = 'pending';
            if (newRemaining <= 0) newStatus = 'paid';
            else if (totalPaid > 0 && newRemaining < amount) newStatus = 'partial';
            debtData.remainingAmount = newRemaining;
            debtData.status = newStatus;
            if (newStatus === 'paid') debtData.settledAt = firebase.firestore.FieldValue.serverTimestamp();
            if (newStatus !== 'paid' && existing.status === 'paid') debtData.settledAt = null;
        }
        db.collection('users').doc(uid).collection('debts').doc(debtId).update(debtData)
            .then(function () {
                showToast('Hutang/piutang berhasil diupdate');
                debtModal.classList.remove('show');
                editingDebtId = null;
            })
            .catch(function (err) {
                showToast('Gagal mengupdate: ' + err.message);
            });
    } else {
        // Create new
        debtData.remainingAmount = amount;
        debtData.status = 'pending';
        debtData.settledAt = null;
        debtData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        db.collection('users').doc(uid).collection('debts').add(debtData)
            .then(function () {
                showToast('Hutang/piutang berhasil ditambahkan');
                debtModal.classList.remove('show');
                editingDebtId = null;
            })
            .catch(function (err) {
                showToast('Gagal menambahkan: ' + err.message);
            });
    }
});

// --- Payment Modal ---
document.getElementById('payment-modal-close').addEventListener('click', function () {
    paymentModal.classList.remove('show');
});

paymentModal.addEventListener('click', function (e) {
    if (e.target === paymentModal) paymentModal.classList.remove('show');
});

function openPaymentModal(debtId) {
    var debt = debtCache.find(function (d) { return d.id === debtId; });
    if (!debt) return;
    document.getElementById('payment-debt-id').value = debtId;
    document.getElementById('payment-amount').value = '';
    document.getElementById('payment-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('payment-note').value = '';
    // Populate payment account dropdown
    var pSelect = document.getElementById('payment-account');
    pSelect.innerHTML = '<option value="">-- Pilih Akun --</option>';
    accCache.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.bankName + ' (' + getAccountTypeLabel(a.accountType) + ')';
        pSelect.appendChild(opt);
    });
    // Pre-select debt's linked account if set
    pSelect.value = debt.accountId || '';

    var infoEl = document.getElementById('payment-info');
    var label = debt.type === 'hutang' ? 'Hutang' : 'Piutang';
    var remaining = debt.remainingAmount != null ? debt.remainingAmount : debt.amount;
    infoEl.innerHTML = '<strong>' + escapeHtml(debt.person) + '</strong> · ' + label + ' · Total: Rp ' + formatCurrency(debt.amount) + ' · <strong>Sisa: Rp ' + formatCurrency(remaining) + '</strong>';

    document.getElementById('payment-modal-title').textContent = debt.type === 'hutang' ? 'Bayar Hutang' : 'Terima Pembayaran Piutang';
    paymentModal.classList.add('show');
}

document.getElementById('payment-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!uid) return;

    var debtId = document.getElementById('payment-debt-id').value;
    var debt = debtCache.find(function (d) { return d.id === debtId; });
    if (!debt) return;

    var payAmount = parseInt(document.getElementById('payment-amount').value) || 0;
    var payDate = document.getElementById('payment-date').value;
    var payAccountId = document.getElementById('payment-account').value;
    var payNote = document.getElementById('payment-note').value.trim();
    var remaining = debt.remainingAmount != null ? debt.remainingAmount : debt.amount;

    if (payAmount <= 0 || !payDate) {
        showToast('Mohon isi jumlah dan tanggal pembayaran');
        return;
    }

    if (payAmount > remaining) {
        if (!confirm('Pembayaran Rp ' + formatCurrency(payAmount) + ' melebihi sisa Rp ' + formatCurrency(remaining) + '. Lanjutkan?')) return;
    }

    var payments = (debtPaymentsCache[debtId] || []).slice();
    payments.push({
        amount: payAmount,
        date: payDate,
        accountId: payAccountId,
        note: payNote,
        createdAt: new Date().toISOString()
    });

    var totalPaid = payments.reduce(function (s, p) { return s + p.amount; }, 0);
    var newRemaining = Math.max(0, debt.amount - totalPaid);
    var newStatus = 'pending';
    if (newRemaining <= 0) newStatus = 'paid';
    else if (payments.length > 0) newStatus = 'partial';

    // Write payment to subcollection
    var debtRef = db.collection('users').doc(uid).collection('debts').doc(debtId);
    debtRef.collection('payments').add({
        amount: payAmount,
        date: payDate,
        accountId: payAccountId,
        note: payNote,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(function () {
        // Update debt's remainingAmount and status
        var updateData = {
            remainingAmount: newRemaining,
            status: newStatus
        };
        if (newStatus === 'paid') {
            updateData.settledAt = firebase.firestore.FieldValue.serverTimestamp();
        }
        return debtRef.update(updateData);
    }).then(function () {
        // Create transaction for payment (ledger)
        var txType = debt.type === 'piutang' ? 'income' : 'expense';
        var txCategory;
        if (debt.type === 'piutang') {
            txCategory = '💰 Piutang';
        } else {
            txCategory = (debt.category && CATEGORIES.expense.indexOf(debt.category) !== -1)
                ? debt.category
                : 'Hutang';
        }
        var txPrefix = debt.type === 'piutang' ? 'Bayar: ' : 'Bayar Hutang: ';
        var txDesc = txPrefix + debt.person + (payNote ? ' - ' + payNote : '');
        return db.collection('users').doc(uid).collection('transactions').add({
            desc: txDesc,
            amount: payAmount,
            type: txType,
            category: txCategory,
            date: payDate,
            accountId: payAccountId,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
    }).then(function () {
        showToast('Pembayaran berhasil dicatat');
        paymentModal.classList.remove('show');
    }).catch(function (err) {
        showToast('Gagal mencatat pembayaran: ' + err.message);
    });
});

// --- Debt filter listeners ---
document.getElementById('debt-filter-type').addEventListener('change', function () { renderDebts(); });
document.getElementById('debt-filter-status').addEventListener('change', function () { renderDebts(); });

// --- Debt event delegation (edit/delete/pay) ---
document.addEventListener('click', function (e) {
    // Edit debt
    var editBtn = e.target.closest('[data-edit-debt]');
    if (editBtn) {
        var editId = editBtn.dataset.editDebt;
        var debt = debtCache.find(function (d) { return d.id === editId; });
        if (debt) openDebtModal(debt);
        return;
    }

    // Delete debt
    var deleteBtn = e.target.closest('[data-delete-debt]');
    if (deleteBtn) {
        var deleteId = deleteBtn.dataset.deleteDebt;
        var d = debtCache.find(function (x) { return x.id === deleteId; });
        if (!d) return;
        if (!confirm('Hapus hutang/piutang "' + d.person + '" (Rp ' + formatCurrency(d.amount) + ')? Semua pembayaran terkait juga akan dihapus.')) return;
        if (!uid) return;
        var debtRef = db.collection('users').doc(uid).collection('debts').doc(deleteId);
        // Delete payments subcollection first
        debtRef.collection('payments').get().then(function (paySnap) {
            var batch = db.batch();
            paySnap.docs.forEach(function (pd) { batch.delete(pd.ref); });
            batch.delete(debtRef);
            return batch.commit();
        }).then(function () { showToast('Berhasil dihapus'); })
            .catch(function (err) { showToast('Gagal menghapus: ' + err.message); });
        return;
    }

    // Pay button
    var payBtn = e.target.closest('.btn-debt-pay');
    if (payBtn) {
        var payId = payBtn.dataset.debtId;
        openPaymentModal(payId);
        return;
    }

    // Delete payment
    var delPayBtn = e.target.closest('.debt-payment-delete');
    if (delPayBtn) {
        var debtId = delPayBtn.dataset.debtId;
        var payIdx = parseInt(delPayBtn.dataset.paymentIdx);
        var debt = debtCache.find(function (x) { return x.id === debtId; });
        var debtPayments = debtPaymentsCache[debtId] || [];
        if (!debt || payIdx < 0 || payIdx >= debtPayments.length) return;
        if (!confirm('Hapus pembayaran Rp ' + formatCurrency(debtPayments[payIdx].amount) + '?')) return;
        if (!uid) return;

        var payToDelete = debtPayments[payIdx];
        var remainingPayments = debtPayments.filter(function (_, i) { return i !== payIdx; });
        var totalPaid = remainingPayments.reduce(function (s, p) { return s + p.amount; }, 0);
        var newRemaining = Math.max(0, debt.amount - totalPaid);
        var newStatus = 'pending';
        if (newRemaining <= 0) newStatus = 'paid';
        else if (remainingPayments.length > 0) newStatus = 'partial';

        var debtRef = db.collection('users').doc(uid).collection('debts').doc(debtId);
        debtRef.collection('payments').doc(payToDelete.id).delete()
            .then(function () {
                var updateData = {
                    remainingAmount: newRemaining,
                    status: newStatus
                };
                if (newStatus !== 'paid') updateData.settledAt = null;
                return debtRef.update(updateData);
            })
            .then(function () { showToast('Pembayaran dihapus'); })
            .catch(function (err) { showToast('Gagal menghapus pembayaran: ' + err.message); });
        return;
    }
});

// === SCANNER: AI IMAGE PARSING (Gemini only) ===
var scannerImageData = null; // { base64, mediaType }

// DOM refs
var scannerSection = document.getElementById('scanner-body');
var btnToggle = document.getElementById('btn-scanner-toggle');
var uploadZone = document.getElementById('upload-zone');
var fileInput = document.getElementById('scanner-file');
var previewArea = document.getElementById('preview-area');
var previewImage = document.getElementById('preview-image');
var btnRemove = document.getElementById('btn-remove-image');
var btnParse = document.getElementById('btn-parse');
var parseResult = document.getElementById('parse-result');
var parseFields = document.getElementById('parse-fields');
var parseConfidence = document.getElementById('parse-confidence');
var parseError = document.getElementById('parse-error');
var parsedData = null;

// Toggle scanner
btnToggle.addEventListener('click', function () {
    var open = scannerSection.classList.toggle('open');
    btnToggle.classList.toggle('active', open);
});

// Click to upload
uploadZone.addEventListener('click', function () { fileInput.click(); });
fileInput.addEventListener('change', function (e) {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
});

// Drag & drop
uploadZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});
uploadZone.addEventListener('dragleave', function () {
    uploadZone.classList.remove('dragover');
});
uploadZone.addEventListener('drop', function (e) {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleImageFile(e.dataTransfer.files[0]);
});

// Remove image
btnRemove.addEventListener('click', function () {
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
    btnParse.disabled = !scannerImageData;
}

// Clipboard paste
document.addEventListener('paste', function (e) {
    if (!scannerSection.classList.contains('open')) return;
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (var i = 0; i < items.length; i++) {
        if (items[i].type.match(/^image\//)) {
            e.preventDefault();
            var blob = items[i].getAsFile();
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

    var reader = new FileReader();
    reader.onload = function () {
        var base64 = reader.result.split(',')[1];
        var mediaType = file.type;
        scannerImageData = { base64: base64, mediaType: mediaType };

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
btnParse.addEventListener('click', function () {
    if (!scannerImageData) return;
    parseImage();
});

async function parseImage() {
    btnParse.disabled = true;
    btnParse.querySelector('.btn-parse-text').style.display = 'none';
    btnParse.querySelector('.btn-parse-loading').style.display = 'flex';
    parseResult.style.display = 'none';
    parseError.style.display = 'none';

    try {
        var imageData = scannerImageData.base64;
        if (imageData.length > 5 * 1024 * 1024 / 4 * 3) {
            imageData = await resizeImage(imageData, scannerImageData.mediaType);
        }
        var callable = firebase.functions().httpsCallable('callGemini');
        var response = await callable({ base64: imageData, mediaType: scannerImageData.mediaType });
        var text = response.data.text || '';
        parsedData = normalizeResult(extractJSON(text));
        displayParseResult(parsedData);
    } catch (err) {
        showParseError(err.message || 'Gagal memanggil Gemini API.');
    } finally {
        btnParse.disabled = false;
        btnParse.querySelector('.btn-parse-text').style.display = 'flex';
        btnParse.querySelector('.btn-parse-loading').style.display = 'none';
    }
}

function extractJSON(text) {
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Tidak dapat menemukan JSON dalam response AI.');
}

function normalizeResult(result) {
    var cats = result.type === 'income' ? CATEGORIES.income : CATEGORIES.expense;
    var base = {
        description: result.description || '',
        amount: parseInt(result.amount) || 0,
        type: result.type === 'income' ? 'income' : 'expense',
        category: cats.includes(result.category) ? result.category : cats[cats.length - 1],
        date: result.date && /^\d{4}-\d{2}-\d{2}$/.test(result.date) ? result.date : new Date().toISOString().slice(0, 10),
        accountHint: result.accountHint || ''
    };
    // Preserve split bill from AI scanner
    if (result.splitBill) {
        base.splitBill = result.splitBill;
    }
    return base;
}

function displayParseResult(data) {
    var matchedAccount = data.accountHint
        ? accCache.find(function (a) { return a.bankName.toLowerCase().includes(data.accountHint.toLowerCase()); })
        : null;

    parseFields.innerHTML = '<div class="parse-field"><span class="parse-field-label">Deskripsi</span><span class="parse-field-value ' + (data.description ? '' : 'missing') + '">' + escapeHtml(data.description || '(tidak terdeteksi)') + '</span></div><div class="parse-field"><span class="parse-field-label">Jumlah</span><span class="parse-field-value">Rp ' + formatCurrency(data.amount) + '</span></div><div class="parse-field"><span class="parse-field-label">Tipe</span><span class="parse-field-value">' + (data.type === 'income' ? 'Pemasukan' : 'Pengeluaran') + '</span></div><div class="parse-field"><span class="parse-field-label">Kategori</span><span class="parse-field-value">' + escapeHtml(data.category) + '</span></div><div class="parse-field"><span class="parse-field-label">Tanggal</span><span class="parse-field-value">' + formatDate(data.date) + '</span></div><div class="parse-field"><span class="parse-field-label">Akun</span><span class="parse-field-value ' + (matchedAccount ? '' : 'missing') + '">' + (matchedAccount ? escapeHtml(matchedAccount.bankName) : (data.accountHint || '(pilih manual)')) + '</span></div>';

    // Show split bill info if detected
    if (data.splitBill) {
        var splitInfo = data.splitBill;
        var splitHtml = '<div class="parse-field"><span class="parse-field-label">Split Bill</span>';
        if (splitInfo.mode === 'equal' && splitInfo.totalPeople) {
            var splitPerPerson = Math.floor(data.amount / splitInfo.totalPeople);
            splitHtml += '<span class="parse-field-value">Rata ' + splitInfo.totalPeople + ' orang, @ Rp ' + formatCurrency(splitPerPerson) + '</span>';
        } else if (splitInfo.participants && splitInfo.participants.length > 0) {
            splitHtml += '<span class="parse-field-value">' + splitInfo.participants.map(function (p) {
                return escapeHtml(p.person) + ': Rp ' + formatCurrency(p.amount);
            }).join(', ') + '</span>';
        } else {
            splitHtml += '<span class="parse-field-value">Terdeteksi</span>';
        }
        splitHtml += '</div>';
        parseFields.innerHTML += splitHtml;
    }

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
document.getElementById('btn-apply').addEventListener('click', function () {
    if (!parsedData) return;
    if (currentType === 'transfer') {
        showToast('Scan tidak tersedia untuk transfer.');
        return;
    }

    // Set type tabs to match parsed data
    currentType = parsedData.type;
    typeTabs.querySelectorAll('.type-tab').forEach(function (t) { t.classList.remove('active'); });
    var targetTab = typeTabs.querySelector('[data-type="' + parsedData.type + '"]');
    if (targetTab) targetTab.classList.add('active');
    updateFormForType();

    document.getElementById('desc').value = parsedData.description;
    document.getElementById('amount').value = parsedData.amount || '';
    updateCategoryOptions();
    document.getElementById('category').value = parsedData.category;
    document.getElementById('date').value = parsedData.date;

    if (parsedData.accountHint) {
        var match = accCache.find(function (a) {
            return a.bankName.toLowerCase().includes(parsedData.accountHint.toLowerCase());
        });
        if (match) {
            document.getElementById('tx-account').value = match.id;
        }
    }

    // Apply split bill from parsed data
    if (parsedData.splitBill) {
        var sb = parsedData.splitBill;
        document.getElementById('split-bill-enabled').checked = true;
        document.getElementById('split-bill-body').style.display = '';
        if (sb.mode === 'equal' && sb.totalPeople) {
            document.querySelector('input[name="split-mode"][value="equal"]').checked = true;
            document.getElementById('split-equal-row').style.display = '';
            document.getElementById('split-custom-row').style.display = 'none';
            document.getElementById('split-total-people').value = sb.totalPeople;
            updateEqualSplitSummary();
        } else if (sb.participants && sb.participants.length > 0) {
            document.querySelector('input[name="split-mode"][value="custom"]').checked = true;
            document.getElementById('split-equal-row').style.display = 'none';
            document.getElementById('split-custom-row').style.display = '';
            var list = document.getElementById('split-participants-list');
            list.innerHTML = '';
            sb.participants.forEach(function (p) {
                addParticipantRow(p.person || 'Teman');
                var rows = list.querySelectorAll('.split-participant-row');
                var lastRow = rows[rows.length - 1];
                if (p.amount) lastRow.querySelector('.split-part-amount').value = p.amount;
            });
            updateCustomSplitSummary();
        }
    }

    showToast('Form terisi dari hasil scan! Silakan periksa kembali.');
});

document.getElementById('btn-cancel-parse').addEventListener('click', function () {
    parseResult.style.display = 'none';
    parsedData = null;
});

// Image resize via canvas
function resizeImage(base64, mediaType) {
    return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
            var maxDim = 1200;
            var w = img.width;
            var h = img.height;
            if (w > maxDim || h > maxDim) {
                var ratio = Math.min(maxDim / w, maxDim / h);
                w = Math.round(w * ratio);
                h = Math.round(h * ratio);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            var resized = canvas.toDataURL(mediaType, 0.8).split(',')[1];
            resolve(resized);
        };
        img.src = 'data:' + mediaType + ';base64,' + base64;
    });
}

// === SETTINGS INIT ===
(function () {
    // Settings toggle button
    var btnSettingsToggle = document.getElementById('btn-settings-toggle');
    var settingsBody = document.getElementById('settings-body');
    var settingsChevron = document.querySelector('.settings-chevron');
    if (btnSettingsToggle && settingsBody) {
        settingsBody.style.display = 'none';
        settingsChevron.style.transform = 'rotate(-90deg)';
        btnSettingsToggle.addEventListener('click', function () {
            var isHidden = settingsBody.style.display === 'none';
            settingsBody.style.display = isHidden ? 'grid' : 'none';
            settingsBody.classList.toggle('open', isHidden);
            btnSettingsToggle.classList.toggle('active', isHidden);
            settingsChevron.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
        });
    }

    var paydayInput = document.getElementById('payday-start');
    if (!paydayInput) return;

    // Fire when user manually changes payday
    paydayInput.addEventListener('change', function () {
        var val = parseInt(paydayInput.value) || 1;
        val = Math.max(1, Math.min(28, val));
        paydayInput.value = val;
        if (!uid) return;
        db.collection('users').doc(uid).collection('settings').doc('main')
            .set({ paydayStart: val }, { merge: true })
            .catch(function () { /* silent */ });
    });

    // Add payday override
    var btnAddOverride = document.getElementById('btn-add-override');
    if (btnAddOverride) {
        btnAddOverride.addEventListener('click', function () {
            var monthInput = document.getElementById('override-month');
            var dayInput = document.getElementById('override-day');
            if (!monthInput || !dayInput) return;
            var monthKey = monthInput.value;
            var day = parseInt(dayInput.value, 10);
            if (!monthKey || !day || day < 1 || day > 28) {
                showToast('Pilih bulan dan tanggal (1-28)');
                return;
            }
            if (!uid) return;
            paydayOverridesCache[monthKey] = day;
            db.collection('users').doc(uid).collection('settings').doc('paydayOverrides')
                .set(paydayOverridesCache, { merge: true })
                .then(function () {
                    showToast('Pengecualian disimpan!');
                    monthInput.value = '';
                    dayInput.value = '';
                })
                .catch(function (err) { showToast('Gagal: ' + err.message); });
        });
    }
})();

// === SIMULASI KREDIT ===
function initSimulasiPage() {
    var btnHitung = document.getElementById('btn-hitung-simulasi');
    var btnBuatAkun = document.getElementById('btn-buat-akun-cicilan');

    if (btnHitung && !btnHitung.dataset.bound) {
        btnHitung.dataset.bound = '1';
        btnHitung.addEventListener('click', hitungSimulasi);
    }
    if (btnBuatAkun && !btnBuatAkun.dataset.bound) {
        btnBuatAkun.dataset.bound = '1';
        btnBuatAkun.addEventListener('click', buatAkunDariSimulasi);
    }
}

function hitungSimulasi() {
    var jumlah = parseInt(document.getElementById('sim-jumlah').value) || 0;
    var dp = parseInt(document.getElementById('sim-dp').value) || 0;
    var bungaTahunan = parseFloat(document.getElementById('sim-bunga').value) || 0;
    var tenor = parseInt(document.getElementById('sim-tenor').value) || 0;
    var tipe = document.getElementById('sim-tipe').value;

    if (!jumlah || !tenor) {
        showToast('Isi jumlah pinjaman dan tenor.');
        return;
    }

    var pinjaman = Math.max(0, jumlah - dp);
    var hasil = document.getElementById('sim-hasil');
    hasil.style.display = '';

    var cicilan, totalBayar, totalBunga;
    var amortBody = document.getElementById('sim-amort-body');
    var bulanan = bungaTahunan / 100 / 12;

    if (tipe === 'flat') {
        totalBunga = pinjaman * (bungaTahunan / 100) * (tenor / 12);
        totalBayar = pinjaman + totalBunga;
        cicilan = Math.round(totalBayar / tenor);
        // Flat amortization
        var pokokPerBulan = Math.round(pinjaman / tenor);
        var bungaPerBulan = Math.round(totalBunga / tenor);
        var sisa = pinjaman;
        var rows = '';
        var maxShow = Math.min(tenor, 12);
        for (var i = 1; i <= maxShow; i++) {
            sisa -= pokokPerBulan;
            if (sisa < 0) sisa = 0;
            rows += '<tr><td>' + i + '</td><td>Rp ' + formatCurrency(cicilan) + '</td><td>Rp ' + formatCurrency(pokokPerBulan) + '</td><td>Rp ' + formatCurrency(bungaPerBulan) + '</td><td>Rp ' + formatCurrency(sisa) + '</td></tr>';
        }
        if (tenor > 12) {
            rows += '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">...</td></tr>';
            rows += '<tr><td>' + tenor + '</td><td>Rp ' + formatCurrency(cicilan) + '</td><td>Rp ' + formatCurrency(pokokPerBulan + (pinjaman % tenor > 0 ? pinjaman % tenor : 0)) + '</td><td>Rp ' + formatCurrency(bungaPerBulan) + '</td><td>Rp 0</td></tr>';
        }
        amortBody.innerHTML = rows;
    } else {
        // Efektif/Anuitas
        if (bulanan > 0) {
            cicilan = Math.round(pinjaman * bulanan * Math.pow(1 + bulanan, tenor) / (Math.pow(1 + bulanan, tenor) - 1));
        } else {
            cicilan = Math.round(pinjaman / tenor);
        }
        totalBayar = cicilan * tenor;
        totalBunga = totalBayar - pinjaman;

        var sisaPinjaman = pinjaman;
        var rows = '';
        var maxShow = Math.min(tenor, 12);
        for (var j = 1; j <= maxShow; j++) {
            var bungaBulan = Math.round(sisaPinjaman * bulanan);
            var pokokBulan = cicilan - bungaBulan;
            if (j === tenor) {
                pokokBulan = sisaPinjaman;
                bungaBulan = cicilan - pokokBulan;
            }
            sisaPinjaman -= pokokBulan;
            if (sisaPinjaman < 0) sisaPinjaman = 0;
            rows += '<tr><td>' + j + '</td><td>Rp ' + formatCurrency(cicilan) + '</td><td>Rp ' + formatCurrency(pokokBulan) + '</td><td>Rp ' + formatCurrency(bungaBulan) + '</td><td>Rp ' + formatCurrency(sisaPinjaman) + '</td></tr>';
        }
        if (tenor > 12) {
            rows += '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);">...</td></tr>';
            // Calculate last row
            sisaPinjaman = pinjaman;
            for (var k = 1; k < tenor; k++) {
                var bb = Math.round(sisaPinjaman * bulanan);
                sisaPinjaman -= (cicilan - bb);
            }
            var lastPokok = Math.max(0, sisaPinjaman);
            var lastBunga = cicilan - lastPokok;
            rows += '<tr><td>' + tenor + '</td><td>Rp ' + formatCurrency(cicilan) + '</td><td>Rp ' + formatCurrency(lastPokok) + '</td><td>Rp ' + formatCurrency(lastBunga) + '</td><td>Rp 0</td></tr>';
        }
        amortBody.innerHTML = rows;
    }

    document.getElementById('sim-cicilan').textContent = 'Rp ' + formatCurrency(cicilan) + ' / bulan';
    document.getElementById('sim-total-bunga').textContent = 'Rp ' + formatCurrency(totalBunga);
    document.getElementById('sim-total-bayar').textContent = 'Rp ' + formatCurrency(totalBayar);
    var rasio = totalBayar > 0 ? Math.round(totalBunga / totalBayar * 100) : 0;
    document.getElementById('sim-rasio').textContent = rasio + '%';

    // Store for later use
    document.getElementById('sim-hasil').dataset.pinjaman = pinjaman;
    document.getElementById('sim-hasil').dataset.bunga = bungaTahunan;
    document.getElementById('sim-hasil').dataset.tenor = tenor;
    document.getElementById('sim-hasil').dataset.cicilan = cicilan;
}

function buatAkunDariSimulasi() {
    var hasil = document.getElementById('sim-hasil');
    var pinjaman = parseInt(hasil.dataset.pinjaman) || 0;
    var bunga = parseFloat(hasil.dataset.bunga) || 0;
    var tenor = parseInt(hasil.dataset.tenor) || 0;
    var cicilan = parseInt(hasil.dataset.cicilan) || 0;

    if (!pinjaman) {
        showToast('Hitung simulasi dulu sebelum membuat akun.');
        return;
    }

    // Navigate to account modal
    document.querySelectorAll('.nav-btn').forEach(function (b) { b.classList.remove('active'); });
    document.querySelector('.nav-btn[data-page="accounts"]').classList.add('active');
    document.querySelectorAll('.page').forEach(function (p) { p.classList.remove('active'); });
    document.getElementById('page-accounts').classList.add('active');
    renderAccountsPage(); renderSubTypeSettings();

    // Open account modal pre-filled with installment data
    openAccountModal(null);
    accTypeInput.value = 'credit';
    populateSubTypeSelect('credit');
    accSubTypeInput.value = 'Cicilan';
    creditFields.style.display = '';
    creditFieldsRevolving.style.display = 'none';
    creditFieldsInstallment.style.display = '';
    var balLabel = document.getElementById('acc-balance').parentElement.querySelector('label');
    if (balLabel) balLabel.textContent = 'Sudah Terbayar (Rp)';
    accTotalLoanInput.value = pinjaman;
    accInterestRateInstInput.value = bunga;
    accTenorMonthsInput.value = tenor;
    accMonthlyInstallmentInput.value = cicilan;
    accBalanceInput.value = '0';
    accStartDateInput.value = new Date().toISOString().slice(0, 10);

    showToast('Isi nama bank/akun lalu simpan.');
}

// === TELEGRAM LINK ===
(function () {
    var btnLink = document.getElementById('btn-telegram-link');
    var codeDisplay = document.getElementById('telegram-code-display');
    var codeText = document.getElementById('telegram-code-text');
    var statusEl = document.getElementById('telegram-link-status');

    if (!btnLink) return;

    // Check if already linked via telegramUsers collection
    // Since client can't read telegramUsers (security rules), we just rely on UI state
    // The user will know if they've linked or not

    btnLink.addEventListener('click', function () {
        if (!uid) {
            showToast('Login dulu sebelum link Telegram.');
            return;
        }

        btnLink.disabled = true;
        btnLink.textContent = 'Membuat kode...';

        var code = Math.floor(100000 + Math.random() * 900000).toString();

        db.collection('telegramLinkCodes').doc(code).set({
            uid: uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
            codeText.textContent = code;
            codeDisplay.style.display = 'block';
            statusEl.textContent = 'Kode siap digunakan';
            btnLink.textContent = 'Generate Ulang';
            btnLink.disabled = false;
        }).catch(function (err) {
            showToast('Gagal: ' + err.message);
            btnLink.textContent = 'Generate Kode Link';
            btnLink.disabled = false;
        });
    });
})();

// === INIT ===
// The auth state observer in auth.js will call initDataListeners when user logs in,
// which triggers initial render via the listener callbacks. No direct renderDashboard() needed.

// Debounced resize for charts
var resizeTimer;
window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
        if (document.getElementById('page-dashboard').classList.contains('active')) {
            renderDashboard();
        }
    }, 250);
});
