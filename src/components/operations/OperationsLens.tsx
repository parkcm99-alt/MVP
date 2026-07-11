'use client';

import type { ChangeEvent } from 'react';
import { useOperationsLensStore, type OperationsLensFilters } from '@/store/operationsLensStore';

const ROLES = ['planner', 'architect', 'developer', 'reviewer', 'qa'];
const STATUSES = ['backlog', 'in_progress', 'review', 'done'];
const PRIORITIES = ['low', 'medium', 'high'];
const TRACE_TYPES = ['llm_call', 'handoff', 'decision', 'tool_use'];

export default function OperationsLens() {
  const filters = {
    agentRole: useOperationsLensStore(s => s.agentRole),
    taskStatus: useOperationsLensStore(s => s.taskStatus),
    priority: useOperationsLensStore(s => s.priority),
    traceType: useOperationsLensStore(s => s.traceType),
    sessionId: useOperationsLensStore(s => s.sessionId),
    keyword: useOperationsLensStore(s => s.keyword),
  };
  const setFilter = useOperationsLensStore(s => s.setFilter);
  const clearAll = useOperationsLensStore(s => s.clearAll);
  const select = (label: string, key: keyof OperationsLensFilters, values: string[]) => (
    <label>{label}<select value={filters[key]} onChange={(e: ChangeEvent<HTMLSelectElement>) => setFilter(key, e.target.value)}>
      <option value="">ALL</option>{values.map(value => <option key={value}>{value}</option>)}
    </select></label>
  );
  return <section className="operations-lens">
    <strong>🔎 OPERATIONS LENS</strong>
    {select('ROLE', 'agentRole', ROLES)}
    {select('STATUS', 'taskStatus', STATUSES)}
    {select('PRIORITY', 'priority', PRIORITIES)}
    {select('TRACE', 'traceType', TRACE_TYPES)}
    <label>SESSION<input value={filters.sessionId} onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter('sessionId', e.target.value)} placeholder="session id" /></label>
    <label className="lens-keyword">KEYWORD<input value={filters.keyword} onChange={(e: ChangeEvent<HTMLInputElement>) => setFilter('keyword', e.target.value)} placeholder="search task/event/trace" /></label>
    <button type="button" onClick={clearAll}>CLEAR ALL</button>
  </section>;
}
