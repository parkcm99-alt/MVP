'use client';

import { hasActiveFilters } from '@/lib/debug/lens';
import { useOperationsStore, type LensFilters } from '@/store/operationsStore';

export default function OperationsLens() {
  const filters = useOperationsStore(state => state.filters);
  const setFilter = useOperationsStore(state => state.setFilter);
  const clearFilters = useOperationsStore(state => state.clearFilters);

  return (
    <section className="operations-lens" aria-label="Operations Lens">
      <strong className="lens-label">⌕ OPERATIONS LENS</strong>
      <select aria-label="Filter agent role" value={filters.role} onChange={event => setFilter('role', event.target.value as LensFilters['role'])}>
        <option value="all">All roles</option>
        {['planner', 'architect', 'developer', 'reviewer', 'qa'].map(role => <option key={role}>{role}</option>)}
      </select>
      <select aria-label="Filter task status" value={filters.status} onChange={event => setFilter('status', event.target.value as LensFilters['status'])}>
        <option value="all">All status</option>
        {['backlog', 'in_progress', 'review', 'done'].map(status => <option key={status}>{status}</option>)}
      </select>
      <select aria-label="Filter priority" value={filters.priority} onChange={event => setFilter('priority', event.target.value as LensFilters['priority'])}>
        <option value="all">All priority</option>
        {['high', 'medium', 'low'].map(priority => <option key={priority}>{priority}</option>)}
      </select>
      <select aria-label="Filter trace type" value={filters.traceType} onChange={event => setFilter('traceType', event.target.value as LensFilters['traceType'])}>
        <option value="all">All traces</option>
        {['llm_call', 'handoff', 'decision', 'tool_use'].map(type => <option key={type}>{type}</option>)}
      </select>
      <input aria-label="Filter session ID" value={filters.sessionId} onChange={event => setFilter('sessionId', event.target.value.slice(0, 80))} placeholder="session ID" />
      <input className="lens-keyword" aria-label="Filter keyword" value={filters.keyword} onChange={event => setFilter('keyword', event.target.value.slice(0, 100))} placeholder="keyword…" />
      <button type="button" className="lens-clear" onClick={clearFilters} disabled={!hasActiveFilters(filters)}>CLEAR ALL</button>
    </section>
  );
}
