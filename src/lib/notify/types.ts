export type NotifyChannel = 'slack' | 'telegram';
export type NotifyStatus = 'sent' | 'disabled' | 'not_configured' | 'failed';

export interface NotifyPayload {
  channel: NotifyChannel;
  title: string;
  summary: string;
  reportMarkdown?: string;
  nextActions?: string[];
}

export interface NotifyResult {
  ok: boolean;
  channel: NotifyChannel;
  status: NotifyStatus;
  message: string;
}

export interface NotifyChannelState {
  enabled: boolean;
  configured: boolean;
  status: 'ready' | 'disabled' | 'not_configured';
}

export interface NotifyStatusResponse {
  ok: true;
  channels: Record<NotifyChannel, NotifyChannelState>;
}
