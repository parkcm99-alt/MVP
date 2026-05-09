import 'server-only';

import { formatNotificationText } from './format';
import type { NotifyChannelState, NotifyPayload, NotifyResult } from './types';

export function getSlackNotifyStatus(): NotifyChannelState {
  const enabled = process.env.ENABLE_SLACK_NOTIFY === 'true';
  const configured = Boolean(process.env.SLACK_WEBHOOK_URL?.trim());

  return {
    enabled,
    configured,
    status: !enabled ? 'disabled' : configured ? 'ready' : 'not_configured',
  };
}

export async function sendSlackNotification(payload: NotifyPayload): Promise<NotifyResult> {
  const state = getSlackNotifyStatus();
  if (!state.enabled) {
    return { ok: false, channel: 'slack', status: 'disabled', message: 'Slack notify is disabled.' };
  }
  if (!state.configured) {
    return { ok: false, channel: 'slack', status: 'not_configured', message: 'Slack webhook is not configured.' };
  }

  try {
    const response = await fetch(process.env.SLACK_WEBHOOK_URL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: formatNotificationText(payload) }),
    });

    if (!response.ok) {
      console.warn('[Notify] Slack send failed:', response.status);
      return { ok: false, channel: 'slack', status: 'failed', message: `Slack send failed (${response.status}).` };
    }

    return { ok: true, channel: 'slack', status: 'sent', message: 'Slack notification sent.' };
  } catch {
    console.warn('[Notify] Slack send failed: network_error');
    return { ok: false, channel: 'slack', status: 'failed', message: 'Slack network error.' };
  }
}
