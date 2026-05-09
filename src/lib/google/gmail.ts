import 'server-only';

import type { GoogleMockResult } from './types';

export async function searchGmailMessages(query: string): Promise<GoogleMockResult<{ query: string; messages: unknown[] }>> {
  return {
    ok: true,
    mode: 'mock',
    message: 'Gmail read/search is scaffolded only. No Gmail API call was made.',
    data: { query, messages: [] },
  };
}

export async function readGmailMessage(id: string): Promise<GoogleMockResult<{ id: string }>> {
  return {
    ok: true,
    mode: 'mock',
    message: 'Gmail read is scaffolded only. Sending, deleting, and archiving are intentionally not implemented.',
    data: { id },
  };
}
