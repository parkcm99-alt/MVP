import { sendSlackNotification, getSlackNotifyStatus } from '@/lib/notify/slack';
import { sendTelegramNotification, getTelegramNotifyStatus } from '@/lib/notify/telegram';
import type { NotifyPayload, NotifyStatusResponse } from '@/lib/notify/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getNotifyStatus(): NotifyStatusResponse {
  return {
    ok: true,
    channels: {
      slack: getSlackNotifyStatus(),
      telegram: getTelegramNotifyStatus(),
    },
  };
}

function isNotifyPayload(value: unknown): value is NotifyPayload {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Record<string, unknown>;
  return (body.channel === 'slack' || body.channel === 'telegram') &&
    typeof body.title === 'string' &&
    typeof body.summary === 'string';
}

export async function GET() {
  return Response.json(getNotifyStatus());
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: 'Invalid JSON body.' }, { status: 400 });
  }

  if (!isNotifyPayload(body)) {
    return Response.json({ ok: false, message: 'Invalid notification payload.' }, { status: 400 });
  }

  const payload: NotifyPayload = {
    channel: body.channel,
    title: body.title,
    summary: body.summary,
    reportMarkdown: typeof body.reportMarkdown === 'string' ? body.reportMarkdown : undefined,
    nextActions: Array.isArray(body.nextActions)
      ? body.nextActions.filter((item): item is string => typeof item === 'string')
      : undefined,
  };

  const result = payload.channel === 'slack'
    ? await sendSlackNotification(payload)
    : await sendTelegramNotification(payload);

  return Response.json(result, { status: result.ok ? 200 : 202 });
}
