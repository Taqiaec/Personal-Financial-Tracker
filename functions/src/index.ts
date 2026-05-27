import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { handleStart, handleHelp, handleLink, handleSaldo, handleTambah, handleBulanIni, handleAkun, handleKredit, handlePhoto, handleFreeText, handleStatistik, handleBanding, handleTransfer, handleHutang, handlePiutang, handleBayar, handleBuatAkun } from './commands';
import { sendMessage } from './telegram';
export { callGemini } from './gemini';
export { dailyRecap, weeklyRecap, monthlyCreditInterest } from './scheduler';

admin.initializeApp();

interface TelegramMessage {
  message_id: number;
  from: { id: number; first_name: string; username?: string };
  chat: { id: number };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_unique_id: string; width: number; height: number; file_size?: number }>;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export const telegramWebhook = functions
  .runWith({ secrets: ['TELEGRAM_BOT_TOKEN', 'GEMINI_API_KEY'] })
  .https.onRequest(async (req, res) => {
    const update = req.body as TelegramUpdate;
    const msg = update.message;
    if (!msg) {
      res.status(200).send('OK');
      return;
    }

    const chatId = msg.chat.id;

    try {
      // Photo message — auto scan receipt
      if (msg.photo && msg.photo.length > 0) {
        await handlePhoto(chatId, msg.photo, msg.caption);
        res.status(200).send('OK');
        return;
      }

      // No text — ignore (voice, sticker, etc.)
      if (!msg.text) {
        res.status(200).send('OK');
        return;
      }

      const text = msg.text.trim();

      // Slash commands
      if (text === '/start') {
        await handleStart(chatId);
      } else if (text === '/help') {
        await handleHelp(chatId);
      } else if (text === '/saldo') {
        await handleSaldo(chatId);
      } else if (text === '/bulanini') {
        await handleBulanIni(chatId);
      } else if (text === '/statistik') {
        await handleStatistik(chatId);
      } else if (text === '/banding') {
        await handleBanding(chatId);
      } else if (text === '/akun') {
        await handleAkun(chatId);
      } else if (text === '/kredit') {
        await handleKredit(chatId);
      } else if (text.startsWith('/link')) {
        const code = text.replace('/link', '').trim();
        if (!code) {
          await sendMessage(chatId, '❌ Format: <code>/link 123456</code>\nDapatkan kode dari aplikasi web (Settings > Link Telegram).');
        } else {
          await handleLink(chatId, code);
        }
      } else if (text.startsWith('/tambah')) {
        await handleTambah(chatId, text, 'expense');
      } else if (text.startsWith('/pemasukan')) {
        await handleTambah(chatId, text, 'income');
      } else if (text.startsWith('/transfer')) {
        await handleTransfer(chatId, text);
      } else if (text === '/hutang') {
        await handleHutang(chatId);
      } else if (text === '/piutang') {
        await handlePiutang(chatId);
      } else if (text.startsWith('/bayar')) {
        await handleBayar(chatId, text);
      } else if (text.startsWith('/buatakun')) {
        await handleBuatAkun(chatId, text);
      } else if (text.startsWith('/')) {
        await sendMessage(chatId,
          '❓ Command tidak dikenal.\n\n' +
          'Gunakan /help untuk lihat daftar command yang tersedia.'
        );
      } else {
        // Free text — natural language transaction input
        await handleFreeText(chatId, text);
      }
      res.status(200).send('OK');
    } catch (err: any) {
      console.error('Error handling message:', err);
      try { await sendMessage(chatId, '❌ Terjadi kesalahan. Coba lagi nanti.'); } catch (_) {}
      res.status(200).send('OK');
    }
  });
