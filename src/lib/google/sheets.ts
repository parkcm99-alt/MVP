import 'server-only';

import type { GoogleMockResult } from './types';

export async function previewSheetsExport(): Promise<GoogleMockResult> {
  return {
    ok: false,
    mode: 'todo',
    message: 'Google Sheets export is scaffolded only. No append or update call was made.',
  };
}
