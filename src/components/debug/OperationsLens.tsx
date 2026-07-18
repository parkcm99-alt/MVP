'use client';

import { useLensStore } from '@/store/lensStore';
import type { AgentRole, TaskPriority, TaskStatus } from '@/types';
import type { AgentTraceType } from '@/lib/supabase/traces';

export default function OperationsLens() {
  const filters = useLensStore(state => state.filters);
  const setFilter = useLensStore(state => state.setFilter);
  const clear = useLensStore(state => state.clear);

  return (
    <section className="operations-lens" aria-label="Operations Lens">
      <div className="lens-heading">
        <span>◉ OPERATIONS LENS</span>
        <span className="lens-hint">read-only shared view</span>
      </div>
      <div className="lens-controls">
        <label>
          <span>ROLE</span>
          <select aria-label="Filter agent role" value={filters.role} onChange={event => setFilter('role', event.target.value as AgentRole | 'all')}>
            <option value="all">All agents</option>
            {(['planner', 'architect', 'developer', 'reviewer', 'qa'] as AgentRole[]).map(role => <option key={role} value={role}>{role}</option>)}
          </select>
        </label>
        <label>
          <span>STATUS</span>
          <select aria-label="Filter task status" value={filters.taskStatus} onChange={event => setFilter('taskStatus', event.target.value as TaskStatus | 'all')}>
            <option value="all">All status</option>
            {(['backlog', 'in_progress', 'review', 'done'] as TaskStatus[]).map(status => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>
          <span>PRIORITY</span>
          <select aria-label="Filter priority" value={filters.priority} onChange={event => setFilter('priority', event.target.value as TaskPriority | 'all')}>
            <option value="all">All priority</option>
            {(['high', 'medium', 'low'] as TaskPriority[]).map(priority => <option key={priority} value={priority}>{priority}</option>)}
          </select>
        </label>
        <label>
          <span>TRACE</span>
          <select aria-label="Filter trace type" value={filters.traceType} onChange={event => setFilter('traceType', event.target.value as AgentTraceType | 'all')}>
            <option value="all">All traces</option>
            {(['llm_call', 'handoff', 'decision', 'tool_use'] as AgentTraceType[]).map(type => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="lens-session-field">
          <span>SESSION</span>
          <input aria-label="Filter session ID" value={filters.sessionId} onChange={event => setFilter('sessionId', event.target.value.slice(0, 64))} placeholder="session id..." />
        </label>
        <label className="lens-keyword-field">
          <span>KEYWORD</span>
          <input aria-label="Filter keyword" value={filters.keyword} onChange={event => setFilter('keyword', event.target.value.slice(0, 100))} placeholder="task, event, trace..." />
        </label>
        <button className="lens-clear-btn" type="button" onClick={clear}>Clear all</button>
      </div>
    </section>
  );
}
