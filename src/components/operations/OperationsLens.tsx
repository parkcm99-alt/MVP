'use client';

import { useOperationsLens } from '@/store/operationsLensStore';

const ROLES = ['planner', 'architect', 'developer', 'reviewer', 'qa', 'secretary'];
const STATUSES = ['backlog', 'in_progress', 'review', 'done'];
const PRIORITIES = ['high', 'medium', 'low'];
const TRACE_TYPES = ['llm_call', 'handoff', 'decision', 'tool_use'];

export default function OperationsLens() {
  const filters = useOperationsLens(state => state.filters);
  const set = useOperationsLens(state => state.set);
  const clear = useOperationsLens(state => state.clear);
  const activeCount = Object.values(filters).filter(value => value.trim()).length;

  return (
    <div className="operations-lens" role="search" aria-label="Operations Lens">
      <b>OPERATIONS LENS{activeCount ? ` · ${activeCount} ACTIVE` : ''}</b>
      <select aria-label="Agent role" value={filters.role} onChange={event => set({ role: event.target.value })}>
        <option value="">All agents</option>
        {ROLES.map(value => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Task status" value={filters.status} onChange={event => set({ status: event.target.value })}>
        <option value="">All status</option>
        {STATUSES.map(value => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Priority" value={filters.priority} onChange={event => set({ priority: event.target.value })}>
        <option value="">All priority</option>
        {PRIORITIES.map(value => <option key={value}>{value}</option>)}
      </select>
      <select aria-label="Trace type" value={filters.traceType} onChange={event => set({ traceType: event.target.value })}>
        <option value="">All traces</option>
        {TRACE_TYPES.map(value => <option key={value}>{value}</option>)}
      </select>
      <input aria-label="Session ID" value={filters.sessionId} onChange={event => set({ sessionId: event.target.value })} placeholder="sessionId" />
      <input aria-label="Keyword" value={filters.keyword} onChange={event => set({ keyword: event.target.value })} placeholder="keyword" />
      <button type="button" onClick={clear} disabled={!activeCount}>Clear all</button>
    </div>
  );
}
