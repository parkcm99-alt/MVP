/**
 * Realtime adapter — swappable between mock (default) and Supabase.
 *
 * The adapter decouples the event bus from the transport layer.
 * When Supabase is configured, SupabaseRealtimeAdapter handles broadcast;
 * otherwise MockRealtimeAdapter is a silent no-op so the app runs unchanged.
 *
 * Wiring checklist (Milestone 3):
 *   1. Create Supabase project and set env vars in .env.local
 *   2. Run schema migration (see docs/supabase-schema.md)
 *   3. The factory below auto-selects SupabaseRealtimeAdapter — no other code changes needed
 */

import { getSupabaseClient, isSupabaseConfigured } from './client';
import type { BusEventType, BusPayload } from '@/types';

// ── adapter interface ─────────────────────────────────────────────────────────

export interface RealtimeAdapter {
  /** Broadcast an event to all connected clients via the transport layer. */
  broadcast(type: BusEventType, payload: BusPayload): Promise<void>;

  /**
   * Subscribe to incoming events from other clients.
   * Returns an unsubscribe function.
   */
  subscribe(callback: (type: BusEventType, payload: BusPayload) => void): () => void;

  /** Whether this adapter is backed by a real transport (non-mock). */
  readonly isLive: boolean;
}

// ── mock adapter (default — no external calls) ────────────────────────────────

export class MockRealtimeAdapter implements RealtimeAdapter {
  readonly isLive = false;

  async broadcast(): Promise<void> {
    // no-op in mock mode — eventBus already writes directly to Zustand store
  }

  subscribe(): () => void {
    return () => {};  // no-op unsubscribe
  }
}

// ── Supabase adapter (stub — implemented when env vars are present) ───────────

export class SupabaseRealtimeAdapter implements RealtimeAdapter {
  readonly isLive = true;

  async broadcast(type: BusEventType, payload: BusPayload): Promise<void> {
    const sb = getSupabaseClient();
    if (!sb) return;

    // TODO (Milestone 3): replace stub with real broadcast
    // await sb
    //   .channel('sim-events')
    //   .send({ type: 'broadcast', event: type, payload });
    void type;
    void payload;
  }

  subscribe(callback: (type: BusEventType, payload: BusPayload) => void): () => void {
    const sb = getSupabaseClient();
    if (!sb) return () => {};

    // TODO (Milestone 3): replace stub with real subscription
    // const channel = sb
    //   .channel('sim-events')
    //   .on('broadcast', { event: '*' }, ({ event, payload }) => {
    //     callback(event as BusEventType, payload as BusPayload);
    //   })
    //   .subscribe();
    // return () => { void sb.removeChannel(channel); };

    void callback;
    return () => {};
  }
}

// ── factory — auto-selects adapter based on env config ────────────────────────

export function createRealtimeAdapter(): RealtimeAdapter {
  if (isSupabaseConfigured) return new SupabaseRealtimeAdapter();
  return new MockRealtimeAdapter();
}

/** Module-level singleton — shared across the event bus. */
export const realtimeAdapter: RealtimeAdapter = createRealtimeAdapter();
