'use client';

import { isLensActive } from '@/lib/debug/operationsLens';
import { useDebugStore } from '@/store/debugStore';

export default function OperationsLensBar() {
  const filters = useDebugStore(state => state.filters);
  const setFilter = useDebugStore(state => state.setFilter);
  const clearFilters = useDebugStore(state => state.clearFilters);
  const active = isLensActive(filters);

  return (
    <section className="operations-lens" aria-label="Operations Lens">
      <div className="lens-heading">
        <strong>⌕ OPERATIONS LENS</strong>
        <span>{active ? 'DERIVED VIEW · ACTIVE' : 'READ-ONLY DERIVED VIEW'}</span>
      </div>
      <div className="lens-fields">
        <label>role
          <select aria-label="Filter agent role" value={filters.role} onChange={event => setFilter('role', event.target.value as typeof filters.role)}>
            <option value="all">all agents</option>
            <option value="planner">planner</option><option value="architect">architect</option>
            <option value="developer">developer</option><option value="reviewer">reviewer</option><option value="qa">qa</option>
          </select>
        </label>
        <label>status
          <select aria-label="Filter task status" value={filters.taskStatus} onChange={event => setFilter('taskStatus', event.target.value as typeof filters.taskStatus)}>
            <option value="all">all status</option><option value="backlog">backlog</option>
            <option value="in_progress">in progress</option><option value="review">review</option><option value="done">done</option>
          </select>
        </label>
        <label>priority
          <select aria-label="Filter priority" value={filters.priority} onChange={event => setFilter('priority', event.target.value as typeof filters.priority)}>
            <option value="all">all priority</option><option value="high">high</option><option value="medium">medium</option><option value="low">low</option>
          </select>
        </label>
        <label>trace
          <select aria-label="Filter trace type" value={filters.traceType} onChange={event => setFilter('traceType', event.target.value as typeof filters.traceType)}>
            <option value="all">all traces</option><option value="llm_call">llm_call</option><option value="handoff">handoff</option>
            <option value="decision">decision</option><option value="tool_use">tool_use</option>
          </select>
        </label>
        <label className="lens-session">sessionId
          <input aria-label="Filter session ID" value={filters.sessionId} onChange={event => setFilter('sessionId', event.target.value.slice(0, 80))} placeholder="UUID / prefix" spellCheck={false} />
        </label>
        <label className="lens-keyword">keyword
          <input aria-label="Filter keyword" value={filters.keyword} onChange={event => setFilter('keyword', event.target.value.slice(0, 100))} placeholder="task, event, metadata..." />
        </label>
        <button type="button" className="lens-clear" onClick={clearFilters} disabled={!active}>CLEAR ALL</button>
      </div>
    </section>
  );
}
