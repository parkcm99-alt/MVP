'use client';

import { hasActiveFilters, useOperationsStore } from '@/store/operationsStore';

export default function OperationsLens() {
  const filters = useOperationsStore(state => state.filters);
  const setFilter = useOperationsStore(state => state.setFilter);
  const clear = useOperationsStore(state => state.clearFilters);
  const active = hasActiveFilters(filters);

  return (
    <section className={`operations-lens${active ? ' operations-lens--active' : ''}`} aria-label="Operations Lens">
      <div className="lens-title"><span>◉ OPERATIONS LENS</span><small>read-only</small></div>
      <div className="lens-controls">
        <label><span>ROLE</span><select aria-label="Filter agent role" value={filters.role} onChange={e => setFilter('role', e.target.value as typeof filters.role)}>
          <option value="all">all agents</option>{['planner', 'architect', 'developer', 'reviewer', 'qa'].map(role => <option key={role} value={role}>{role}</option>)}
        </select></label>
        <label><span>STATUS</span><select aria-label="Filter task status" value={filters.status} onChange={e => setFilter('status', e.target.value as typeof filters.status)}>
          <option value="all">all status</option>{['backlog', 'in_progress', 'review', 'done'].map(status => <option key={status} value={status}>{status}</option>)}
        </select></label>
        <label><span>PRIORITY</span><select aria-label="Filter priority" value={filters.priority} onChange={e => setFilter('priority', e.target.value as typeof filters.priority)}>
          <option value="all">all priority</option>{['high', 'medium', 'low'].map(priority => <option key={priority} value={priority}>{priority}</option>)}
        </select></label>
        <label><span>TRACE</span><select aria-label="Filter trace type" value={filters.traceType} onChange={e => setFilter('traceType', e.target.value as typeof filters.traceType)}>
          <option value="all">all traces</option>{['llm_call', 'handoff', 'decision', 'tool_use'].map(type => <option key={type} value={type}>{type}</option>)}
        </select></label>
        <label className="lens-session"><span>SESSION</span><input aria-label="Filter session ID" value={filters.sessionId} onChange={e => setFilter('sessionId', e.target.value.slice(0, 80))} placeholder="session id…" spellCheck={false} /></label>
        <label className="lens-keyword"><span>SEARCH</span><input aria-label="Search operations" value={filters.keyword} onChange={e => setFilter('keyword', e.target.value.slice(0, 120))} placeholder="task, event, metadata…" /></label>
        <button className="lens-clear" type="button" onClick={clear} disabled={!active}>CLEAR ALL</button>
      </div>
    </section>
  );
}
