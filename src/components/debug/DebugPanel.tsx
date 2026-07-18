'use client';

import { useState } from 'react';
import AgentTraceViewer from '@/components/debug/AgentTraceViewer';
import { formatKstTime } from '@/lib/time';
import { useDebugStore, type SupabaseDebugStatus } from '@/store/debugStore';

const SUPABASE_META: Record<SupabaseDebugStatus, { label: string; color: string }> = {
  mock: { label: 'mock', color: '#64748B' }, misconfigured: { label: 'config error', color: '#F97316' },
  connecting: { label: 'connecting', color: '#D97706' }, ready: { label: 'live', color: '#22C55E' },
  partial: { label: 'partial', color: '#F59E0B' }, error: { label: 'error', color: '#EF4444' },
};
function number(value: number | null, suffix = ''): string { return typeof value === 'number' ? `${value}${suffix}` : '—'; }

export default function DebugPanel() {
  const [collapsed, setCollapsed] = useState(true);
  const supabaseStatus = useDebugStore(s => s.supabaseStatus);
  const last = useDebugStore(s => s.lastAgent);
  const meta = SUPABASE_META[supabaseStatus];
  return <section className={`debug-panel${collapsed ? ' debug-panel--collapsed' : ''}`}>
    <div className="debug-panel-header"><span>⚙ DEBUG + TRACE CORRELATION</span><button className="panel-collapse-btn" type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}>{collapsed ? 'OPEN' : 'CLOSE'}</button></div>
    {!collapsed && <div className="debug-panel-body">
      <div className="debug-summary-grid">
        <div className="debug-row"><span>Supabase</span><strong style={{ color: meta.color }}>{meta.label}</strong></div>
        <div className="debug-row"><span>LLM provider</span><strong className={last.provider === 'mock' ? 'debug-value-warning' : last.provider === 'claude' ? 'debug-value-live' : 'debug-value-muted'}>{last.provider ?? '—'}</strong></div>
        <div className="debug-row"><span>Last Ask</span><strong>{last.role ? `${last.role} · ${last.lastCallAt ? formatKstTime(last.lastCallAt) : '—'}` : '—'}</strong></div>
        <div className="debug-row"><span>traceRecorded</span><strong className={last.traceRecorded === false ? 'debug-value-warning' : last.traceRecorded ? 'debug-value-live' : 'debug-value-muted'}>{last.traceRecorded === null ? '—' : last.traceRecorded ? 'true' : 'false · Trace not recorded'}</strong></div>
        <div className="debug-row debug-row-wide"><span>last model</span><strong>{last.model ?? '—'}</strong></div>
        <div className="debug-row"><span>latency_ms</span><strong>{number(last.latencyMs, 'ms')}</strong></div>
        <div className="debug-row"><span>input_tokens</span><strong>{number(last.inputTokens)}</strong></div>
        <div className="debug-row"><span>output_tokens</span><strong>{number(last.outputTokens)}</strong></div>
      </div>
      <AgentTraceViewer refreshKey={last.lastCallAt} />
    </div>}
  </section>;
}
