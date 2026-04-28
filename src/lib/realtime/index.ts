/**
 * Supabase Realtime integration stub.
 *
 * Future wiring:
 *   import { createClient } from '@supabase/supabase-js';
 *   const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
 *
 * Channels:
 *   - 'agent-state'  → broadcast agent status/position updates
 *   - 'task-updates' → postgres changes on tasks table
 *   - 'event-stream' → broadcast simulation events to all clients
 */

import type { RealtimePayload } from '@/types';

export type RealtimeHandler = (payload: RealtimePayload) => void;

export interface RealtimeChannel {
  subscribe: () => void;
  unsubscribe: () => void;
  send: (payload: RealtimePayload) => void;
}

/** @stub Returns a mock channel that does nothing */
export function createAgentChannel(handler: RealtimeHandler): RealtimeChannel {
  void handler; // stub — supabase.channel('agent-state').on(..., handler) when connected
  return {
    subscribe:   () => { /* connect supabase channel */ },
    unsubscribe: () => { /* disconnect */ },
    send:        () => { /* broadcast to peers */ },
  };
}

/** @stub Persist simulation event to Supabase */
export async function persistEvent(payload: RealtimePayload): Promise<void> {
  void payload; // stub — supabase.from('sim_events').insert(payload.data) when connected
}
