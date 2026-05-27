# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Personal finance tracker — SPA hosted on Firebase with a Telegram bot companion. Indonesian locale (id-ID). No frameworks, no build tools (frontend), no package manager (frontend).

**Firebase project**: `financial-tracker-3d5f0`
**Hosting URL**: https://financial-tracker-3d5f0.web.app

## File structure

### Frontend (vanilla HTML/CSS/JS, CDN-loaded Firebase Compat SDK)

| File | Purpose |
|---|---|
| `index.html` | Single-page shell: login/signup forms, navbar with 5 pages (Dashboard, Transaksi, Akun, Budget, Baru), account modal. Script load order: firebase-app-compat → firebase-auth-compat → firebase-firestore-compat → firebase-functions-compat → firebase-config.js → auth.js → app.js. |
| `style.css` | Design system via CSS custom properties in `:root`. Single `@media (max-width: 700px)` breakpoint. Card pattern: `background: var(--surface)`, `border-radius: var(--radius-lg)`, `padding: 24px`, `box-shadow: var(--shadow-sm)`. |
| `firebase-config.js` | `initializeApp()`, creates `db` and `auth` globals (Compat SDK). Enables offline Firestore persistence. |
| `auth.js` | Email/password auth with LOCAL/SESSION persistence. Signup creates `users/{uid}/profile/data` + `users/{uid}/settings/main` (pre-seeded Gemini API key). Auth state observer routes between `#auth-section` and `#app-content`. |
| `app.js` | All business logic: Firestore data listeners, navigation, transaction CRUD with edit, account CRUD, settings, canvas charts, CSV export, AI image scanner (via callable function), Telegram link code generator, budget per category with progress bars and alerts, investment portfolio with mark-to-market adjustments, sub-type management, debt/piutang CRUD with payment tracking, split bill (patungan) form with equal/custom modes. |

`script.js` exists in project root but is **not loaded** by `index.html` — dead code, ignore.

### Backend (TypeScript Cloud Functions, Node 20)

| File | Purpose |
|---|---|
| `functions/src/index.ts` | Entry point: `telegramWebhook` (onRequest) receives Telegram updates, routes to command handlers. Re-exports `callGemini`, `dailyRecap`, `weeklyRecap`. Uses secrets: `TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`. |
| `functions/src/commands.ts` | Telegram bot handlers: `/start`, `/help`, `/link`, `/saldo`, `/tambah`, `/pemasukan`, `/transfer`, `/bulanini`, `/statistik`, `/banding`, `/akun`. Also `handlePhoto()` (receipt scan with caption), `handleFreeText()` (natural language input), `normalizeAndCreateTransaction()` (shared create logic, handles income/expense/transfer + admin fee + debt + split bill routing). `normalizeAndCreateDebt()` for hutang/piutang. `normalizeAndCreateSplitBill()` for patungan (atomic expense + debts via `runTransaction`). All in Bahasa Indonesia. Uses Admin SDK (bypasses Firestore rules). |
| `functions/src/telegram.ts` | `sendMessage(chatId, text, parseMode)` — calls Telegram Bot API via `fetch()`. `downloadPhotoAsBase64(fileId)` — downloads photo from Telegram servers (no resize). `downloadAndResizePhoto(fileId, maxDim?)` — downloads + resizes via `sharp` (max 1200px, 80% JPEG) before base64 encoding, used by `handlePhoto` to keep Gemini payload small. `escapeHtml()` for HTML-safe output. |
| `functions/src/gemini.ts` | `callGemini` (onCall) — auth-gated proxy to Gemini 2.5 Flash for receipt scanning. `callGeminiAPI(parts)` — reusable API caller used by bot handlers. Detects safety filter blocks (`promptFeedback.blockReason`, `finishReason: SAFETY`), empty candidates, and empty text responses — throws descriptive errors in Indonesian for each case. `buildScanPrompt()` and `buildNaturalLanguagePrompt()` with Indonesian category descriptions, few-shot examples, transfer detection, debt/piutang detection, and split bill (patungan) detection. Uses secret: `GEMINI_API_KEY`. |
| `functions/src/scheduler.ts` | `dailyRecap` (every day 9pm WIB) and `weeklyRecap` (Sunday 9pm WIB) — PubSub scheduled functions. Query all linked Telegram users, summarize transactions, send recap messages. |
| `functions/package.json` | Dependencies: `firebase-admin@^12`, `firebase-functions@^5`, `sharp@^0.34`. Build: `tsc`. |
| `functions/tsconfig.json` | Target ES2020, module commonjs, outDir `lib`, rootDir `src`. |

## Data layer (Firestore)

