import * as admin from 'firebase-admin';
import { sendMessage, escapeHtml, downloadPhotoAsBase64 } from './telegram';
import { callGeminiAPI, buildScanPrompt, buildNaturalLanguagePrompt } from './gemini';

const CATEGORIES = {
  income: ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Hadiah', 'Lainnya'],
  expense: ['Makanan', 'Tagihan', 'Transportasi', 'Belanja', 'Zakat & Donasi', 'Kesehatan', 'Hiburan & Hobi', 'Lainnya']
};

function db() { return admin.firestore(); }

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function getMonthKey(dateStr: string, paydayStart: number): string {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();

  if (paydayStart <= 1) return `${year}-${String(month).padStart(2, '0')}`;

  if (paydayStart <= 15) {
    return day < paydayStart
      ? `${year}-${String(month === 1 ? 12 : month - 1).padStart(2, '0')}`
      : `${year}-${String(month).padStart(2, '0')}`;
  } else {
    return day >= paydayStart
      ? `${year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`
      : `${year}-${String(month).padStart(2, '0')}`;
  }
}

function getMonthLabel(monthKey: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, m] = monthKey.split('-');
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

async function getUid(chatId: number): Promise<string | null> {
  const doc = await db().collection('telegramUsers').doc(chatId.toString()).get();
  return doc.exists ? doc.data()!.uid : null;
}

function validateCategory(cat: string, type: string): string {
  const list = type === 'income' ? CATEGORIES.income : CATEGORIES.expense;
  return list.find(c => c.toLowerCase() === cat.toLowerCase()) || list[list.length - 1];
}

// === SHARED HELPERS ===

interface ParsedTransaction {
  description: string;
  amount: number;
  type: string;
  category: string;
  date: string;
  accountHint: string;
  destAccountHint?: string;
  adminFee?: number;
}

