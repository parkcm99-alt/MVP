'use client';

import { useMemo } from 'react';
import { applyOperationsLens } from '@/lib/debug/operationsLens';
import { mergeTraces } from '@/lib/debug/traceDebugger';
import { useDebugStore } from '@/store/debugStore';
import { useLensStore } from '@/store/lensStore';
import { useSimStore } from '@/store/simulationStore';

/** Shared derived view. The Lens never writes to simulation or Supabase state. */
export function useOperationsData() {
  const filters = useLensStore(state => state.filters);
  const tasks = useSimStore(state => state.tasks);
  const events = useSimStore(state => state.events);
  const remoteTraces = useDebugStore(state => state.remoteTraces);
  const localTraces = useDebugStore(state => state.localTraces);
  const traces = useMemo(() => mergeTraces(remoteTraces, localTraces), [remoteTraces, localTraces]);
  const filtered = useMemo(
    () => applyOperationsLens(filters, tasks, events, traces),
    [filters, tasks, events, traces],
  );
  return { filters, tasks, events, traces, filtered };
}
