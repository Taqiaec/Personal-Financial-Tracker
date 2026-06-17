# Design: Edit Transaction Modal

**Date**: 2026-06-17
**Status**: Approved
**Author**: Brainstorming Session

---

## Understanding Summary

- **What**: Modal edit transaksi menggantikan redirect ke page tambah, plus perbaikan UX
- **Why**: Edit transaksi redirect ke page tambah (ifry), save button tidak fungsi (silent return), UX kurang rapi
- **Who**: User FinanceTracker yang edit transaksi dari daftar transaksi
- **Constraints**: Tidak mengubah Firestore data model, tidak mengubah Telegram bot logic
- **Non-goals**: Fitur baru selain perbaikan UX edit transaksi

---

## Assumptions

1. Modal edit menggunakan pola `.modal-overlay.show` (sama dengan account-modal, debt-modal)
2. Form fields di modal sama dengan form di page-add (desc, amount, type tabs, category, account, date)
3. Transfer fields (dest account, admin fee) ditampilkan saat type = transfer
4. Admin fee di-hide saat edit (sama seperti behavior saat ini)
5. Split bill di-hide saat edit (sama seperti behavior saat ini)
6. Edit hutang/piutang dari halaman Transaksi → buka `#debt-modal` yang sudah ada
7. Loading state menggunakan `.spinner` class yang sudah ada
8. Delete transaksi hanya dari halaman Transaksi (bukan dari modal edit)

---

## Decision Log

| # | Decision | Alternatives | Rationale |
|---|----------|-------------|-----------|
| 1 | Modal approach | Redirect ke page-add, Inline edit | Konsisten dengan pola existing, lebih rapi |
| 2 | `#tx-modal` baru dengan form duplicate | Refactor reusable, Edit di page-add | Practical, low risk, consistent pattern |
| 3 | Edit hutang → buka `#debt-modal` | Satu modal universal | Debt-modal sudah lengkap untuk hutang |
| 4 | Toast untuk validasi | Console.log, Alert | Konsisten dengan toast pattern existing |
| 5 | `confirm()` untuk delete | Custom modal, Swipe-to-delete | Simple, native, cukup untuk scope ini |
| 6 | Loading state di semua form submit | Disable only | Prevent double-submit + user feedback |
| 7 | Escape key tutup modal | Hanya backdrop click | Low effort, standard UX pattern |
| 8 | Admin fee hide saat edit | Tampilkan tapi disable | Sama seperti behavior saat ini |

---

## Design

### HTML Structure (`#tx-modal`)

```
#tx-modal (modal-overlay)
├── .modal-card
│   ├── .modal-header
│   │   ├── h3#tx-modal-title ("Edit Transaksi")
│   │   └── button.modal-close#tx-modal-close (X icon)
│   └── form#tx-form
│       ├── input[type=hidden]#tx-edit-id
│       ├── .form-group (Deskripsi)
│       ├── .form-group (Jumlah)
│       ├── .type-tabs#tx-type-tabs
│       │   ├── button[data-type=expense] "Pengeluaran"
│       │   ├── button[data-type=income] "Pemasukan"
│       │   └── button[data-type=transfer] "Transfer"
│       ├── .form-group#tx-category-group (Kategori)
│       ├── .form-group#tx-source-account-group (Akun / Akun Asal)
│       ├── .form-group#tx-transfer-to-group (hidden — Akun Tujuan)
│       ├── .admin-fee-row#tx-admin-fee-row (hidden — Biaya Admin)
│       ├── .form-group (Tanggal)
│       └── #tx-form-actions
│           ├── button.btn-primary#tx-submit-btn "Simpan Perubahan"
│           └── button.btn-secondary#tx-cancel-btn "Batal"
```

### JavaScript Logic

#### `openTxModal(tx)`
1. Set `#tx-modal-title` → "Edit Transaksi"
2. Set `#tx-submit-btn` → "Simpan Perubahan"
3. Set `#tx-edit-id` → `tx.id`
4. Isi fields: desc, amount, date, account select
5. Set type tab aktif berdasarkan `tx.type`
6. Jika transfer: populate `tx-transfer-to-account`, tampilkan transfer fields
7. Jika income/expense: populate category select, set value
8. Tambah class `.show` ke `#tx-modal`

#### `closeTxModal()`
1. Reset form: `#tx-form`.reset(), clear `#tx-edit-id`
2. Set date ke hari ini
3. Reset type tabs ke expense
4. Hide transfer fields
5. Remove class `.show` dari `#tx-modal`

#### Submit handler (`#tx-form` submit)
1. `e.preventDefault()`
2. Validasi: desc, amount, date — jika kosong → **toast error**
3. Set `#tx-submit-btn` → loading state (disable + spinner)
4. Build `txData` object
5. Jika `#tx-edit-id` ada → `db...doc(editId).update(txData)`
6. `.then()` → `closeTxModal()`, toast success
7. `.catch()` → toast error, reset loading state
8. `#tx-cancel-btn` click → `closeTxModal()`

#### Navigation changes
- `editTransaction(id)` → panggil `openTxModal(tx)` (bukan redirect)
- Jika edit hutang → panggil `openDebtModal(debt)` langsung
- `resetTransactionForm()` di page-add tidak berubah

#### Keyboard
- `Escape` → `closeTxModal()` jika modal terbuka

### Toast Validation (mengganti silent return)

Di semua form submit handlers:
- `#transaction-form` submit (page-add)
- `#tx-form` submit (modal edit)
- `#debt-form` submit (debt-modal)

Toast messages:
- `"Deskripsi harus diisi"` — desc kosong
- `"Jumlah harus diisi"` — amount kosong/0
- `"Tanggal harus diisi"` — date kosong

### Delete Transaction Confirmation

Di halaman Transaksi, tombol delete (`.tx-delete`):
1. `confirm('Yakin hapus transaksi ini?')`
2. Jika OK → `doc.delete()` + toast success
3. Jika cancel → tidak terjadi apa-apa

### Loading State Pattern

Saat proses save/update:
1. `submitBtn.disabled = true`
2. Simpan original text → set innerHTML ke `<span class="spinner"></span> Menyimpan...`
3. Setelah selesai → restore original text + `disabled = false`

Terapkan di:
- `#tx-form` submit (modal edit)
- `#transaction-form` submit (page-add)
- `#debt-form` submit (debt-modal)

### Edge Cases

- **Edit transaksi yang sudah di-delete**: Firestore update gagal → toast error → close modal
- **Double submit**: Loading state mencegah click ganda
- **Modal backdrop click**: Tutup modal

---

## Files Changed

1. `index.html` — Tambah `#tx-modal` HTML section
2. `app.js` — Refactor edit flow, tambah modal handlers, toast validation, delete confirmation, loading state, Escape handler
3. `style.css` — Minor tweaks jika diperlukan

## Files NOT Changed

- Firestore data model
- Telegram bot logic
- Page-add add flow
- Debt-modal logic