async function normalizeAndCreateTransaction(
  uid: string,
  parsed: ParsedTransaction,
  accounts: Array<{ bankName: string; id: string }>
): Promise<{ desc: string; amount: number; type: string; category: string; date: string; accountName: string }> {
  // Validate & normalize type
  const rawType = parsed.type || '';
  const type = rawType === 'income' ? 'income' : rawType === 'transfer' ? 'transfer' : rawType === 'expense' ? 'expense' : '';
  if (!type) {
    throw new Error('Tipe transaksi tidak valid. Harus "expense", "income", atau "transfer".');
  }
  const cats = type === 'income' ? CATEGORIES.income : CATEGORIES.expense;

  // Validate & normalize fields (mirrors frontend normalizeResult)
  const desc = parsed.description || '';
  const amount = Math.round(Number(parsed.amount)) || 0;
  const category = type === 'transfer' ? '' : cats.includes(parsed.category) ? parsed.category : cats[cats.length - 1];
  const date = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) && !isNaN(new Date(parsed.date).getTime())
    ? parsed.date
    : new Date().toISOString().split('T')[0];

  if (amount <= 0) {
    throw new Error('Jumlah harus lebih dari 0.');
  }

  // Match accountHint to user's accounts (case-insensitive substring)
  let accountId = '';
  let accountName = '';
  if (parsed.accountHint) {
    const hint = parsed.accountHint.toLowerCase();
    const match = accounts.find(a => a.bankName.toLowerCase().includes(hint));
    if (match) {
      accountId = match.id;
      accountName = match.bankName;
    }
  }

  // Handle transfer type
  if (type === 'transfer') {
    // Match destAccountHint
    let destAccountId = '';
    let destAccountName = '';
    if (parsed.destAccountHint) {
      const hint = parsed.destAccountHint.toLowerCase();
      const match = accounts.find(a => a.bankName.toLowerCase().includes(hint));
      if (match) {
        destAccountId = match.id;
        destAccountName = match.bankName;
      }
    }

    if (!accountId || !destAccountId) {
      throw new Error('Transfer butuh akun asal dan akun tujuan. Sebutkan kedua akun, contoh: "transfer 100rb bca ke mandiri".');
    }
    if (accountId === destAccountId) {
      throw new Error('Akun asal dan tujuan tidak boleh sama.');
    }

    await db().collection('users').doc(uid).collection('transactions').add({
      desc: desc,
      amount: amount,
      type: 'transfer',
      category: '',
      date: date,
      accountId: accountId,
      transferToAccountId: destAccountId,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Create admin fee expense if specified
    const fee = Math.round(Number(parsed.adminFee || 0)) || 0;
    if (fee > 0) {
      await db().collection('users').doc(uid).collection('transactions').add({
        desc: 'Biaya Admin: ' + desc,
        amount: fee,
        type: 'expense',
        category: 'Lainnya',
        date: date,
        accountId: accountId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return { desc: accountName + ' → ' + destAccountName, amount, type: 'transfer', category: '', date, accountName: '' };
  }

  await db().collection('users').doc(uid).collection('transactions').add({
    desc: desc,
    amount: amount,
    type: type,
    category: category,
    date: date,
    accountId: accountId,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { desc, amount, type, category, date, accountName };
}

function extractJSON(text: string): any {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('Tidak dapat menemukan JSON dalam response AI.');
}

// === NATURAL LANGUAGE + PHOTO HANDLERS ===

export async function handlePhoto(chatId: number, photoArray: Array<{ file_id: string }>, caption?: string): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  try {
    await sendMessage(chatId, '🔍 Menganalisa foto...');

    // Get largest photo (last in array)
    const photo = photoArray[photoArray.length - 1];

    // Download + convert to base64
    const { base64, mediaType } = await downloadPhotoAsBase64(photo.file_id);

    // Fetch user's accounts for context
    const accSnap = await db().collection('users').doc(uid).collection('accounts').get();
    const accounts: Array<{ bankName: string; id: string }> = [];
    accSnap.forEach(d => {
      const a = d.data();
      accounts.push({ bankName: a.bankName, id: d.id });
    });
    const accountNames = accounts.map(a => a.bankName);

    // Call Gemini — include caption as context if present
    const prompt = buildScanPrompt(accountNames);
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { inlineData: { mimeType: mediaType, data: base64 } },
      { text: prompt }
    ];
    if (caption && caption.trim()) {
      parts.unshift({ text: 'Caption pengguna: ' + caption.trim() + '\n\nGunakan caption ini sebagai petunjuk tambahan untuk deskripsi, jumlah, kategori, dan tipe transaksi.' });
    }
    const text = await callGeminiAPI(parts);

    // Parse + create transaction
    const parsed = extractJSON(text) as ParsedTransaction;
    const result = await normalizeAndCreateTransaction(uid, parsed, accounts);

    let typeLabel: string;
    if (result.type === 'transfer') {
      typeLabel = '🔀 Transfer';
    } else {
      typeLabel = result.type === 'expense' ? '📤 Pengeluaran' : '📥 Pemasukan';
    }
    const accountLine = result.accountName ? `\nAkun: ${escapeHtml(result.accountName)}` : '';
    const categoryLine = result.type === 'transfer' ? '' : `\nKategori: ${escapeHtml(result.category)}`;
    await sendMessage(chatId,
      `✅ <b>${typeLabel} dicatat!</b>\n\n` +
      `Deskripsi: ${escapeHtml(result.desc)}\n` +
      `Jumlah: Rp ${formatCurrency(result.amount)}\n` +
      `Tanggal: ${result.date}` +
      categoryLine +
      accountLine
    );
  } catch (err: any) {
    console.error('handlePhoto error:', err);
    await sendMessage(chatId, '❌ Gagal membaca foto. Pastikan foto struk/nota terlihat jelas. Coba lagi atau gunakan /tambah untuk input manual.');
  }
}

export async function handleFreeText(chatId: number, text: string): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  try {
    await sendMessage(chatId, '🔍 Menganalisa...');

    // Fetch user's accounts
    const accSnap = await db().collection('users').doc(uid).collection('accounts').get();
    const accounts: Array<{ bankName: string; id: string }> = [];
    accSnap.forEach(d => {
      const a = d.data();
      accounts.push({ bankName: a.bankName, id: d.id });
    });

    // Call Gemini with NL prompt
    const prompt = buildNaturalLanguagePrompt(text, accounts, CATEGORIES);
    const responseText = await callGeminiAPI([{ text: prompt }]);

    // Parse + create transaction
    const parsed = extractJSON(responseText) as ParsedTransaction;
    const result = await normalizeAndCreateTransaction(uid, parsed, accounts);

    let typeLabel: string;
    if (result.type === 'transfer') {
      typeLabel = '🔀 Transfer';
    } else {
      typeLabel = result.type === 'expense' ? '📤 Pengeluaran' : '📥 Pemasukan';
    }
    const accountLine = result.accountName ? `\nAkun: ${escapeHtml(result.accountName)}` : '';
    const categoryLine = result.type === 'transfer' ? '' : `\nKategori: ${escapeHtml(result.category)}`;
    await sendMessage(chatId,
      `✅ <b>${typeLabel} dicatat!</b>\n\n` +
      `Deskripsi: ${escapeHtml(result.desc)}\n` +
      `Jumlah: Rp ${formatCurrency(result.amount)}\n` +
      `Tanggal: ${result.date}` +
      categoryLine +
      accountLine
    );
  } catch (err: any) {
    console.error('handleFreeText error:', err);
    await sendMessage(chatId,
      '❌ Tidak bisa memahami teks. Coba format:\n' +
      '<code>[item] [jumlah] [akun]</code>\n\n' +
      'Contoh:\n' +
      '• <code>nasgor goceng cash</code>\n' +
      '• <code>gojek 15rb gopay</code>\n' +
      '• <code>gajian 5jt bca</code>\n\n' +
      'Atau gunakan /tambah untuk input manual.'
    );
  }
}

// === COMMAND HANDLERS ===

export async function handleStart(chatId: number): Promise<void> {
  const msg =
    '<b>🏦 Finance Tracker Bot</b>\n\n' +
    'Bot ini terhubung dengan aplikasi Finance Tracker kamu.\n\n' +
    '<b>Input Langsung (tanpa command):</b>\n' +
    '• Kirim foto struk/nota → otomatis dicatat\n' +
    '• Ketik bebas: <code>nasgor goceng cash</code>\n\n' +
    '<b>Command:</b>\n' +
    '/start - Tampilkan pesan ini\n' +
    '/link &lt;kode&gt; - Hubungkan akun (kode dari web app)\n' +
    '/saldo - Lihat saldo semua akun\n' +
    '/tambah &lt;jml&gt; &lt;kategori&gt; &lt;desc&gt; - Tambah pengeluaran\n' +
    '/pemasukan &lt;jml&gt; &lt;kategori&gt; &lt;desc&gt; - Tambah pemasukan\n' +
    '/bulanini - Ringkasan bulan ini\n' +
    '/statistik - Pie chart pengeluaran per kategori\n' +
    '/banding - Banding bulan ini vs bulan lalu\n' +
    '/akun - Daftar akun\n' +
    '/help - Bantuan';
  await sendMessage(chatId, msg);
}

export async function handleHelp(chatId: number): Promise<void> {
  const msg =
    '<b>📖 Bantuan</b>\n\n' +
    '<b>Input langsung (tanpa command):</b>\n' +
    '• <b>Kirim foto</b> struk/nota → langsung dicatat otomatis\n' +
    '• <b>Ketik bebas:</b> <code>nasgor 15000 cash</code> → input pengeluaran\n' +
    '  Format: [item] [jumlah] [akun]\n' +
    '  Angka slang didukung: goceng=5000, ceban=10000, goban=50000, dll\n\n' +
    '<b>Menambah pengeluaran (command):</b>\n' +
    '<code>/tambah 50000 Makanan Nasi Goreng</code>\n\n' +
    '<b>Menambah pemasukan:</b>\n' +
    '<code>/pemasukan 1000000 Gaji Gaji Bulanan</code>\n\n' +
    '<b>Kategori Pengeluaran:</b> ' + CATEGORIES.expense.join(', ') + '\n\n' +
    '<b>Kategori Pemasukan:</b> ' + CATEGORIES.income.join(', ') + '\n\n' +
    '<b>Command Lainnya:</b>\n' +
    '/statistik - Pie chart pengeluaran per kategori bulan ini\n' +
    '/banding - Banding pemasukan/pengeluaran bulan ini vs bulan lalu\n' +
    '/saldo - Lihat saldo semua akun\n' +
    '/bulanini - Ringkasan keuangan bulan ini\n' +
    '/akun - Daftar akun\n\n' +
    '<b>Format jumlah:</b> Angka bulat tanpa Rp, tanpa titik, tanpa koma.\n' +
    '<b>Format deskripsi:</b> Bebas, maks 5 kata.';
  await sendMessage(chatId, msg);
}

export async function handleLink(chatId: number, code: string): Promise<void> {
  if (!/^\d{6}$/.test(code)) {
    await sendMessage(chatId, '❌ Kode harus 6 digit angka. Contoh: <code>/link 123456</code>');
    return;
  }

  const linkRef = db().collection('telegramLinkCodes').doc(code);
  const linkDoc = await linkRef.get();

  if (!linkDoc.exists) {
    await sendMessage(chatId, '❌ Kode tidak ditemukan. Pastikan kode benar dan belum expired.');
    return;
  }

  const data = linkDoc.data()!;
  const elapsed = Date.now() - data.createdAt.toDate().getTime();

  if (elapsed > 10 * 60 * 1000) {
    await linkRef.delete();
    await sendMessage(chatId, '❌ Kode sudah expired (10 menit). Generate kode baru di aplikasi web.');
    return;
  }

  const uid = data.uid;

  await db().collection('telegramUsers').doc(chatId.toString()).set({
    uid: uid,
    linkedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await linkRef.delete();

  await sendMessage(chatId, '✅ Akun berhasil dihubungkan! Sekarang kamu bisa pakai /saldo, /tambah, /pemasukan, /bulanini, /akun.');
}

export async function handleSaldo(chatId: number): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  const [accSnap, txSnap] = await Promise.all([
    db().collection('users').doc(uid).collection('accounts').get(),
    db().collection('users').doc(uid).collection('transactions').get()
  ]);

  const accounts: Array<{ bankName: string; accountType: string; accountSubType: string; initialBalance: number; currentValue: number | null; id: string }> = [];
  accSnap.forEach(d => {
    const a = d.data();
    accounts.push({ bankName: a.bankName, accountType: a.accountType, accountSubType: a.accountSubType || '', initialBalance: a.initialBalance || 0, currentValue: a.currentValue != null ? a.currentValue : null, id: d.id });
  });

  const txns: Array<{ accountId?: string; transferToAccountId?: string; type: string; amount: number }> = [];
  txSnap.forEach(d => {
    const t = d.data();
    txns.push({ accountId: t.accountId, transferToAccountId: t.transferToAccountId, type: t.type, amount: t.amount });
  });

  let totalBalance = 0;
  const lines: string[] = [];
  const typeLabels: Record<string, string> = { passive: '💳 Pasif', investment: '📈 Investasi' };

  accounts.forEach(a => {
    let balance: number;
    if (a.accountType === 'investment' && a.currentValue != null) {
      balance = a.currentValue;
    } else {
      const net = txns
        .filter(t => t.accountId === a.id || t.transferToAccountId === a.id)
        .reduce((s, t) => {
          if (t.type === 'transfer') {
            if (t.accountId === a.id) return s - t.amount;
            if (t.transferToAccountId === a.id) return s + t.amount;
            return s;
          }
          return s + (t.type === 'income' ? t.amount : -t.amount);
        }, 0);
      balance = a.initialBalance + net;
    }
    totalBalance += balance;
    const typeLabel = typeLabels[a.accountType] || a.accountType;
    lines.push(`• <b>${escapeHtml(a.bankName)}</b> (${typeLabel}): Rp ${formatCurrency(balance)}`);
  });

  const unassignedNet = txns
    .filter(t => !t.accountId)
    .reduce((s, t) => s + (t.type === 'income' ? t.amount : -t.amount), 0);
  if (unassignedNet !== 0) {
    lines.push(`• <b>Tanpa Akun</b>: Rp ${formatCurrency(unassignedNet)}`);
  }
  totalBalance += unassignedNet;

  const header = '<b>💰 Saldo</b>\n\n';
  const body = lines.length ? lines.join('\n') : 'Belum ada akun atau transaksi.';
  const footer = `\n\n<b>Total: Rp ${formatCurrency(totalBalance)}</b>`;

  await sendMessage(chatId, header + body + footer);
}

export async function handleTambah(chatId: number, text: string, type: string): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  const match = text.match(/^\/(?:tambah|pemasukan)\s+(\d+)\s+(\S+)\s+(.+)/);
  if (!match) {
    const cmd = type === 'expense' ? 'tambah' : 'pemasukan';
    const example = type === 'expense' ? '50000 Makanan Nasi Goreng' : '1000000 Gaji Gaji Bulanan';
    await sendMessage(chatId, `❌ Format salah. Contoh: <code>/${cmd} ${example}</code>\n\nGunakan /help untuk info lengkap.`);
    return;
  }

  const amount = parseInt(match[1], 10);
  const category = validateCategory(match[2], type);
  const desc = match[3].trim();

  if (amount <= 0) {
    await sendMessage(chatId, '❌ Jumlah harus lebih dari 0.');
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  await db().collection('users').doc(uid).collection('transactions').add({
    desc: desc,
    amount: amount,
    type: type,
    category: category,
    date: today,
    accountId: '',
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  const typeLabel = type === 'expense' ? 'Pengeluaran' : 'Pemasukan';
  await sendMessage(chatId, `✅ <b>${typeLabel} dicatat!</b>\n\nDeskripsi: ${escapeHtml(desc)}\nJumlah: Rp ${formatCurrency(amount)}\nKategori: ${category}\nTanggal: ${today}`);
}

export async function handleBulanIni(chatId: number): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  const [settingsSnap, txSnap] = await Promise.all([
    db().collection('users').doc(uid).collection('settings').doc('main').get(),
    db().collection('users').doc(uid).collection('transactions').get()
  ]);

  const settings = settingsSnap.exists ? settingsSnap.data()! : { paydayStart: 1 };
  const paydayStart = settings.paydayStart || 1;

  const today = new Date().toISOString().split('T')[0];
  const currentMonth = getMonthKey(today, paydayStart);

  const txns: Array<{ type: string; amount: number; category: string; date: string }> = [];
  txSnap.forEach(d => {
    const t = d.data();
    txns.push({ type: t.type, amount: t.amount, category: t.category, date: t.date });
  });

  const monthTxns = txns.filter(t => getMonthKey(t.date, paydayStart) === currentMonth);

  const incomeTotal = monthTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenseTotal = monthTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const net = incomeTotal - expenseTotal;

  const catMap: Record<string, number> = {};
  monthTxns.filter(t => t.type === 'expense').forEach(t => {
    catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  });
  const catLines = Object.entries(catMap)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `• ${cat}: Rp ${formatCurrency(amt)}`)
    .join('\n');

  const monthLabel = getMonthLabel(currentMonth);
  const netSign = net >= 0 ? '+' : '';

  const msg =
    `<b>📊 Ringkasan ${monthLabel}</b>\n\n` +
    `<b>Pemasukan:</b> Rp ${formatCurrency(incomeTotal)}\n` +
    `<b>Pengeluaran:</b> Rp ${formatCurrency(expenseTotal)}\n` +
    `<b>Net:</b> ${netSign}Rp ${formatCurrency(net)}\n` +
    `<b>Total Transaksi:</b> ${monthTxns.length}` +
    (catLines ? `\n\n<b>Pengeluaran per Kategori:</b>\n${catLines}` : '');

  await sendMessage(chatId, msg);
}

export async function handleStatistik(chatId: number): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  const [settingsSnap, txSnap] = await Promise.all([
    db().collection('users').doc(uid).collection('settings').doc('main').get(),
    db().collection('users').doc(uid).collection('transactions').get()
  ]);

  const settings = settingsSnap.exists ? settingsSnap.data()! : { paydayStart: 1 };
  const paydayStart = settings.paydayStart || 1;

  const today = new Date().toISOString().split('T')[0];
  const currentMonth = getMonthKey(today, paydayStart);

  const txns: Array<{ type: string; amount: number; category: string; date: string }> = [];
  txSnap.forEach(d => {
    const t = d.data();
    txns.push({ type: t.type, amount: t.amount, category: t.category, date: t.date });
  });

  const monthTxns = txns.filter(t => getMonthKey(t.date, paydayStart) === currentMonth);
  const monthExpenses = monthTxns.filter(t => t.type === 'expense');

  if (monthExpenses.length === 0) {
    await sendMessage(chatId, `📊 Tidak ada pengeluaran di ${getMonthLabel(currentMonth)}.`);
    return;
  }

  const totalExpense = monthExpenses.reduce((s, t) => s + t.amount, 0);

  const catMap: Record<string, number> = {};
  monthExpenses.forEach(t => {
    catMap[t.category] = (catMap[t.category] || 0) + t.amount;
  });

  const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const maxWidth = 20;

  const lines = entries.map(([cat, amt]) => {
    const pct = totalExpense > 0 ? (amt / totalExpense) * 100 : 0;
    const barWidth = Math.max(1, Math.round(pct / 100 * maxWidth));
    const bar = '█'.repeat(barWidth) + '░'.repeat(maxWidth - barWidth);
    const amtStr = 'Rp ' + formatCurrency(amt);
    const padAmt = ' '.repeat(Math.max(0, 13 - amtStr.length)) + amtStr;
    const pctStr = '(' + Math.round(pct) + '%)';
    return `• <b>${cat}</b>\n  ${bar} ${padAmt} ${pctStr}`;
  });

  const monthLabel = getMonthLabel(currentMonth);
  const msg =
    `<b>📊 Statistik Pengeluaran ${monthLabel}</b>\n\n` +
    lines.join('\n\n') +
    `\n\n<b>Total: Rp ${formatCurrency(totalExpense)}</b> • ${monthExpenses.length} transaksi`;

  await sendMessage(chatId, msg);
}

export async function handleBanding(chatId: number): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  const [settingsSnap, txSnap] = await Promise.all([
    db().collection('users').doc(uid).collection('settings').doc('main').get(),
    db().collection('users').doc(uid).collection('transactions').get()
  ]);

  const settings = settingsSnap.exists ? settingsSnap.data()! : { paydayStart: 1 };
  const paydayStart = settings.paydayStart || 1;

  const today = new Date().toISOString().split('T')[0];
  const currentMonth = getMonthKey(today, paydayStart);

  // Calculate previous month key
  const [y, m] = currentMonth.split('-').map(Number);
  const prevDate = new Date(y, m - 2, 15);
  const prevMonth = getMonthKey(prevDate.toISOString().split('T')[0], paydayStart);

  const txns: Array<{ type: string; amount: number; category: string; date: string }> = [];
  txSnap.forEach(d => {
    const t = d.data();
    txns.push({ type: t.type, amount: t.amount, category: t.category, date: t.date });
  });

  const curTxns = txns.filter(t => getMonthKey(t.date, paydayStart) === currentMonth);
  const prevTxns = txns.filter(t => getMonthKey(t.date, paydayStart) === prevMonth);

  const curIn = curTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const curOut = curTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const curNet = curIn - curOut;

  const prevIn = prevTxns.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const prevOut = prevTxns.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const prevNet = prevIn - prevOut;

  function delta(cur: number, prev: number): string {
    const diff = cur - prev;
    const sign = diff >= 0 ? '+' : '';
    const pct = prev !== 0 ? Math.round((diff / prev) * 100) : (cur > 0 ? 100 : 0);
    const arrow = diff >= 0 ? '🟢' : '🔴';
    const pctStr = prev !== 0 ? ` (${sign}${pct}%)` : '';
    return `${sign}Rp ${formatCurrency(diff)} ${arrow}${pctStr}`;
  }

  function fmt(n: number): string {
    return 'Rp ' + formatCurrency(n);
  }

  const curLabel = getMonthLabel(currentMonth);
  const prevLabel = getMonthLabel(prevMonth);
  const netSign = curNet >= 0 ? '+' : '';

  // Top category changes
  const curCatMap: Record<string, number> = {};
  const prevCatMap: Record<string, number> = {};
  curTxns.filter(t => t.type === 'expense').forEach(t => {
    curCatMap[t.category] = (curCatMap[t.category] || 0) + t.amount;
  });
  prevTxns.filter(t => t.type === 'expense').forEach(t => {
    prevCatMap[t.category] = (prevCatMap[t.category] || 0) + t.amount;
  });

  const allCats = [...new Set([...Object.keys(curCatMap), ...Object.keys(prevCatMap)])];
  const catChanges = allCats
    .map(cat => ({
      cat,
      cur: curCatMap[cat] || 0,
      prev: prevCatMap[cat] || 0,
      diff: (curCatMap[cat] || 0) - (prevCatMap[cat] || 0)
    }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, 3);

  const catLines = catChanges
    .filter(c => c.cur > 0 || c.prev > 0)
    .map(c => {
      const arrow = c.diff >= 0 ? '🔺' : '🔻';
      const diffStr = (c.diff >= 0 ? '+' : '') + 'Rp ' + formatCurrency(c.diff);
      return `• <b>${c.cat}</b>: Rp ${formatCurrency(c.cur)} (${prevLabel}: Rp ${formatCurrency(c.prev)}, ${diffStr} ${arrow})`;
    });

  const msg =
    `<b>📈 Banding Bulanan</b>\n\n` +
    `<b>${curLabel}</b>  vs  <b>${prevLabel}</b>\n\n` +
    `<code>              ${curLabel.padEnd(10)} ${prevLabel.padEnd(10)} Δ</code>\n` +
    `<code>Pemasukan     ${fmt(curIn).padEnd(10)} ${fmt(prevIn).padEnd(10)} ${delta(curIn, prevIn)}</code>\n` +
    `<code>Pengeluaran   ${fmt(curOut).padEnd(10)} ${fmt(prevOut).padEnd(10)} ${delta(curOut, prevOut)}</code>\n` +
    `<code>Net           ${(netSign + 'Rp ' + formatCurrency(curNet)).padEnd(10)} ${fmt(prevNet).padEnd(10)}</code>\n` +
    `\n<b>💰 Net Bulan Ini: ${netSign}Rp ${formatCurrency(curNet)}</b>` +
    (catLines.length ? `\n\n<b>📊 Perubahan Kategori Terbesar:</b>\n${catLines.join('\n')}` : '') +
    (curTxns.length === 0 && prevTxns.length === 0 ? '\n\nBelum ada transaksi.' : '');

  await sendMessage(chatId, msg);
}

export async function handleAkun(chatId: number): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  const [accSnap, txSnap] = await Promise.all([
    db().collection('users').doc(uid).collection('accounts').get(),
    db().collection('users').doc(uid).collection('transactions').get()
  ]);

  if (accSnap.empty) {
    await sendMessage(chatId, '📭 Belum ada akun. Tambahkan akun dulu di aplikasi web.');
    return;
  }

  const txns: Array<{ accountId?: string; transferToAccountId?: string; type: string; amount: number }> = [];
  txSnap.forEach(d => {
    const t = d.data();
    txns.push({ accountId: t.accountId, transferToAccountId: t.transferToAccountId, type: t.type, amount: t.amount });
  });

  const typeLabels: Record<string, string> = { passive: '💳 Pasif', investment: '📈 Investasi' };
  const lines: string[] = [];

  accSnap.forEach(d => {
    const a = d.data();
    const accountType = a.accountType || 'passive';
    let balance: number;
    if (accountType === 'investment' && a.currentValue != null) {
      balance = a.currentValue;
    } else {
      const net = txns
        .filter(t => t.accountId === d.id || t.transferToAccountId === d.id)
        .reduce((s, t) => {
          if (t.type === 'transfer') {
            if (t.accountId === d.id) return s - t.amount;
            if (t.transferToAccountId === d.id) return s + t.amount;
            return s;
          }
          return s + (t.type === 'income' ? t.amount : -t.amount);
        }, 0);
      balance = (a.initialBalance || 0) + net;
    }
    const typeLabel = typeLabels[accountType] || accountType;
    const subTypeLine = a.accountSubType ? ` (${a.accountSubType})` : '';
    lines.push(`• <b>${escapeHtml(a.bankName)}</b> ${typeLabel}${subTypeLine}\n  Saldo: Rp ${formatCurrency(balance)}\n  Saldo Awal: Rp ${formatCurrency(a.initialBalance || 0)}`);
  });

  await sendMessage(chatId, '<b>🏦 Daftar Akun</b>\n\n' + lines.join('\n\n'));
}

export async function handleTransfer(chatId: number, text: string): Promise<void> {
  const uid = await getUid(chatId);
  if (!uid) { await sendMessage(chatId, '⚠️ Akun belum dihubungkan. Gunakan /link &lt;kode&gt; dulu.'); return; }

  // Parse: /transfer [jumlah] [akun_asal] ke [akun_tujuan] [deskripsi]
  const body = text.replace(/^\/transfer\s+/, '');
  if (!body) {
    await sendMessage(chatId,
      '❌ Format: <code>/transfer [jumlah] [akun_asal] ke [akun_tujuan] [deskripsi]</code>\n\n' +
      'Contoh:\n' +
      '• <code>/transfer 100000 bca ke mandiri tabungan</code>\n' +
      '• <code>/transfer 50k gopay ke ovo</code>'
    );
    return;
  }

  // Split by " ke " first
  const keIdx = body.search(/\s+ke\s+/i);
  if (keIdx === -1) {
    await sendMessage(chatId, '❌ Format salah. Gunakan "ke" untuk memisahkan akun asal dan tujuan.\nContoh: <code>/transfer 100000 bca ke mandiri</code>');
    return;
  }

  const beforeKe = body.substring(0, keIdx).trim();
  const afterKe = body.substring(keIdx).replace(/^ke\s+/i, '').trim();

  // Parse beforeKe: [jumlah] [akun_asal]
  const beforeParts = beforeKe.split(/\s+/);
  if (beforeParts.length < 2) {
    await sendMessage(chatId, '❌ Format: <code>/transfer [jumlah] [akun_asal] ke [akun_tujuan]</code>');
    return;
  }

  // Parse amount (supports slang: 5rb, 50k, 5jt, goban, etc.)
  const amountStr = beforeParts[0].toLowerCase();
  let amount = 0;
  if (/^\d+$/.test(amountStr)) {
    amount = parseInt(amountStr, 10);
  } else {
    // Slang parsing
    const slang: Record<string, number> = {
      goceng: 5000, goban: 50000, ceban: 10000, ceceng: 100000,
      gopek: 500, seceng: 1000, noceng: 2000, saceng: 3000
    };
    if (slang[amountStr]) {
      amount = slang[amountStr];
    } else {
      const match = amountStr.match(/^(\d+(?:\.?\d+)?)\s*(rb|k|jt|m|juta)?$/);
      if (match) {
        amount = parseFloat(match[1]) || 0;
        if (match[2]) {
          if (match[2] === 'jt' || match[2] === 'juta' || match[2] === 'm') amount *= 1000000;
          else amount *= 1000;
        }
      }
    }
  }

  if (amount <= 0) {
    await sendMessage(chatId, '❌ Jumlah tidak valid. Contoh: <code>/transfer 100000 bca ke mandiri</code>');
    return;
  }

  const srcHint = beforeParts.slice(1).join(' ').toLowerCase();

  // Parse afterKe: [akun_tujuan] [deskripsi?]
  const afterParts = afterKe.split(/\s+/);
  const dstHint = afterParts[0].toLowerCase();
  const desc = afterParts.slice(1).join(' ') || 'Transfer';

  // Fetch accounts
  const accSnap = await db().collection('users').doc(uid).collection('accounts').get();
  const accounts: Array<{ bankName: string; id: string }> = [];
  accSnap.forEach(d => {
    const a = d.data();
    accounts.push({ bankName: a.bankName, id: d.id });
  });

  if (accounts.length < 2) {
    await sendMessage(chatId, '❌ Butuh minimal 2 akun untuk transfer. Tambahkan akun dulu di aplikasi web.');
    return;
  }

  // Match source account
  const srcAccount = accounts.find(a => a.bankName.toLowerCase().includes(srcHint));
  if (!srcAccount) {
    await sendMessage(chatId, `❌ Akun asal "${beforeParts.slice(1).join(' ')}" tidak ditemukan.\nAkun tersedia: ${accounts.map(a => a.bankName).join(', ')}`);
    return;
  }

  // Match dest account
  const dstAccount = accounts.find(a => a.bankName.toLowerCase().includes(dstHint));
  if (!dstAccount) {
    await sendMessage(chatId, `❌ Akun tujuan "${afterParts[0]}" tidak ditemukan.\nAkun tersedia: ${accounts.map(a => a.bankName).join(', ')}`);
    return;
  }

  if (srcAccount.id === dstAccount.id) {
    await sendMessage(chatId, '❌ Akun asal dan tujuan tidak boleh sama.');
    return;
  }

  const today = new Date().toISOString().split('T')[0];

  await db().collection('users').doc(uid).collection('transactions').add({
    desc: desc,
    amount: amount,
    type: 'transfer',
    category: '',
    date: today,
    accountId: srcAccount.id,
    transferToAccountId: dstAccount.id,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await sendMessage(chatId,
    `<b>🔀 Transfer dicatat!</b>\n\n` +
    `Dari: ${escapeHtml(srcAccount.bankName)}\n` +
    `Ke: ${escapeHtml(dstAccount.bankName)}\n` +
    `Jumlah: Rp ${formatCurrency(amount)}\n` +
    `Deskripsi: ${escapeHtml(desc)}\n` +
    `Tanggal: ${today}`
  );
}
