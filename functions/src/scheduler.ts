import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { sendMessage } from './telegram';

function db() { return admin.firestore(); }

function formatCurrency(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function getTodayWIB(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().split('T')[0];
}

function formatDateId(dateStr: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
}

// Weekly recap: every Sunday at 9 PM WIB
export const weeklyRecap = functions
  .runWith({ secrets: ['TELEGRAM_BOT_TOKEN'] })
  .pubsub.schedule('0 21 * * 0')
  .timeZone('Asia/Jakarta')
  .onRun(async (_context) => {
    const today = getTodayWIB();

    // Calculate 7 days ago
    const d = new Date();
    d.setDate(d.getDate() - 7);
    const wibStart = new Date(d.getTime() + 7 * 60 * 60 * 1000);
    const start = wibStart.toISOString().split('T')[0];

    const startLabel = formatDateId(start);
    const todayLabel = formatDateId(today);

    const usersSnap = await db().collection('telegramUsers').get();
    if (usersSnap.empty) {
      console.log('No linked Telegram users, skipping weekly recap');
      return;
    }

    // Phase 1: Parallel Firestore reads for all users
    const userResults = await Promise.all(usersSnap.docs.map(async (doc) => {
      const chatId = parseInt(doc.id, 10);
      if (!chatId) return null;
      const uid = doc.data().uid;

      try {
        const txSnap = await db()
          .collection('users').doc(uid).collection('transactions')
          .where('date', '>=', start)
          .where('date', '<=', today)
          .get();

        // Single-pass aggregation + day grouping
        let incomeTotal = 0, expenseTotal = 0, txnCount = 0;
        const dayMap: Record<string, { inc: number; exp: number }> = {};
        txSnap.forEach(t => {
          const d = t.data();
          if (!dayMap[d.date]) dayMap[d.date] = { inc: 0, exp: 0 };
          if (d.type === 'income') { incomeTotal += d.amount; dayMap[d.date].inc += d.amount; }
          else if (d.type === 'expense') { expenseTotal += d.amount; dayMap[d.date].exp += d.amount; }
          txnCount++;
        });

        if (txnCount === 0) return null;

        const net = incomeTotal - expenseTotal;
        const netSign = net >= 0 ? '+' : '';

        const dayLines = Object.entries(dayMap)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-7)
          .map(([date, vals]) => {
            const day = date.split('-')[2];
            const dayNet = vals.inc - vals.exp;
            const sign = dayNet >= 0 ? '+' : '';
            return `• ${day}: ${sign}Rp ${formatCurrency(Math.abs(dayNet))}`;
          });

        const msg =
          `<b>📊 Recap Mingguan</b>\n` +
          `${startLabel} — ${todayLabel}\n\n` +
          `📥 Pemasukan: Rp ${formatCurrency(incomeTotal)}\n` +
          `📤 Pengeluaran: Rp ${formatCurrency(expenseTotal)}\n` +
          `💰 Net: ${netSign}Rp ${formatCurrency(net)}\n` +
          `📝 Total: ${txnCount} transaksi\n\n` +
          `<b>Per Hari:</b>\n` +
          dayLines.join('\n');

        return { chatId, msg };
      } catch (err: any) {
        console.error(`Failed to fetch weekly recap for chat ${chatId}:`, err.message);
        return { chatId, error: true };
      }
    }));

    // Phase 2: Sequential Telegram sends (respect rate limits)
    let sent = 0, failed = 0;
    for (const result of userResults) {
      if (!result) continue;
      if ((result as any).error) { failed++; continue; }
      try {
        await sendMessage(result.chatId, result.msg!);
        sent++;
      } catch (err: any) {
        console.error(`Failed to send weekly recap to chat ${result.chatId}:`, err.message);
        failed++;
      }
    }

    console.log(`Weekly recap done: sent to ${sent} users, ${failed} failed`);
  });

// Monthly credit interest: runs daily at 1:00 AM WIB
// Checks revolving credit accounts on the day after their due date
export const monthlyCreditInterest = functions
  .runWith({ secrets: ['TELEGRAM_BOT_TOKEN'] })
  .pubsub.schedule('0 1 * * *')
  .timeZone('Asia/Jakarta')
  .onRun(async (_context) => {
    const wib = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
    const today = wib.getDate();
    const monthKey = wib.toISOString().split('T')[0].slice(0, 7);

    const usersSnap = await db().collection('telegramUsers').get();
    if (usersSnap.empty) {
      console.log('No linked Telegram users, skipping interest calc');
      return;
    }

    for (const userDoc of usersSnap.docs) {
      const chatId = parseInt(userDoc.id, 10);
      if (!chatId) continue;
      const uid = userDoc.data().uid;

      try {
        const accSnap = await db()
          .collection('users').doc(uid).collection('accounts')
          .where('accountType', '==', 'credit')
          .where('creditMode', '==', 'revolving')
          .where('interestRate', '>', 0)
          .get();

        if (accSnap.empty) continue;

        const txSnap = await db()
          .collection('users').doc(uid).collection('transactions').get();

        const txns: Array<{ accountId?: string; transferToAccountId?: string; type: string; amount: number }> = [];
        txSnap.forEach(d => {
          const t = d.data();
          txns.push({ accountId: t.accountId, transferToAccountId: t.transferToAccountId, type: t.type, amount: t.amount });
        });

        for (const accDoc of accSnap.docs) {
          const a = accDoc.data();
          const dueDate = a.dueDate;

          // Only on day after due date
          if (dueDate !== today - 1 && !(dueDate >= 28 && today === 1)) continue;

          // Dedup: already charged this month?
          if (a.lastInterestMonth === monthKey) continue;

          // Calculate usage
          const net = txns
            .filter(t => t.accountId === accDoc.id || t.transferToAccountId === accDoc.id)
            .reduce((s, t) => {
              if (t.type === 'transfer') {
                if (t.accountId === accDoc.id) return s + t.amount;
                if (t.transferToAccountId === accDoc.id) return s - t.amount;
                return s;
              }
              if (t.accountId !== accDoc.id) return s;
              return s + (t.type === 'income' ? -t.amount : t.amount);
            }, 0);
          const usage = Math.max(0, (a.initialBalance || 0) + net);

          if (usage <= 0) continue;

          const interestRate = a.interestRate || 0;
          const monthlyInterest = Math.round(usage * interestRate / 100 / 12);

          if (monthlyInterest <= 0) continue;

          // Create interest transaction
          await db().collection('users').doc(uid).collection('transactions').add({
            desc: 'Bunga ' + a.bankName,
            amount: monthlyInterest,
            type: 'expense',
            category: 'Tagihan',
            date: wib.toISOString().split('T')[0],
            accountId: accDoc.id,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Update lastInterestMonth
          await accDoc.ref.update({ lastInterestMonth: monthKey });

          // Notify user
          try {
            await sendMessage(chatId,
              '💸 <b>Bunga Kredit Tercatat</b>\n\n' +
              'Akun: <b>' + a.bankName + '</b>\n' +
              'Bunga: Rp ' + formatCurrency(monthlyInterest) + '\n' +
              'Usage: Rp ' + formatCurrency(usage) + '\n' +
              'Rate: ' + interestRate + '% / tahun'
            );
          } catch (_) { /* notification is best-effort */ }
        }
      } catch (err: any) {
        console.error(`Interest calc failed for user ${uid}:`, err.message);
      }
    }

    console.log('Monthly credit interest check complete');
  });
