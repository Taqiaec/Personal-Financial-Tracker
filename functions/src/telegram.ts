// Telegram Bot API helper — lightweight, no library dependency
// Uses fetch() which is available in Node 20+

import sharp from 'sharp';

const TELEGRAM_API = 'https://api.telegram.org';

export function getToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

export async function sendMessage(chatId: number, text: string, parseMode: string = 'HTML'): Promise<void> {
  const token = getToken();
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    throw new Error('TELEGRAM_BOT_TOKEN not configured');
  }

  const body = new URLSearchParams();
  body.append('chat_id', chatId.toString());
  body.append('text', text);
  body.append('parse_mode', parseMode);

  const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('Telegram sendMessage error:', err);
  }
}

export async function downloadPhotoAsBase64(fileId: string): Promise<{ base64: string; mediaType: string }> {
  const token = getToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  // Get file path from Telegram
  const getFileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!getFileRes.ok) {
    const err: any = await getFileRes.json().catch(() => ({}));
    throw new Error('Telegram getFile error: ' + (err.description || getFileRes.status));
  }
  const fileData: any = await getFileRes.json();
  const filePath = fileData.result?.file_path;
  if (!filePath) throw new Error('No file_path in getFile response');

  // Download the actual file
  const downloadRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!downloadRes.ok) throw new Error('Telegram file download error: ' + downloadRes.status);

  const buffer = Buffer.from(await downloadRes.arrayBuffer());
  const base64 = buffer.toString('base64');

  // Determine media type from file extension
  const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', bmp: 'image/bmp'
  };
  const mediaType = mimeMap[ext] || 'image/jpeg';

  return { base64, mediaType };
}

export async function downloadAndResizePhoto(fileId: string, maxDim: number = 1200): Promise<{ base64: string; mediaType: string }> {
  const token = getToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not configured');

  const getFileRes = await fetch(`${TELEGRAM_API}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  if (!getFileRes.ok) {
    const err: any = await getFileRes.json().catch(() => ({}));
    throw new Error('Telegram getFile error: ' + (err.description || getFileRes.status));
  }
  const fileData: any = await getFileRes.json();
  const filePath = fileData.result?.file_path;
  if (!filePath) throw new Error('No file_path in getFile response');

  const downloadRes = await fetch(`${TELEGRAM_API}/file/bot${token}/${filePath}`);
  if (!downloadRes.ok) throw new Error('Telegram file download error: ' + downloadRes.status);

  const buffer = Buffer.from(await downloadRes.arrayBuffer());

  // Resize image to reduce payload size for Gemini API
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const w = metadata.width || 0;
  const h = metadata.height || 0;
  if (w > maxDim || h > maxDim) {
    image.resize(maxDim, maxDim, { fit: 'inside' });
  }
  const resizedBuffer = await image.jpeg({ quality: 80 }).toBuffer();

  return { base64: resizedBuffer.toString('base64'), mediaType: 'image/jpeg' };
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