All user data under `users/{uid}/`. In-memory caches (`txCache`, `accCache`, `settingsCache`, `budgetCache`, `subTypeCache`, `paydayOverridesCache`, `debtCache`) kept in sync via `onSnapshot` listeners, initialized in `initDataListeners(uid)`. All listeners except paydayOverrides call `renderActivePage()` on change; paydayOverrides listener also calls `renderActivePage()` for UI reactivity.

| Path | Fields | Notes |
|---|---|---|
| `users/{uid}/transactions/{id}` | `{ desc, amount, type, category, date, accountId, createdAt, transferToAccountId? }` | `type` = `"income"` / `"expense"` / `"transfer"`. `accountId` can be empty string. `transferToAccountId` only for transfer type. Listener ordered by `createdAt` desc. |
| `users/{uid}/accounts/{id}` | `{ bankName, accountType, accountSubType, initialBalance, currentValue, lastAdjustedAt }` | `accountType` = `"passive"` / `"investment"`. `accountSubType` e.g. "Spending", "Reksadana". `currentValue` (investment only): latest mark-to-market value. Passive balance = `initialBalance + net(transactions)`. Investment balance = `currentValue` (falls back to `initialBalance` if not set). |
| `users/{uid}/accounts/{id}/adjustments/{autoId}` | `{ date, previousValue, newValue, difference, createdAt }` | Investment P/L records. One record per manual adjustment. `difference` = newValue − previousValue (positive=profit, negative=loss). |
| `users/{uid}/settings/accountSubTypes` | `{ passive: string[], investment: string[] }` | Custom sub-type lists. Falls back to `ACCOUNT_SUB_TYPE_DEFAULTS` if doc doesn't exist. |
| `users/{uid}/profile/data` | `{ username, email, createdAt }` | Created at signup. |
| `users/{uid}/settings/main` | `{ paydayStart, geminiApiKey }` | `paydayStart` defaults to 1, max 28. |
| `users/{uid}/settings/paydayOverrides` | `{ "YYYY-MM": number }` | Monthly payday exceptions. e.g. `{ "2026-06": 26 }`. `getPaydayStart(monthKey)` checks this first, falls back to default. |
| `users/{uid}/settings/budgets` | `{ [category]: number }` | Category-to-amount map, e.g. `{ "Makanan": 2000000 }`. Only categories with values > 0 stored. |
| `telegramLinkCodes/{code}` | `{ uid, createdAt }` | Temporary 6-digit codes. Created by web app, consumed by bot. 10-min expiry. |
| `telegramUsers/{chatId}` | `{ uid, linkedAt }` | Maps Telegram chatId → Firebase uid. Admin SDK only per Firestore rules. |
| `users/{uid}/debts/{id}` | `{ person, type, amount, description, date, accountId, remainingAmount, status, payments, createdAt, settledAt }` | `type` = `"hutang"` / `"piutang"`. `status` = `"pending"` / `"partial"` / `"paid"`. `remainingAmount` tracks unpaid portion. `payments[]` array of `{ amount, date, accountId, note, createdAt }` — each payment creates a transaction (piutang→income, hutang→expense). `accountId` can be empty string (split bill piutang use this to avoid double-counting in `getAccountBalance()`). Listener via `onSnapshot` populates `debtCache`. |

## Categories

```js
CATEGORIES = {
  income: ['Gaji', 'Freelance', 'Investasi', 'Bisnis', 'Hadiah', 'Lainnya'],
  expense: ['Makanan', 'Tagihan', 'Transportasi', 'Belanja', 'Zakat & Donasi', 'Kesehatan', 'Hiburan & Hobi', 'Lainnya']
}
```

6 income, 8 expense. All category validation in app.js, commands.ts, and Gemini prompts must use these lists. Both `app.js` and `functions/src/commands.ts` have their own `CATEGORIES` constant — keep them in sync.

## Navigation

Five `.nav-btn` buttons — `data-page` maps to `#page-{name}`:

| data-page | Section ID | Render function | Notes |
|---|---|---|---|
| `dashboard` | `#page-dashboard` | `renderDashboard()` | Also calls `renderBudgetProgress()` + `renderBudgetAlerts()` + `renderPortfolio()` + `renderPaydayOverrides()` |
| `transactions` | `#page-transactions` | `renderTransactions()` | Filter by type + category |
| `accounts` | `#page-accounts` | `renderAccountsPage()` | Also calls `renderSubTypeSettings()` (expandable, below account grid) |
| `budgets` | `#page-budgets` | `renderBudgets()` | Per-category expense budget inputs with save button |
| `add` | `#page-add` | `updateFormForType()` + `populateAccountSelect()` | Type tabs (expense/income/transfer) control form visibility. Transfer shows dest account + admin fee. Also used for edit mode. |

Nav click handler at `app.js:~230` explicitly maps each page. When adding pages, update both the HTML `#page-*` section AND the nav handler.

## Key patterns

