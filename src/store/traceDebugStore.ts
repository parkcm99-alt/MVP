import { create } from 'zustand';
import { getSessionId } from '@/lib/supabase/session';
import type { AgentTraceRow } from '@/lib/supabase/types';

interface TraceDebugStore {
  localTraces: AgentTraceRow[];
  remoteTraces: AgentTraceRow[];
  highlightedTaskTitles: string[];
  findingSignatures: string[];
  addLocalTrace: (trace: Pick<AgentTraceRow, 'agent_id' | 'trace_type'> & Partial<AgentTraceRow>) => void;
  setRemoteTraces: (traces: AgentTraceRow[]) => void;
  setHighlightedTaskTitles: (titles: string[]) => void;
  claimFinding: (signature: string) => boolean;
}

export const useTraceDebugStore = create<TraceDebugStore>((set) => ({
  localTraces: [],
  remoteTraces: [],
  highlightedTaskTitles: [],
  findingSignatures: [],
  addLocalTrace: (trace) => set(state => ({
    localTraces: [{
      id: trace.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      session_id: trace.session_id ?? getSessionId(),
      agent_id: trace.agent_id,
      trace_type: trace.trace_type,
      input_tokens: trace.input_tokens ?? null,
      output_tokens: trace.output_tokens ?? null,
      latency_ms: trace.latency_ms ?? null,
      model: trace.model ?? null,
      metadata: trace.metadata ?? null,
      created_at: trace.created_at ?? new Date().toISOString(),
    }, ...state.localTraces].slice(0, 100),
  })),
  setRemoteTraces: (remoteTraces) => set({ remoteTraces: remoteTraces.slice(0, 100) }),
  setHighlightedTaskTitles: (highlightedTaskTitles) => set({ highlightedTaskTitles }),
  claimFinding: (signature) => {
    let claimed = false;
    set(state => {
      if (state.findingSignatures.includes(signature)) return state;
      claimed = true;
      return { findingSignatures: [...state.findingSignatures, signature].slice(-200) };
    });
    return claimed;
  },
}));
