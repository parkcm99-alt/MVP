import type { NotifyPayload } from './types';

const MAX_REPORT_CHARS = 2200;

function trimBlock(value: string, maxLength: number): string {
  const compact = value.replace(/\n{3,}/g, '\n\n').trim();
  return compact.length > maxLength ? `${compact.slice(0, maxLength).trim()}...` : compact;
}

export function formatNotificationText(payload: NotifyPayload): string {
  const nextActions = payload.nextActions?.filter(Boolean).slice(0, 5) ?? [];
  const actionBlock = nextActions.length > 0
    ? `\n\nNext Actions\n${nextActions.map((action, index) => `${index + 1}. ${action}`).join('\n')}`
    : '';
  const reportBlock = payload.reportMarkdown
    ? `\n\nReport Preview\n${trimBlock(payload.reportMarkdown, MAX_REPORT_CHARS)}`
    : '';

  return [
    `AI Agent Office Report: ${payload.title}`,
    '',
    trimBlock(payload.summary, 700),
    actionBlock,
    reportBlock,
  ].join('\n').trim();
}
