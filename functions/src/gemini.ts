import * as functions from 'firebase-functions';

// Shared interface for Gemini API parts
interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

// Reusable Gemini API call — used by onCall (auth-gated) and bot handlers (Admin SDK)
export async function callGeminiAPI(parts: Part[]): Promise<string> {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured');
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }]
      })
    }
  );

  if (!response.ok) {
    const err: any = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error: ${response.status}`);
  }

  const result: any = await response.json();
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// Auth-gated callable for frontend receipt scanning
export const callGemini = functions
  .runWith({ secrets: ['GEMINI_API_KEY'] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Login required');
    }

    const { base64, mediaType } = data;
    if (!base64 || !mediaType) {
      throw new functions.https.HttpsError('invalid-argument', 'base64 and mediaType required');
    }

    try {
      const text = await callGeminiAPI([
        { inlineData: { mimeType: mediaType, data: base64 } },
        { text: buildScanPrompt([]) }
      ]);
      return { text };
    } catch (err: any) {
      throw new functions.https.HttpsError('internal', err.message || 'Gemini API error');
    }
  });

export function buildScanPrompt(accountNames: string[]): string {
  const accountList = accountNames.length > 0
    ? accountNames.map(n => `"${n}"`).join(', ')
    : '(belum ada akun)';

  return 'Anda adalah parser data transaksi keuangan Indonesia. Tugas Anda: membaca gambar struk/nota/screenshot transaksi dan mengembalikan JSON yang akurat.\n\nSEBELUM menulis JSON, pikirkan dulu:\n1. Transaksi ini untuk apa sebenarnya? (bukan apa yang tertulis literal di struk)\n2. Kategori apa yang paling tepat berdasarkan TUJUAN transaksi?\n\nKategori Pengeluaran (expense):\n- Makanan: restoran, warteg, delivery food (GoFood/GrabFood), kopi, catering, jajanan\n- Tagihan: listrik (PLN), air (PDAM), internet, pulsa/paket data, sewa, iuran, cicilan\n- Transportasi: ojek online (Gojek/Grab), taksi, bus, KRL, MRT, BBM, tol, parkir, top-up e-toll, servis kendaraan\n- Belanja: retail (Indomaret/Alfamart/Superindo), online shopping (Shopee/Tokopedia), fashion, elektronik, perlengkapan rumah\n- Zakat & Donasi: zakat, infak, sedekah, sumbangan, donasi sosial\n- Kesehatan: dokter, rumah sakit, obat/apotek, BPJS/asuransi kesehatan, optik\n- Hiburan & Hobi: bioskop, streaming (Netflix/Spotify), game, konser, wisata, hobi, langganan digital\n- Lainnya: hanya jika benar-benar tidak cocok dengan kategori di atas\n\nKategori Pemasukan (income):\n- Gaji: gaji bulanan, THR, bonus dari kantor\n- Freelance: proyek lepas, upah harian, komisi\n- Investasi: dividen, return saham/reksadana, capital gain\n- Bisnis: hasil jualan, pendapatan usaha\n- Hadiah: uang pemberian, hadiah lomba\n- Lainnya: pemasukan yang tidak masuk kategori di atas\n\nAturan description:\n- Normalisasi deskripsi, jangan salin mentah teks dari gambar\n- Buang kata status: "berhasil", "sukses", "successful", "transaction approved"\n- Standarisasi istilah: "top up"/"topup"/"isi ulang" → "Isi Ulang"\n- Format: [Jenis Transaksi] [Nama Merchant/Layanan] (maks 5 kata, bahasa Indonesia)\n\nAturan amount:\n- Angka saja, tanpa Rp, tanpa titik, tanpa koma (contoh: 50000 bukan "Rp 50.000")\n- Jika terdeteksi refund/pengembalian, tetap tulis nominal positif, sesuaikan type\n\nAturan date:\n- Format YYYY-MM-DD, ambil dari tanggal transaksi di gambar\n- Jika tidak ada tanggal, gunakan hari ini\n\nAturan accountHint:\n- Tulis nama bank/e-wallet yang terlihat di gambar (contoh: "BCA", "GoPay", "OVO", "ShopeePay")\n- Akun pengguna yang tersedia: ' + accountList + '\n- Jika tidak jelas, kosongkan string\n\nContoh parsing yang benar:\n\n1. Screenshot top-up Flazz Rp 100.000 lewat BCA Mobile\n→ {"description": "Isi Ulang Flazz", "amount": 100000, "type": "expense", "category": "Transportasi", "date": "2026-05-24", "accountHint": "BCA"}\n\n2. Nota GoFood dari resto Sate Taichan Rp 45.000\n→ {"description": "GoFood Sate Taichan", "amount": 45000, "type": "expense", "category": "Makanan", "date": "2026-05-24", "accountHint": "GoPay"}\n\n3. Slip gaji diterima Rp 8.500.000 transfer dari perusahaan\n→ {"description": "Gaji Bulanan", "amount": 8500000, "type": "income", "category": "Gaji", "date": "2026-05-24", "accountHint": "BCA"}\n\n4. Struk SPBU Pertamina isi bensin Rp 200.000\n→ {"description": "BBM Pertamina", "amount": 200000, "type": "expense", "category": "Transportasi", "date": "2026-05-24", "accountHint": ""}\n\nTransfer detection dari caption:\n- Jika caption pengguna menyebutkan transfer/pindah dana (contoh: "transfer dana bca ke mandiri", "pindahin gopay ke ovo"):\n  - type = "transfer"\n  - accountHint = akun asal\n  - destAccountHint = akun tujuan\n  - category = ""\n  - adminFee = biaya admin jika disebutkan, 0 jika tidak\n  - JANGAN gunakan akun yang sama untuk asal dan tujuan\n\nKembalikan HANYA JSON valid tanpa teks pembuka, penutup, atau markdown:\n{\n  "description": "...",\n  "amount": ...,\n  "type": "...",\n  "category": "...",\n  "date": "YYYY-MM-DD",\n  "accountHint": "...",\n  "destAccountHint": "...",\n  "adminFee": 0\n}';
}

export function buildNaturalLanguagePrompt(
  userText: string,
  accounts: Array<{ bankName: string; id: string }>,
  categories: { income: string[]; expense: string[] }
): string {
  const accountList = accounts.length > 0
    ? accounts.map(a => `"${a.bankName}"`).join(', ')
    : '(belum ada akun)';

  const today = new Date().toISOString().split('T')[0];

  return 'Anda adalah parser input transaksi keuangan bahasa Indonesia. Tugas Anda: mengubah teks bebas dari pengguna menjadi data transaksi terstruktur.\n\n' +
    'TEKS DARI PENGGUNA:\n"' + userText + '"\n\n' +
    'TANGGAL HARI INI: ' + today + '\n\n' +
    'DAFTAR AKUN PENGGUNA: ' + accountList + '\n\n' +
    'KATEGORI PENGELUARAN:\n' + categories.expense.map(c => `- ${c}`).join('\n') + '\n\n' +
    'KATEGORI PEMASUKAN:\n' + categories.income.map(c => `- ${c}`).join('\n') + '\n\n' +
    'ATURAN PARSING:\n\n' +
    '1. ANGKA SLANG INDONESIA (wajib dikonversi):\n' +
    '   - "goceng" = 5000, "goban" = 50000, "ceban" = 10000, "ceceng" = 100000\n' +
    '   - "gopek" = 500, "seceng" = 1000, "noceng" = 2000, "saceng" = 3000\n' +
    '   - "ceng" = 1000 (jika berdiri sendiri setelah angka: "dua ceng" = 2000)\n' +
    '   - Angka eksplisit: "5rb"/"5k" = 5000, "5jt" = 5000000, "5.000" = 5000, "5000" = 5000\n' +
    '   - "15rb" = 15000, "2.5jt" = 2500000, "100k" = 100000\n' +
    '   - Jika tidak ada angka sama sekali → amount = 0 (akan ditolak)\n\n' +
    '2. DESKRIPSI:\n' +
    '   - Normalisasi singkatan: "nasgor"→"Nasi Goreng", "aygor"→"Ayam Goreng", "es"→"Es", "kopi"→"Kopi"\n' +
    '   - "indomie"/"mie"→"Indomie", "batagor"→"Batagor", "martabak"→"Martabak"\n' +
    '   - Jadikan deskripsi natural bahasa Indonesia yang terbaca (maks 5 kata)\n' +
    '   - Jangan masukkan nominal atau nama akun ke deskripsi\n\n' +
    '3. KATEGORI:\n' +
    '   - Cocokkan isi deskripsi dengan kategori yang paling sesuai\n' +
    '   - Makanan/minuman/restoran/warung → Makanan\n' +
    '   - Transportasi/ojek/bensin/BBM/tol/parkir → Transportasi\n' +
    '   - Belanja/barang → Belanja\n' +
    '   - Zakat/infak/sedekah/sumbangan → Zakat & Donasi\n' +
    '   - Hiburan/hobi/streaming/game → Hiburan & Hobi\n' +
    '   - Jika ragu, gunakan "Lainnya"\n\n' +
    '4. TIPE:\n' +
    '   - DEFAULT: "expense" (pengeluaran) — karena kebanyakan input adalah pengeluaran\n' +
    '   - "income" HANYA jika ada kata kunci pemasukan: gaji, gajian, dapet duit, dapet transfer, terima, pemasukan, masuk duit, dapat, hadiah, bonus, THR, freelance\n' +
    '   - "transfer" jika pengguna ingin memindahkan uang antar akun sendiri. Kata kunci: transfer, pindahin, pindahan, kirim dana, pindah saldo, pindahin dana, geser dana\n\n' +
    '   Jika type = "transfer":\n' +
    '   - accountHint = akun ASAL (sumber dana dipindahkan)\n' +
    '   - destAccountHint = akun TUJUAN (dana diterima)\n' +
    '   - category = "" (string kosong, transfer tidak punya kategori)\n' +
    '   - adminFee = biaya admin (angka saja, 0 jika tidak disebutkan)\n' +
    '   - Transfer TIDAK BOLEH menggunakan akun yang sama untuk asal dan tujuan\n\n' +
    '5. AKUN:\n' +
    '   - accountHint: cocokkan dengan daftar akun di atas (case-insensitive, substring)\n' +
    '   - "cash"/"tunai"→akun yang mengandung "cash", "bca"→akun yang mengandung "BCA", dll\n' +
    '   - Untuk transfer: accountHint = akun asal, destAccountHint = akun tujuan\n' +
    '   - Jika tidak ada penyebutan akun sama sekali → string kosong ""\n\n' +
    '6. TANGGAL:\n' +
    '   - Selalu gunakan tanggal hari ini: ' + today + '\n' +
    '   - Format: YYYY-MM-DD\n\n' +
    'Kembalikan HANYA JSON valid tanpa teks pembuka, penutup, atau markdown:\n' +
    '{\n' +
    '  "description": "Deskripsi yang sudah dinormalisasi",\n' +
    '  "amount": 5000,\n' +
    '  "type": "expense",\n' +
    '  "category": "Makanan",\n' +
    '  "date": "' + today + '",\n' +
    '  "accountHint": "Cash",\n' +
    '  "destAccountHint": "",\n' +
    '  "adminFee": 0\n' +
    '}\n\n' +
    'CATATAN:\n' +
    '- destAccountHint dan adminFee hanya diisi jika type = "transfer"\n' +
    '- Untuk type "expense" dan "income", isi destAccountHint = "" dan adminFee = 0\n\n' +
    'CONTOH PARSING YANG BENAR:\n\n' +
    'Input: "nasgor goceng cash"\n' +
    '→ {"description": "Nasi Goreng", "amount": 5000, "type": "expense", "category": "Makanan", "date": "' + today + '", "accountHint": "Cash", "destAccountHint": "", "adminFee": 0}\n\n' +
    'Input: "gajian 5jt bca"\n' +
    '→ {"description": "Gaji Bulanan", "amount": 5000000, "type": "income", "category": "Gaji", "date": "' + today + '", "accountHint": "BCA", "destAccountHint": "", "adminFee": 0}\n\n' +
    'Input: "gojek 15rb gopay"\n' +
    '→ {"description": "Gojek", "amount": 15000, "type": "expense", "category": "Transportasi", "date": "' + today + '", "accountHint": "GoPay", "destAccountHint": "", "adminFee": 0}\n\n' +
    'Input: "beli pulsa 50k"\n' +
    '→ {"description": "Beli Pulsa", "amount": 50000, "type": "expense", "category": "Tagihan", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0}\n\n' +
    'Input: "dapet transfer 100rb mandiri"\n' +
    '→ {"description": "Transfer Diterima", "amount": 100000, "type": "income", "category": "Lainnya", "date": "' + today + '", "accountHint": "Mandiri", "destAccountHint": "", "adminFee": 0}\n\n' +
    'Input: "transfer 100rb bca ke mandiri tabungan"\n' +
    '→ {"description": "Tabungan", "amount": 100000, "type": "transfer", "category": "", "date": "' + today + '", "accountHint": "BCA", "destAccountHint": "Mandiri", "adminFee": 0}\n\n' +
    'Input: "pindahin 50k dari gopay ke bca"\n' +
    '→ {"description": "Pindah Saldo", "amount": 50000, "type": "transfer", "category": "", "date": "' + today + '", "accountHint": "GoPay", "destAccountHint": "BCA", "adminFee": 0}\n\n' +
    'Input: "kirim dana 500rb mandiri ke bca admin 2500"\n' +
    '→ {"description": "Kirim Dana", "amount": 500000, "type": "transfer", "category": "", "date": "' + today + '", "accountHint": "Mandiri", "destAccountHint": "BCA", "adminFee": 2500}';
}
