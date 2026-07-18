import { useMemo } from 'react';
import { applyOperationsLens } from '@/lib/debug/operationsLens';
import { mergeRecentTraces } from '@/lib/debug/correlation';
import { useDebugStore } from '@/store/debugStore';
import { useSimStore } from '@/store/simulationStore';

export function useOperationsLens() {
  const liveTasks = useSimStore(state => state.tasks);
  const liveEvents = useSimStore(state => state.events);
  const remote = useDebugStore(state => state.remoteTraces);
  const local = useDebugStore(state => state.localTraces);
  const imported = useDebugStore(state => state.importedBundle);
  const filters = useDebugStore(state => state.filters);

  const traces = useMemo(() => imported?.traces ?? mergeRecentTraces(remote, local), [imported, remote, local]);
  // Imported evidence is deliberately isolated from writable live store panels.
  const analysisTasks = imported?.tasks ?? liveTasks;
  const analysisEvents = imported?.events ?? liveEvents;
  const result = useMemo(
    () => applyOperationsLens(analysisTasks, analysisEvents, traces, filters),
    [analysisTasks, analysisEvents, traces, filters],
  );
  // In import mode the visible panels become read-only evidence views too.
  // The writable simulation arrays remain untouched underneath and are restored on exit.
  return {
    ...result,
    liveTasks: result.tasks,
    liveEvents: result.events,
    allTasks: analysisTasks,
    allEvents: analysisEvents,
    allTraces: traces,
    liveTaskTotal: analysisTasks.length,
    liveEventTotal: analysisEvents.length,
    filters,
    imported: Boolean(imported),
  };
}
