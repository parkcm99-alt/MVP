import 'server-only';

import type { GoogleMockResult } from './types';

export async function searchDriveFiles(query: string): Promise<GoogleMockResult<{ query: string; files: unknown[] }>> {
  return {
    ok: true,
    mode: 'mock',
    message: 'Google Drive search is scaffolded only. No Google API call was made.',
    data: { query, files: [] },
  };
}

export async function saveReportToDrive(): Promise<GoogleMockResult> {
  return {
    ok: false,
    mode: 'todo',
    message: 'Saving reports to Google Drive will be implemented after OAuth token storage is designed.',
  };
}
