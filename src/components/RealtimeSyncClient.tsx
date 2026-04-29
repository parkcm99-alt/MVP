'use client';

/**
 * RealtimeSyncClient — mounts the Realtime subscription at the app level.
 * Renders nothing; exists solely to call useRealtimeSync() inside the
 * client component tree (hooks cannot run in Server Components).
 */

import { useRealtimeSync } from '@/hooks/useRealtimeSync';

export default function RealtimeSyncClient() {
  useRealtimeSync();
  return null;
}
