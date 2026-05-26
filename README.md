# 💰 FinanceTracker

Aplikasi pencatat keuangan pribadi berbasis web + bot Telegram. Catat pemasukan & pengeluaran, pantau budget, valuasi investasi, dan scan struk pakai AI — semuanya gratis, tanpa iklan.

Akses: **[financial-tracker-3d5f0.web.app](https://financial-tracker-3d5f0.web.app)**

---

## Fitur

### Dashboard
Ringkasan saldo, pemasukan, pengeluaran. Chart donut pengeluaran per kategori + bar chart perbandingan bulanan. Progress bar budget + alert kalau mendekati atau melebihi limit. Portofolio investasi dengan mark-to-market.

### Transaksi
Catat pemasukan, pengeluaran, dan transfer antar akun dengan kategori. Filter by tipe, kategori, dan bulan. Export CSV satu klik.

### Transfer Antar Akun
Pindahkan dana antar akun sendiri (misal: BCA → GoPay). Biaya admin opsional otomatis tercatat sebagai pengeluaran terpisah. Tampilan transfer dengan badge sumber → tujuan.

### Akun
Kelola akun bank, e-wallet, dan investasi. Dua tipe akun:
- **Pasif** — rekening bank, e-wallet (saldo = saldo awal + net transaksi)
- **Investasi** — reksadana, emas, saham (saldo = nilai terkini, bisa disesuaikan manual)

Transaksi tanpa akun tetap dihitung di total saldo dashboard.

### Budget
Set budget per kategori pengeluaran. Dashboard akan menampilkan progress bar (biru <80%, kuning 80-99%, merah 100%+) dan alert otomatis.

### AI Scanner
Upload foto struk / screenshot transaksi → AI (Gemini) membaca deskripsi, jumlah, kategori, dan menebak akun. Support drag & drop, klik, dan paste dari clipboard. Kirim foto ke bot Telegram dengan caption "transfer dana bca ke mandiri" juga bisa — AI akan mendeteksi sebagai transfer.

### Bot Telegram
Bot [@Fintracker_Takii_Bot](https://t.me/Fintracker_Takii_Bot) — catat transaksi via chat tanpa buka aplikasi.

**Commands:**
| Command | Fungsi |
|---|---|
| `/start` | Info bot + daftar command |
| `/help` | Bantuan lengkap |
| `/link KODE` | Hubungkan akun (kode dari web app) |
| `/saldo` | Lihat saldo semua akun |
| `/tambah 50000 Makanan Nasi Padang` | Tambah pengeluaran |
| `/pemasukan 5000000 Gaji Gaji bulan ini` | Tambah pemasukan |
| `/bulanini` | Rekap transaksi bulan ini |
| `/statistik` | Pie chart pengeluaran (text-based) |
| `/banding` | Perbandingan bulan ini vs bulan lalu |
| `/akun` | Daftar akun terhubung |
| `/transfer 100000 BCA ke Mandiri` | Transfer dana antar akun |

Bisa juga chat bebas: `"makan siang 50rb"`, `"goceng mie ayam"`, `"transfer 100rb bca ke mandiri"` — AI akan parsing otomatis.

Bot kirim recap otomatis: harian + mingguan tiap jam 9 malam WIB.

---

## Cara Setup Bot Telegram

### 1. Daftar / Login di Web App
Buka [financial-tracker-3d5f0.web.app](https://financial-tracker-3d5f0.web.app), bikin akun atau login.

### 2. Generate Kode Link
Di halaman **Dashboard**, klik tombol **Pengaturan** (ikon gear). Di bagian **Telegram Bot**, klik **Generate Kode Link**. Akan muncul kode 6 digit — kode ini expired dalam 10 menit.

### 3. Kirim Kode ke Bot
Buka Telegram, cari [@Fintracker_Takii_Bot](https://t.me/Fintracker_Takii_Bot) dan kirim:
```
/link 123456
```
(Ganti `123456` dengan kode dari web app)

Bot akan mengkonfirmasi bahwa akun sudah terhubung. Setelah itu, kamu bisa langsung pakai semua command bot.

### 4. Mulai Chat
Kirim pesan bebas atau command. Contoh:
```
makan siang nasi padang 45rb
transfer 100rb bca ke gopay
```
Bot akan parsing dan menyimpan transaksi otomatis.

---

## Akun Keuangan (Custom Month)

FinanceTracker pakai logika **tanggal gajian** untuk membagi bulan keuangan:
- Default: tanggal 1 (bulan kalender normal)
- Bisa diubah di Pengaturan Dashboard, misal tanggal 25
- Bisa juga set pengecualian per bulan (misal Januari 2026 gajiannya tanggal 28)

**Logika**: kalau tanggal gajian ≤ 15, transaksi sebelum tanggal itu masuk bulan sebelumnya. Kalau > 15, transaksi setelah tanggal itu masuk bulan berikutnya.

---

## Kategori

**Pemasukan**: Gaji, Freelance, Investasi, Bisnis, Hadiah, Lainnya

**Pengeluaran**: Makanan, Tagihan, Transportasi, Belanja, Zakat & Donasi, Kesehatan, Hiburan & Hobi, Lainnya

---

## Privasi & Keamanan

- Semua data disimpan di Firestore (Firebase), diisolasi per user
- API key Gemini disimpan di variabel lingkungan server (Cloud Functions secrets), tidak di frontend
- Bot Telegram hanya bisa diakses setelah link kode 6 digit
- Firestore rules membatasi akses per user — user A tidak bisa baca data user B

---

## Teknologi

- **Frontend**: Vanilla HTML/CSS/JS, Firebase Compat SDK (CDN), custom Canvas 2D charts
- **Backend**: Firebase Cloud Functions (TypeScript, Node 20), Firebase Admin SDK
- **AI**: Gemini 2.5 Flash (receipt scanning + natural language parsing)
- **Hosting**: Firebase Hosting + Firestore + Cloud Functions
