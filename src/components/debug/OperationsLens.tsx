'use client';

import { useLensStore, type LensFilters } from '@/store/lensStore';

const ROLES = ['planner', 'architect', 'developer', 'reviewer', 'qa'] as const;
const STATUSES = ['backlog', 'in_progress', 'review', 'done'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const TRACE_TYPES = ['llm_call', 'handoff', 'decision', 'tool_use'] as const;

export default function OperationsLens() {
  const filters = useLensStore(s => s.filters);
  const setFilter = useLensStore(s => s.setFilter);
  const clear = useLensStore(s => s.clear);
  return (
    <section className="operations-lens" aria-label="Operations Lens filters">
      <strong className="lens-label">⌕ OPERATIONS LENS</strong>
      <input className="lens-input lens-keyword" value={filters.keyword} onChange={e => setFilter('keyword', e.target.value)} placeholder="Keyword..." aria-label="Keyword" />
      <select className="lens-input" value={filters.role} onChange={e => setFilter('role', e.target.value as LensFilters['role'])} aria-label="Agent role">
        <option value="">All roles</option>{ROLES.map(value => <option key={value}>{value}</option>)}
      </select>
      <select className="lens-input" value={filters.status} onChange={e => setFilter('status', e.target.value as LensFilters['status'])} aria-label="Task status">
        <option value="">All statuses</option>{STATUSES.map(value => <option key={value}>{value}</option>)}
      </select>
      <select className="lens-input" value={filters.priority} onChange={e => setFilter('priority', e.target.value as LensFilters['priority'])} aria-label="Priority">
        <option value="">All priorities</option>{PRIORITIES.map(value => <option key={value}>{value}</option>)}
      </select>
      <select className="lens-input" value={filters.traceType} onChange={e => setFilter('traceType', e.target.value as LensFilters['traceType'])} aria-label="Trace type">
        <option value="">All traces</option>{TRACE_TYPES.map(value => <option key={value}>{value}</option>)}
      </select>
      <input className="lens-input lens-session" value={filters.sessionId} onChange={e => setFilter('sessionId', e.target.value)} placeholder="Session ID..." aria-label="Session ID" />
      <button type="button" className="lens-clear" onClick={clear}>CLEAR ALL</button>
    </section>
  );
}
