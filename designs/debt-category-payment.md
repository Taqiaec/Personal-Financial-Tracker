# Desain: Kategori Expense untuk Pembayaran Hutang

**Tanggal**: 2026-06-17
**Status**: Disetujui, siap implementasi

---

## Masalah

Saat ini pembayaran hutang selalu tercatat dengan kategori "Hutang" di pie chart, bar chart, dan budget. Padahal pembayaran hutang untuk beli makan seharusnya tercatat sebagai "Makanan" — mencerminkan tujuan pengeluaran sesungguhnya.

## Solusi

Tambah field `category` pada debt record. Saat bayar hutang, transaksi expense menggunakan kategori dari hutang tersebut. Kategori "Hutang" di-exclude dari semua chart dan budget.

---

## Decision Log

| # | Keputusan | Alternatif | Alasan |
|---|---|---|---|
| 1 | Expense tercatat saat pembayaran, bukan saat hutang dibuat | Saat dibuat / keduanya | Hutang hanya catatan, expense nyata saat uang keluar |
| 2 | 1 kategori per hutang | Bisa beda kategori per cicilan | Lebih simpel, konsisten, YAGNI |
| 3 | Kategori wajib untuk hutang baru | Opsional dengan default "Hutang" | Memaksa user berpikir tentang tujuan pengeluaran |
| 4 | Cicilan/partial selalu pakai kategori hutang | User pilih per cicilan | Konsisten — satu hutang = satu tujuan |
| 5 | Hutang lama: biarkan, default "Hutang" | Wajib edit dulu | Backward compatible |
| 6 | "Hutang" di-exclude dari pie chart, bar chart, budget | Hanya exclude dari pie chart | Bersih — "Hutang" bukan kategori meaningful |
| 7 | Helper function `isExcludedFromCharts()` | Inline filter | Single source of truth |
| 8 | Pendekatan 1 (Minimal) | Pendekatan 2/3 | YAGNI — perubahan minimal |

---

## Data Layer

### Debt Record — Field Baru

```
users/{uid}/debts/{id}:
+ category: string    // Required untuk hutang baru. Dari CATEGORIES.expense.
                       // Hutang lama (undefined) → fallback "Hutang" saat bayar
```

---

## UI Changes

### Form Hutang (halaman Baru + modal di halaman Hutang)

Tambah dropdown kategori di `#debt-form-section` dan `#debt-modal`:

```html
<div class="form-group">
  <label for="add-debt-category">Kategori Pengeluaran</label>
  <select id="add-debt-category" required>
    <option value="">-- Pilih Kategori --</option>
    <option>Makanan</option>
    <option>Transportasi</option>
    <option>Belanja</option>
    <option>Hiburan</option>
    <option>Tagihan</option>
    <option>Kesehatan</option>
    <option>Pendidikan</option>
    <option>Kendaraan</option>
    <option>Lainnya</option>
  </select>
</div>
```

---

## Payment Handler Changes

### `app.js` — Payment Form Submit (~line 2578)

**Sebelum:**
```js
var txCategory = debt.type === 'piutang' ? '💰 Piutang' : 'Hutang';
```

**Sesudah:**
```js
var txCategory;
if (debt.type === 'piutang') {
    txCategory = '💰 Piutang';
} else {
    txCategory = (debt.category && CATEGORIES.expense.includes(debt.category))
        ? debt.category
        : 'Hutang';
}
```

---

## Exclusion Logic

### Helper Function

```js
function isExcludedFromCharts(t) {
    return t.type === 'expense' && t.category === 'Hutang';
}
```

### Lokasi yang Perlu Diubah

| Fungsi | File | Perubahan |
|---|---|---|
| `renderDashboard()` | app.js | Exclude "Hutang" dari expenseTotal |
| `renderPieChart()` | app.js | Exclude "Hutang" dari expense list |
| `renderBarChart()` | app.js | Exclude "Hutang" dari expense per month |
| `renderBudgetProgress()` | app.js | Exclude "Hutang" dari monthTxns |
| `renderBudgetAlerts()` | app.js | Exclude "Hutang" dari perhitungan |
| `renderAccountsPage()` | app.js | Exclude "Hutang" dari unassigned stats |

---

## Telegram Bot Changes

### `commands.ts` — `normalizeAndCreateDebt()`

Tambah field `category` ke debt document.

### `gemini.ts` — `buildNaturalLanguagePrompt()`

Tambah deteksi kategori untuk intent hutang/piutang.

### `commands.ts` — `/bayar` Handler

Saat bayar hutang, buat transaksi expense dengan kategori dari debt record.

---

## Testing Checklist

- [ ] Buat hutang baru dengan kategori "Makanan" → field tersimpan
- [ ] Bayar hutang → transaksi expense category "Makanan" (bukan "Hutang")
- [ ] Pie chart menunjukkan "Makanan" (bukan "Hutang")
- [ ] Budget progress untuk "Makanan" bertambah
- [ ] Hutang lama (tanpa kategori) → bayar → transaksi "Hutang" tidak muncul di chart
- [ ] Bar chart tidak menunjukkan "Hutang" di expense
- [ ] Telegram /bayar → transaksi dengan kategori dari debt
- [ ] Telegram buat hutang → field category tersimpan
