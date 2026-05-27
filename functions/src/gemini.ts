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

  // Check for safety filter blocking the prompt itself
  if (result.promptFeedback?.blockReason) {
    throw new Error('Foto tidak dapat diproses (filter: ' + result.promptFeedback.blockReason + '). Coba foto lain.');
  }

  const candidate = result.candidates?.[0];
  if (!candidate) {
    throw new Error('Tidak ada respons dari AI. Kemungkinan foto tidak terbaca atau terblokir filter.');
  }

  // Check for safety filter blocking the response
  if (candidate.finishReason === 'SAFETY') {
    throw new Error('Foto tidak dapat diproses (safety filter). Coba foto lain.');
  }

  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('AI tidak menghasilkan teks. Kemungkinan foto tidak dapat dibaca. Pastikan foto jelas dan mengandung teks transaksi.');
  }

  return text;
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

  return 'Anda adalah parser data transaksi keuangan Indonesia. Tugas Anda: membaca gambar struk/nota/screenshot transaksi dan mengembalikan JSON yang akurat.\n\nSEBELUM menulis JSON, pikirkan dulu:\n1. Transaksi ini untuk apa sebenarnya? (bukan apa yang tertulis literal di struk)\n2. Kategori apa yang paling tepat berdasarkan TUJUAN transaksi?\n\nKategori Pengeluaran (expense):\n- Makanan: restoran, warteg, delivery food (GoFood/GrabFood), kopi, catering, jajanan\n- Tagihan: listrik (PLN), air (PDAM), internet, pulsa/paket data, sewa, iuran, cicilan\n- Transportasi: ojek online (Gojek/Grab), taksi, bus, KRL, MRT, BBM, tol, parkir, top-up e-toll, servis kendaraan\n- Belanja: retail (Indomaret/Alfamart/Superindo), online shopping (Shopee/Tokopedia), fashion, elektronik, perlengkapan rumah\n- Zakat & Donasi: zakat, infak, sedekah, sumbangan, donasi sosial\n- Kesehatan: dokter, rumah sakit, obat/apotek, BPJS/asuransi kesehatan, optik\n- Hiburan & Hobi: bioskop, streaming (Netflix/Spotify), game, konser, wisata, hobi, langganan digital\n- Lainnya: hanya jika benar-benar tidak cocok dengan kategori di atas\n\nKategori Pemasukan (income):\n- Gaji: gaji bulanan, THR, bonus dari kantor\n- Freelance: proyek lepas, upah harian, komisi\n- Investasi: dividen, return saham/reksadana, capital gain\n- Bisnis: hasil jualan, pendapatan usaha\n- Hadiah: uang pemberian, hadiah lomba\n- Lainnya: pemasukan yang tidak masuk kategori di atas\n\nAturan description:\n- Normalisasi deskripsi, jangan salin mentah teks dari gambar\n- Buang kata status: "berhasil", "sukses", "successful", "transaction approved"\n- Standarisasi istilah: "top up"/"topup"/"isi ulang" → "Isi Ulang"\n- Format: [Jenis Transaksi] [Nama Merchant/Layanan] (maks 5 kata, bahasa Indonesia)\n\nAturan amount:\n- Angka saja, tanpa Rp, tanpa titik, tanpa koma (contoh: 50000 bukan "Rp 50.000")\n- Jika terdeteksi refund/pengembalian, tetap tulis nominal positif, sesuaikan type\n\nAturan date:\n- Format YYYY-MM-DD, ambil dari tanggal transaksi di gambar\n- Jika tidak ada tanggal, gunakan hari ini\n\nAturan accountHint:\n- Tulis nama bank/e-wallet yang terlihat di gambar (contoh: "BCA", "GoPay", "OVO", "ShopeePay")\n- Akun pengguna yang tersedia: ' + accountList + '\n- Jika tidak jelas, kosongkan string\n\nContoh parsing yang benar:\n\n1. Screenshot top-up Flazz Rp 100.000 lewat BCA Mobile\n→ {"description": "Isi Ulang Flazz", "amount": 100000, "type": "expense", "category": "Transportasi", "date": "2026-05-24", "accountHint": "BCA"}\n\n2. Nota GoFood dari resto Sate Taichan Rp 45.000\n→ {"description": "GoFood Sate Taichan", "amount": 45000, "type": "expense", "category": "Makanan", "date": "2026-05-24", "accountHint": "GoPay"}\n\n3. Slip gaji diterima Rp 8.500.000 transfer dari perusahaan\n→ {"description": "Gaji Bulanan", "amount": 8500000, "type": "income", "category": "Gaji", "date": "2026-05-24", "accountHint": "BCA"}\n\n4. Struk SPBU Pertamina isi bensin Rp 200.000\n→ {"description": "BBM Pertamina", "amount": 200000, "type": "expense", "category": "Transportasi", "date": "2026-05-24", "accountHint": ""}\n\nPRIORITAS CAPTION:\n- Caption pengguna adalah SUMBER UTAMA untuk deskripsi, kategori, dan tipe transaksi.\n- Gambar hanya digunakan untuk mengkonfirmasi nominal dan akun.\n- Jika caption bilang "gojek makanan", "beli pulsa", dll — type HARUS expense meskipun gambar seperti transfer.\n- Jika caption bilang "transfer dana" atau "pindahin" — type baru transfer.\n\nTransfer detection dari caption:\n- Jika caption pengguna menyebutkan transfer/pindah dana (contoh: "transfer dana bca ke mandiri", "pindahin gopay ke ovo"):\n  - type = "transfer"\n  - accountHint = akun asal\n  - destAccountHint = akun tujuan\n  - category = ""\n  - adminFee = biaya admin jika disebutkan (BERLAKU UNTUK SEMUA TIPE TRANSAKSI, bukan cuma transfer). Jika gambar/caption ada "biaya admin 1000", "admin 1k", "fee 1rb" → set adminFee ke nominal itu, 0 jika tidak ada\n  - JANGAN gunakan akun yang sama untuk asal dan tujuan\n\nHutang/Piutang detection dari caption:\n- Jika caption menyebutkan orang lain yang TERLIBAT dalam transaksi, deteksi sebagai hutang atau piutang:\n- HUTANG (kamu yang berutang ke orang lain — orang lain yang bayarin duluan):\n  - Kata kunci: "dibeliin", "ditraktir", "nitip", "ditalangin", "utang", "ngutang", "hutang", "minjem duit", "pinjem dulu", "dibayarin dulu"\n  - Contoh caption: "nitip abang beliin susu di alfamart" + struk Alfamart → debtType: "hutang", debtPerson: "abang"\n- PIUTANG (orang lain berutang ke kamu — kamu yang bayarin duluan):\n  - Kata kunci: "bayarin", "nraktir", "talangin", "utangin", "ngutangin", "minjemin", "pinjemin", "gue bayarin", "aku bayarin"\n  - Contoh caption: "bayarin temen makan" + struk restoran → debtType: "piutang", debtPerson: "temen"\n- Jika caption ADA kata kunci hutang/piutang:\n  - Isi debtType: "hutang" atau "piutang"\n  - Isi debtPerson: nama orang yang terlibat (tanpa gelar/sebutan, satu kata)\n  - type tetap "expense" (karena duit tetap keluar dari akun)\n- Jika TIDAK ADA kata kunci hutang/piutang → debtType: "", debtPerson: ""\n\nSplit Bill (Patungan) detection dari caption:\n- Jika caption menyebutkan patungan/split bill:\n  - Kata kunci: "patungan", "split bill", "split", "bareng", "bagi rata", "iuran", "urunan"\n  - Equal mode (rata): "patungan nasgor 4 orang 100rb" → splitBill: { mode: "equal", totalPeople: 4 }\n  - Custom mode (beda nominal): "split bill bakso andi 30k budi 25k" → splitBill: { mode: "custom", participants: [{ person: "andi", amount: 30000 }, { person: "budi", amount: 25000 }] }\n  - amount di JSON tetap total amount, bukan user share\n  - Item-based (orang + item, harga dari daftar):\n    Contoh: "cheeseburger 30k cola 10k sundae 15k, gw cheeseburger falah cola falih sundae"\n    → splitBill: { mode: "custom", participants: [{ person: "falah", amount: 10000 }, { person: "falih", amount: 15000 }] }\n    Contoh lain: "gw cheeseburger 30k, falah cola 10k, falih sundae 15k"\n    → splitBill: { mode: "custom", participants: [{ person: "falah", amount: 10000 }, { person: "falih", amount: 15000 }] }\n- Jika TIDAK ADA kata kunci split bill → "splitBill": null\n\nPENTING: splitBill dan debtType/debtPerson bersifat MUTUALLY EXCLUSIVE. Jika split bill terdeteksi, set debtType = "" dan debtPerson = "". Jika hutang/piutang terdeteksi, set splitBill = null.\n\nKembalikan HANYA JSON valid tanpa teks pembuka, penutup, atau markdown:\n{\n  "description": "...",\n  "amount": ...,\n  "type": "...",\n  "category": "...",\n  "date": "YYYY-MM-DD",\n  "accountHint": "...",\n  "destAccountHint": "...",\n  "adminFee": 0,\n  "debtType": "",\n  "debtPerson": "",\n  "splitBill": null\n}';
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
    '4b-bis. SPLIT BILL / PATUNGAN:\n' +
    '   Deteksi jika transaksi adalah patungan/split bill (kamu bayarin grup, temen ganti ke kamu):\n' +
    '   - Kata kunci: "patungan", "split bill", "split", "bareng", "bagi rata", "iuran", "urunan"\n' +
    '   - EQUAL (rata, semua orang bayar jumlah sama):\n' +
    '     Contoh: "patungan nasgor 4 orang 100rb" → total 4 orang (termasuk kamu), masing-masing 25rb\n' +
    '     splitBill: { mode: "equal", totalPeople: 4 }\n' +
    '   - CUSTOM (beda nominal per orang):\n' +
    '     Contoh: "split bill bakso andi 30k budi 25k" → andi dan budi temen kamu\n' +
    '     splitBill: { mode: "custom", participants: [{ person: "andi", amount: 30000 }, { person: "budi", amount: 25000 }] }\n' +
    '   - ITEM-BASED (setiap orang pesan item berbeda, harga dihitung dari daftar item):\n' +
    '     Kata kunci: pola "[orang] [item]" dimana harga item disebutkan terpisah\n' +
    '     Contoh: "cheeseburger 30k cola 10k sundae 15k, gw cheeseburger falah cola falih sundae"\n' +
    '     → falah = cola 10k, falih = sundae 15k, user = cheeseburger 30k, total = 55k\n' +
    '     splitBill: { mode: "custom", participants: [{ person: "falah", amount: 10000 }, { person: "falih", amount: 15000 }] }\n' +
    '     Contoh lain: "gw cheeseburger 30k, falah cola 10k, falih sundae 15k"\n' +
    '     → splitBill: { mode: "custom", participants: [{ person: "falah", amount: 10000 }, { person: "falih", amount: 15000 }] }\n' +
    '   - amount di JSON = TOTAL yang kamu bayarkan (bukan user share)\n' +
    '   - expense yang dicatat = user share saja (total - temen share), piutang temen otomatis dibuat\n' +
    '   - Jika TIDAK terdeteksi split bill → "splitBill": null\n\n' +
    '4b. HUTANG / PIUTANG:\n' +
    '   Deteksi jika transaksi melibatkan ORANG LAIN (bukan transfer antar akun sendiri):\n' +
    '   - HUTANG (kamu yang berutang ke orang lain — orang lain yang bayarin duluan):\n' +
    '     Kata kunci: "dibeliin", "ditraktir", "nitip", "ditalangin", "dibayarin dulu",\n' +
    '     "utang", "ngutang", "hutang", "minjem duit", "pinjem dulu", "beliin"\n' +
    '     Contoh: "nitip abang beliin susu di alfamart 50rb" → hutang ke abang\n' +
    '   - PIUTANG (orang lain berutang ke kamu — kamu yang bayarin duluan):\n' +
    '     Kata kunci: "bayarin", "nraktir", "talangin", "utangin", "ngutangin",\n' +
    '     "minjemin", "pinjemin", "gue bayarin", "aku bayarin"\n' +
    '     Contoh: "bayarin temen makan 100rb" → piutang ke temen\n' +
    '   - Jika terdeteksi hutang/piutang:\n' +
    '     debtType = "hutang" atau "piutang"\n' +
    '     debtPerson = nama orang yang terlibat (tanpa gelar/sebutan, satu kata)\n' +
    '     type = "expense" (karena duit tetap keluar dari akun)\n' +
    '   - Jika TIDAK terdeteksi hutang/piutang → debtType = "", debtPerson = ""\n\n' +
    '5. AKUN:\n' +
    '   - accountHint: cocokkan dengan daftar akun di atas (case-insensitive, substring)\n' +
    '   - "cash"/"tunai"→akun yang mengandung "cash", "bca"→akun yang mengandung "BCA", dll\n' +
    '   - Untuk transfer: accountHint = akun asal, destAccountHint = akun tujuan\n' +
    '   - Jika tidak ada penyebutan akun sama sekali → string kosong ""\n\n' +
    '5b. AKUN KREDIT (Kartu Kredit, PayLater, Cicilan, KPR):\n' +
    '   - Beberapa akun pengguna bertipe KREDIT. Akun kredit adalah utang/kewajiban.\n' +
    '   - Kata kunci PEMBAYARAN KREDIT: "bayar CC", "bayar kartu kredit", "bayar paylater",\n' +
    '     "bayar cicilan", "cicilan", "nyicil", "bayar KPR", "bayar kendaraan"\n' +
    '   - Jika terdeteksi "bayar [akun kredit]" → TRANSFER dari akun pasif ke akun kredit.\n' +
    '     accountHint = akun pasif (asal dana), destAccountHint = akun kredit (tujuan)\n' +
    '     Contoh: "bayar kartu kredit BCA 500rb dari Mandiri"\n' +
    '     → type: "transfer", accountHint: "Mandiri", destAccountHint: "BCA", amount: 500000\n' +
    '   - Jika pengeluaran dengan kartu kredit (bukan pembayaran):\n' +
    '     Contoh: "beli sepatu 200rb pake kartu kredit BCA" → type: "expense", accountHint: "BCA"\n\n' +
    '6. TANGGAL:\n' +
    '   - Selalu gunakan tanggal hari ini: ' + today + '\n' +
    '   - Format: YYYY-MM-DD\n\n' +
    '7. AKUN BARU (deteksi pembuatan akun):\n' +
    '   Jika pengguna ingin MEMBUAT AKUN BARU (bukan mencatat transaksi):\n' +
    '   Kata kunci: "bikin akun", "buat akun", "tambah akun", "akun baru", "buka akun", "daftar akun", "register akun"\n\n' +
    '   Isi field newAccount dengan objek:\n' +
    '   {\n' +
    '     "bankName": "nama bank/akun (contoh: BCA, GoPay, KPR Mandiri)",\n' +
    '     "accountType": "passive" | "investment" | "credit",\n' +
    '     "accountSubType": "sub tipe",\n' +
    '     "initialBalance": saldo_awal (angka),\n' +
    '     // Kredit-specific (hanya jika accountType = "credit"):\n' +
    '     "interestRate": suku_bunga_tahunan_persen,\n' +
    '     // Revolving:\n' +
    '     "creditLimit": limit_kredit,\n' +
    '     "dueDate": tanggal_jatuh_tempo (1-28),\n' +
    '     "minimumPaymentRate": persen_minimal_bayar (default 10),\n' +
    '     // Cicilan:\n' +
    '     "totalLoan": total_pinjaman,\n' +
    '     "tenorMonths": tenor_bulan,\n' +
    '     "monthlyInstallment": cicilan_per_bulan,\n' +
    '     "startDate": "YYYY-MM-DD"\n' +
    '   }\n\n' +
    '   Sub tipe akun:\n' +
    '   - Pasif: Spending, Tabungan, Payroll\n' +
    '   - Investasi: Reksadana, Emas, Saham DN, Saham LN\n' +
    '   - Kredit: Revolving, Cicilan\n\n' +
    '   JIKA TIDAK ADA maksud membuat akun baru, set "newAccount" ke null.\n\n' +
    'Kembalikan HANYA JSON valid tanpa teks pembuka, penutup, atau markdown:\n' +
    '{\n' +
    '  "description": "Deskripsi yang sudah dinormalisasi",\n' +
    '  "amount": 5000,\n' +
    '  "type": "expense",\n' +
    '  "category": "Makanan",\n' +
    '  "date": "' + today + '",\n' +
    '  "accountHint": "Cash",\n' +
    '  "destAccountHint": "",\n' +
    '  "adminFee": 0,\n' +
    '  "debtType": "",\n' +
    '  "debtPerson": "",\n' +
    '  "splitBill": null,\n' +
    '  "newAccount": null\n' +
    '}\n\n' +
    'CATATAN:\n' +
    '- destAccountHint hanya diisi jika type = "transfer"\n' +
    '- adminFee diisi untuk SEMUA tipe transaksi jika ada biaya admin/fee/biaya layanan. Berlaku untuk transfer, expense, maupun income.\n' +
    '- debtType dan debtPerson hanya diisi jika terdeteksi hutang/piutang\n' +
    '- splitBill hanya diisi jika terdeteksi patungan/split bill, isi null untuk transaksi biasa\n' +
    '- splitBill dan debtType/debtPerson bersifat MUTUALLY EXCLUSIVE. Jika split bill terdeteksi, set debtType = "" dan debtPerson = "". Jika hutang/piutang terdeteksi, set splitBill = null.\n' +
    '- newAccount hanya diisi jika pengguna ingin MEMBUAT AKUN BARU. Isi null untuk transaksi biasa.\n' +
    '- Untuk transaksi biasa, isi destAccountHint = "", adminFee = 0, debtType = "", debtPerson = "", splitBill = null, newAccount = null\n\n' +
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
    '→ {"description": "Kirim Dana", "amount": 500000, "type": "transfer", "category": "", "date": "' + today + '", "accountHint": "Mandiri", "destAccountHint": "BCA", "adminFee": 2500, "debtType": "", "debtPerson": ""}\n\n' +
    'Input: "nitip abang beliin susu 50rb di alfamart"\n' +
    '→ {"description": "Susu Alfamart", "amount": 50000, "type": "expense", "category": "Belanja", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "hutang", "debtPerson": "abang"}\n\n' +
    'Input: "bayarin temen makan 100rb"\n' +
    '→ {"description": "Makan Bersama", "amount": 100000, "type": "expense", "category": "Makanan", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "piutang", "debtPerson": "temen"}\n\n' +
    'Input: "nraktir kopi temen 50k cash"\n' +
    '→ {"description": "Kopi", "amount": 50000, "type": "expense", "category": "Makanan", "date": "' + today + '", "accountHint": "Cash", "destAccountHint": "", "adminFee": 0, "debtType": "piutang", "debtPerson": "temen"}\n\n' +
    'Input: "ditalangin dulu 200rb buat beli obat"\n' +
    '→ {"description": "Beli Obat", "amount": 200000, "type": "expense", "category": "Kesehatan", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "hutang", "debtPerson": ""}\n\n' +
    'Input: "patungan nasgor 4 orang total 100rb"\n' +
    '→ {"description": "Patungan Nasi Goreng", "amount": 100000, "type": "expense", "category": "Makanan", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": { "mode": "equal", "totalPeople": 4 }}\n\n' +
    'Input: "split bill bakso andi 30k budi 25k"\n' +
    '→ {"description": "Split Bill Bakso", "amount": 55000, "type": "expense", "category": "Makanan", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": { "mode": "custom", "participants": [{ "person": "andi", "amount": 30000 }, { "person": "budi", "amount": 25000 }] }}\n\n' +
    'Input: "cheeseburger 30k cola 10k sundae 15k, gw cheeseburger falah cola falih sundae"\n' +
    '→ {"description": "Split Bill McD", "amount": 55000, "type": "expense", "category": "Makanan", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": { "mode": "custom", "participants": [{ "person": "falah", "amount": 10000 }, { "person": "falih", "amount": 15000 }] }}\n\n' +
    'Input: "topup gopay 20k admin 1k"\n' +
    '→ {"description": "Top Up GoPay", "amount": 20000, "type": "expense", "category": "Transportasi", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 1000, "debtType": "", "debtPerson": "", "splitBill": null, "newAccount": null}\n\n' +
    'CONTOH PEMBUATAN AKUN BARU — perhatikan: type="expense", category="Lainnya", amount=0:\n\n' +
    'Input: "bikin akun BCA spending 5jt"\n' +
    '→ {"description": "", "amount": 0, "type": "expense", "category": "Lainnya", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": null, "newAccount": {"bankName": "BCA", "accountType": "passive", "accountSubType": "Spending", "initialBalance": 5000000}}\n\n' +
    'Input: "buat akun kartu kredit Mandiri limit 10jt bunga 24% jatuh tempo tgl 15"\n' +
    '→ {"description": "", "amount": 0, "type": "expense", "category": "Lainnya", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": null, "newAccount": {"bankName": "Mandiri CC", "accountType": "credit", "accountSubType": "Revolving", "initialBalance": 0, "interestRate": 24, "creditLimit": 10000000, "dueDate": 15, "minimumPaymentRate": 10}}\n\n' +
    'Input: "tambah akun cicilan KPR 500jt bunga 12% tenor 20 tahun"\n' +
    '→ {"description": "", "amount": 0, "type": "expense", "category": "Lainnya", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": null, "newAccount": {"bankName": "KPR", "accountType": "credit", "accountSubType": "Cicilan", "initialBalance": 0, "interestRate": 12, "totalLoan": 500000000, "tenorMonths": 240}}\n\n' +
    'Input: "buka akun GoPay pasif spending 100000"\n' +
    '→ {"description": "", "amount": 0, "type": "expense", "category": "Lainnya", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": null, "newAccount": {"bankName": "GoPay", "accountType": "passive", "accountSubType": "Spending", "initialBalance": 100000}}\n\n' +
    'Input: "buat akun reksadana Bibit investasi 2000000"\n' +
    '→ {"description": "", "amount": 0, "type": "expense", "category": "Lainnya", "date": "' + today + '", "accountHint": "", "destAccountHint": "", "adminFee": 0, "debtType": "", "debtPerson": "", "splitBill": null, "newAccount": {"bankName": "Bibit", "accountType": "investment", "accountSubType": "Reksadana", "initialBalance": 2000000}}';
}
