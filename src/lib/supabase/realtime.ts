/**
 * Realtime adapter — swappable between mock (default) and Supabase.
 *
 * MockRealtimeAdapter  — no external calls, app runs in full mock mode
 * SupabaseRealtimeAdapter — inserts events to Supabase + subscribes for
 *   external events (duplicate-safe: own events filtered by session_id)
 *
 * The factory auto-selects based on env vars — no manual switch needed.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from './client';
import { getSessionId, uuid } from './session';
import type { EventRow, EventInsert } from './types';
import type { BusEventType, BusPayload, EventType } from '@/types';

// ── broadcast context — data that eventBus has already computed ───────────────

export interface BroadcastContext {
  message:    string;
  eventType:  EventType;
  agentName:  string;
  agentColor: string;
}

// ── adapter interface ─────────────────────────────────────────────────────────

export interface RealtimeAdapter {
  /**
   * Persist an event to the transport layer.
   * Called after eventBus has already written to Zustand.
   */
  broadcast(
    type:    BusEventType,
    payload: BusPayload,
    context: BroadcastContext,
  ): Promise<void>;

  /**
   * Subscribe to events inserted by OTHER clients (future multiplayer).
   * Our own events are filtered out by session_id to prevent duplicates.
   * Returns an unsubscribe function.
   */
  subscribe(onExternalEvent?: (row: EventRow) => void): () => void;

  readonly isLive: boolean;
}

// ── mock adapter ──────────────────────────────────────────────────────────────

export class MockRealtimeAdapter implements RealtimeAdapter {
  readonly isLive = false;

  async broadcast(): Promise<void> {
    // intentional no-op — Zustand store is the only sink in mock mode
  }

  subscribe(): () => void {
    return () => {};
  }
}

// ── Supabase adapter ──────────────────────────────────────────────────────────

export class SupabaseRealtimeAdapter implements RealtimeAdapter {
  readonly isLive = true;
  private channel: RealtimeChannel | null = null;

  async broadcast(
    _type:   BusEventType,
    payload: BusPayload,
    context: BroadcastContext,
  ): Promise<void> {
    const sb = getSupabaseClient();
    if (!sb) return;

    const row: EventInsert = {
      id:          uuid(),
      session_id:  getSessionId(),
      agent_id:    payload.agentId,
      agent_name:  context.agentName,
      agent_color: context.agentColor,
      type:        context.eventType,
      message:     context.message,
      metadata:    payload.data ?? null,
    };

    const { error } = await sb.from('events').insert(row);

    if (error) {
      // Non-fatal — mock store already received the event
      console.warn('[Supabase] events insert failed:', error.message);
    }
  }

  subscribe(onExternalEvent?: (row: EventRow) => void): () => void {
    const sb = getSupabaseClient();
    if (!sb) return () => {};

    const mySession = getSessionId();

    this.channel = sb
      .channel('sim-events-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        ({ new: row }) => {
          const eventRow = row as EventRow;
          // Skip our own inserts — already in Zustand from eventBus.emit()
          if (eventRow.session_id === mySession) return;
          // External client event (future multiplayer)
          onExternalEvent?.(eventRow);
        },
      )
      .subscribe();

    return () => {
      if (this.channel) {
        void sb.removeChannel(this.channel);
        this.channel = null;
      }
    };
  }
}

// ── factory ───────────────────────────────────────────────────────────────────

export function createRealtimeAdapter(): RealtimeAdapter {
  if (isSupabaseConfigured) return new SupabaseRealtimeAdapter();
  return new MockRealtimeAdapter();
}

/** Module singleton — shared by eventBus and any component that needs it. */
export const realtimeAdapter: RealtimeAdapter = createRealtimeAdapter();
