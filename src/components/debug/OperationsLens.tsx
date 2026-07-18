'use client';

import { useLensStore } from '@/store/lensStore';

const fields = [
  ['role', 'Role', ['', 'planner', 'architect', 'developer', 'reviewer', 'qa']],
  ['status', 'Task status', ['', 'backlog', 'in_progress', 'review', 'done']],
  ['priority', 'Priority', ['', 'high', 'medium', 'low']],
  ['traceType', 'Trace type', ['', 'llm_call', 'handoff', 'decision', 'tool_use']],
] as const;

export default function OperationsLens() {
  const { filters, setFilter, clearAll } = useLensStore();
  return (
    <section className="operations-lens" aria-label="Operations Lens">
      <strong>OPERATIONS LENS</strong>
      {fields.map(([key, label, options]) => (
        <select aria-label={label} key={key} value={filters[key]} onChange={event => setFilter(key, event.target.value)}>
          {options.map(value => <option key={value} value={value}>{value || label}</option>)}
        </select>
      ))}
      <input aria-label="Session ID" placeholder="sessionId" value={filters.sessionId} onChange={event => setFilter('sessionId', event.target.value)} />
      <input aria-label="Keyword" placeholder="keyword" value={filters.keyword} onChange={event => setFilter('keyword', event.target.value)} />
      <button type="button" onClick={clearAll}>CLEAR ALL</button>
    </section>
  );
}