- **Compat SDK (global scope)**: All Firebase calls use `firebase.firestore()`, `firebase.auth()`, `firebase.functions()` — NOT modular `import` syntax. Globals `db`, `auth` from `firebase-config.js`.
- **Account balance is dynamic**: `getAccountDisplayBalance()` — for passive accounts: `initialBalance + net(transactions)`. For investment accounts: `currentValue` (falls back to `initialBalance` if null). Dashboard total = sum of all account display balances + unassigned transactions.
- **Investment mark-to-market**: Investment account cards show "Adjust" button. Opens modal with current balance (readonly), new balance input, date picker, and live P/L preview. Submit writes adjustment record to `users/{uid}/accounts/{id}/adjustments/` and updates account's `currentValue` + `lastAdjustedAt`. Dashboard portfolio card shows investment accounts with current values and month P/L.
- **Sub-types**: Customizable per main type via Accounts page ("Kelola Sub Tipe Akun" — expandable section below account grid, collapsed by default). Defaults: passive → Spending/Tabungan/Payroll, investment → Reksadana/Emas/Saham DN/Saham LN. Stored in `settings/accountSubTypes`, falls back to `ACCOUNT_SUB_TYPE_DEFAULTS`.
- **Event delegation**: Transaction edit/delete via `.closest('.tx-edit')` / `.closest('.tx-delete')`. Account edit/delete/adjust via `[data-edit-account]` / `[data-delete-account]` / `[data-adjust-account]` attributes. Document-level listeners.
- **Toast**: `showToast(msg)` creates/reuses `#toast` div, auto-hides 2.2s.
- **Modal**: `#account-modal` toggled via `.show` class. `openAccountModal(account?)` — with account = edit mode, without = add mode.
- **Edit transaction flow**: Click pencil `.tx-edit` → `editTransaction(id)` pre-fills form, changes heading to "Edit Transaksi", shows "Batal" button, navigates to `#page-add`. Sets `currentType` from tx.type, activates correct tab, calls `updateFormForType()`. For transfers, populates dest account and hides category. Cancel via `resetTransactionForm()` returns to transactions page. Submit checks `#edit-tx-id` — if set uses `.update()`, else `.add()`.
- **Transfer flow**: `currentType` variable tracks active type-tab (expense/income/transfer). `updateFormForType()` toggles visibility: category hidden for transfer, dest account + admin fee shown only for transfer. Source label changes to "Akun Asal". Validation ensures source≠dest. Admin fee > 0 creates separate expense doc with category "Lainnya". Transfer displays with blue source→dest badge in transaction list. Transfers excluded from income/expense totals, but calculated into per-account net balances (source -= amount, dest += amount).
- **Budget system**: `budgetCache` from `onSnapshot` on `settings/budgets`. `renderBudgets()` builds inputs per `CATEGORIES.expense`. `renderBudgetProgress()` shows progress bars (blue <80%, yellow 80-99%, red 100%+). `renderBudgetAlerts()` shows warnings at 80%/100% thresholds. Categories with 0 budget hidden.
- **Card styling**: All dashboard cards use: `background: var(--surface); border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-sm);`. Includes: `.chart-card`, `.recent-section`, `.budget-progress-section`, `.settings-bar`.
- **Debt system (Hutang/Piutang)**: `debtCache` from `onSnapshot` on `users/{uid}/debts`. Debts page at `#page-debts` with type/status filters (default: "Aktif" = non-paid). Payment modal: records payment amount, date, account, note → pushes to `payments[]` array, updates `remainingAmount` and `status`, then creates a transaction for ledger: piutang→income (category `💰 Piutang`), hutang→expense (category `Hutang`). Payment `createdAt` inside array uses `new Date().toISOString()` (NOT `serverTimestamp()` — not supported in arrays). Debt payments excluded from `getAccountBalance()` (transactions handle the balance, avoids double-count).
- **Split Bill (Patungan)**: Web form in `#page-add` (expense type, non-edit only). Toggle `#split-bill-enabled`. Two modes: Equal (`totalAmount ÷ totalPeople`, remainder→last friend) and Custom (name + amount per friend). Creates 1 expense (userShare only) + N piutang debts (`accountId: ""` to avoid double-counting). Backend uses `runTransaction` for atomic writes (expense + debts all-or-nothing). Gemini prompts detect split bill keywords (patungan, split, bareng, bagi rata, iuran, urunan) with mutual exclusivity vs debt detection.
- **Piutang income adjustment**: Piutang payment transactions (category `💰 Piutang`) are **excluded from income totals** and **subtracted from expense totals** across ALL summary displays: `renderDashboard()`, `renderPieChart()`, `renderBarChart()`, `renderAccountsPage()`. This makes piutang repayments reduce net expenses rather than inflate income. Accounts page shows dual total: "Sebelum Hutang" (pure account balances) and "Setelah Hutang" (balances + piutang − hutang) with debt summary section using same `.debt-summary-section` classes as dashboard.

