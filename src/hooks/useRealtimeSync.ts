/**
 * useRealtimeSync — subscribes to Supabase Realtime postgres_changes
 * for all three tables (events, agents, tasks) on a single channel.
 *
 * Duplicate-prevention:
 *   Own session's rows are filtered out — they are already in Zustand
 *   from the local write path (eventBus / persistence.ts).
 *
 * No-loop guarantee:
 *   syncAgent / syncTask write to Zustand WITHOUT calling upsertAgent /
 *   upsertTask, so received rows are never echoed back to Supabase.
 *
 * Graceful degradation:
 *   Returns early when Supabase is not configured (mock mode).
 */

import { useEffect } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { getSessionId } from '@/lib/supabase/session';
import { useSimStore } from '@/store/simulationStore';
import type { EventRow, AgentRow, TaskRow } from '@/lib/supabase/types';
import type { AgentRole, EventType } from '@/types';

export function useRealtimeSync() {
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const sb = getSupabaseClient();
    if (!sb) return;

    const mySession = getSessionId();

    // Capture stable store method references once at subscription time.
    // Zustand actions are stable function references — safe to destructure.
    const { addEvent, syncAgent, syncTask } = useSimStore.getState();

    const channel = sb
      .channel('sim-multiplayer')

      // ── events: display incoming log entries from other sessions ───────────
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'events' },
        ({ new: row }) => {
          const r = row as EventRow;
          if (r.session_id === mySession) return; // own event — already in store
          addEvent({
            agentId:    r.agent_id    as AgentRole,
            agentName:  r.agent_name,
            agentColor: r.agent_color,
            type:       r.type        as EventType,
            message:    r.message,
          });
        },
      )

      // ── agents: sync agent status / position from other sessions ──────────
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'agents' },
        ({ new: row }) => {
          const r = row as AgentRow;
          if (!r?.session_id) return;              // DELETE or malformed — skip
          if (r.session_id === mySession) return;  // own write — already in store
          syncAgent(r);
        },
      )

      // ── tasks: sync task state from other sessions ─────────────────────────
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        ({ new: row }) => {
          const r = row as TaskRow;
          if (!r?.session_id) return;
          if (r.session_id === mySession) return;
          syncTask(r);
        },
      )

      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, []); // subscribe once on mount — deps are all module-level constants
}
