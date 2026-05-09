import 'server-only';

import { formatNotificationText } from './format';
import type { NotifyChannelState, NotifyPayload, NotifyResult } from './types';

export function getTelegramNotifyStatus(): NotifyChannelState {
  const enabled = process.env.ENABLE_TELEGRAM_NOTIFY === 'true';
  const configured = Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());

  return {
    enabled,
    configured,
    status: !enabled ? 'disabled' : configured ? 'ready' : 'not_configured',
  };
}

export async function sendTelegramNotification(payload: NotifyPayload): Promise<NotifyResult> {
  const state = getTelegramNotifyStatus();
  if (!state.enabled) {
    return { ok: false, channel: 'telegram', status: 'disabled', message: 'Telegram notify is disabled.' };
  }
  if (!state.configured) {
    return { ok: false, channel: 'telegram', status: 'not_configured', message: 'Telegram bot or chat id is not configured.' };
  }

  const token = process.env.TELEGRAM_BOT_TOKEN as string;
  const chatId = process.env.TELEGRAM_CHAT_ID as string;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatNotificationText(payload).slice(0, 3900),
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      console.warn('[Notify] Telegram send failed:', response.status);
      return { ok: false, channel: 'telegram', status: 'failed', message: `Telegram send failed (${response.status}).` };
    }

    return { ok: true, channel: 'telegram', status: 'sent', message: 'Telegram notification sent.' };
  } catch {
    console.warn('[Notify] Telegram send failed: network_error');
    return { ok: false, channel: 'telegram', status: 'failed', message: 'Telegram network error.' };
  }
}