### Payday-based month logic

`getMonthKey(dateStr, paydayStart)` — split at the 15th:
- Payday ≤ 15: before payday → previous month, on/after → current
- Payday > 15: before payday → current month, on/after → next month

`getPaydayStart(monthKey?)` reads from `paydayOverridesCache[monthKey]` first, falls back to `settingsCache.paydayStart`. Overrides manageable via dashboard settings (month picker + day input).

## Charts

Custom Canvas 2D at 2x HiDPI via `window.devicePixelRatio`. No Chart.js.

- **Pie/donut** (`renderPieChart(txns, monthKey?)`): expense breakdown by category. Optional monthKey filter. Donut hole shows total. Slices <5% unlabeled.
- **Bar** (`renderBarChart`): last 6 financial months, grouped income/expense bars with rounded corners.

`CHART_COLORS` (10 hex values). Re-render on window resize with 250ms debounce (dashboard only).

## AI Scanner

On `#page-add`. Two paths:

1. **Image upload** (web): User uploads receipt → `firebase.functions().httpsCallable('callGemini')` → Gemini 2.5 Flash scans image.
2. **Photo message** (Telegram): User sends photo to bot → `handlePhoto()` downloads + resizes via `downloadAndResizePhoto()` (max 1200px, 80% JPEG via `sharp`) → calls `callGeminiAPI()` with `buildScanPrompt()`. Caption passed as hint — enables transfer detection from photo + caption combo. No resize on web path (already done client-side).

- **Image handling**: File input + drag-and-drop on `.upload-zone`. JPG/PNG/WebP. Auto-resize >3.9MB base64 (canvas max 1200px, 80% JPEG). Clipboard paste supported.
- **Response parsing**: `extractJSON()` (regex), `normalizeResult()` (validates category against `CATEGORIES`, coerces type, validates date, preserves `splitBill` and `debtType`/`debtPerson` fields).
- **Account matching**: AI returns `accountHint`; `displayParseResult()` does case-insensitive substring match against `accCache`. Also displays debt/split info when detected.

## Telegram Bot

Bot: [@Fintracker_Takii_Bot](https://t.me/Fintracker_Takii_Bot). Webhook: `telegramWebhook` Cloud Function (1st Gen, us-central1).

**Linking flow**: Web app generates 6-digit code → writes to `telegramLinkCodes/{code}` → user sends `/link CODE` to bot → bot validates expiry, saves mapping to `telegramUsers/{chatId}`, deletes code.

**Message routing** (in order):
1. Photo → `handlePhoto(chatId, photoArray, caption?)` — downloads + resizes via `sharp`, scans with Gemini, creates transaction. Caption (if present) prepended to Gemini prompt as hint. Error message now includes actual failure detail (safety filter, empty response, etc.) instead of generic message.
2. Text starting with `/` → command routing
3. Other text → `handleFreeText()` — natural language input via Gemini (supports Indonesian slang: goceng=5000, goban=50000, ceban=10000, ceceng=100000, etc.). Detects transfer intent, debt/piutang intent, and split bill (patungan) intent. Routing priority: split bill > debt > transfer > normal income/expense.

**Commands**: `/start`, `/help`, `/link CODE`, `/saldo`, `/tambah JML KATEGORI DESC`, `/pemasukan JML KATEGORI DESC`, `/transfer JML AKUN_ASAL ke AKUN_TUJUAN DESC`, `/bulanini`, `/statistik` (text-based pie chart), `/banding` (month-vs-month comparison), `/akun`.

**Scheduled**: `dailyRecap` (9pm WIB daily) + `weeklyRecap` (9pm WIB Sundays). Iterate `telegramUsers`, query per-user transactions, send HTML recap.

## How to run / deploy

```bash
# Deploy functions only (build + deploy)
cd functions && npx tsc && cd .. && firebase deploy --only functions

# Deploy hosting only
firebase deploy --only hosting

# Deploy both
firebase deploy --only functions,hosting

# Set Firebase secrets (avoid newline from echo pipe)
# GOOD: "secret-value" | firebase functions:secrets:set NAME
# BAD:  echo "value" | firebase functions:secrets:set NAME

# View runtime logs
firebase functions:log --project financial-tracker-3d5f0

# Check Telegram webhook status
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

## Secrets

Two Firebase secrets: `TELEGRAM_BOT_TOKEN` and `GEMINI_API_KEY`. Set via `firebase functions:secrets:set`. Redeploy functions after secret changes. Always `.trim()` tokens — PowerShell pipe adds trailing newline.

After deploy, Firebase Hosting CDN may serve stale files briefly. Hard refresh (Ctrl+Shift+R) or append `?v=N` cache buster to verify.
