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

function number(value: number | null, suffix = '') { return typeof value === 'number' ? `${value}${suffix}` : '—'; }

export default function DebugPanel() {
  const [open, setOpen] = useState(false);
  const status = useDebugStore(state => state.supabaseStatus);
  const latest = useDebugStore(state => state.latest);
  const meta = SUPABASE_META[status];
  return (
    <section className={`debug-panel${open ? ' debug-panel--open' : ' debug-panel--collapsed'}`}>
      <div className="debug-panel-header">
        <span>◈ DEBUG & TRACE</span>
        <button className="panel-collapse-btn" type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? 'CLOSE ✕' : 'OPEN ↗'}</button>
      </div>
      {open && <div className="debug-panel-body">
        <div className="debug-overview">
          <div className="debug-row"><span>Supabase</span><strong style={{ color: meta.color }}>{meta.label}</strong></div>
          <div className="debug-row"><span>LLM provider</span><strong className={latest.provider === 'mock' ? 'debug-value-warning' : latest.provider === 'claude' ? 'debug-value-live' : 'debug-value-muted'}>{latest.provider ?? '—'}{latest.role ? ` · ${latest.role}` : ''}</strong></div>
          <div className="debug-row"><span>Last call</span><strong>{latest.lastCallAt ? `${formatKstTime(latest.lastCallAt)} KST` : '—'}</strong></div>
          <div className="debug-row"><span>traceRecorded</span><strong className={latest.traceRecorded === false ? 'debug-value-warning' : latest.traceRecorded ? 'debug-value-live' : 'debug-value-muted'}>{latest.traceRecorded === null ? '—' : latest.traceRecorded ? 'true' : 'false · Trace not recorded'}</strong></div>
          <div className="debug-row debug-row-wide"><span>last model</span><strong>{latest.model ?? '—'}</strong></div>
          <div className="debug-metrics"><div><span>latency_ms</span><strong>{number(latest.latencyMs, 'ms')}</strong></div><div><span>input_tokens</span><strong>{number(latest.inputTokens)}</strong></div><div><span>output_tokens</span><strong>{number(latest.outputTokens)}</strong></div></div>
        </div>
        <AgentTraceViewer refreshKey={latest.lastCallAt} />
      </div>}
    </section>
  );
}
