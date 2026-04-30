'use client';

import { useState } from 'react';
import { formatKstTime } from '@/lib/time';
import { useDebugStore, type SupabaseDebugStatus } from '@/store/debugStore';

const SUPABASE_META: Record<SupabaseDebugStatus, { label: string; color: string }> = {
  mock:       { label: 'mock', color: '#64748B' },
  misconfigured: { label: 'config error', color: '#F97316' },
  connecting: { label: 'connecting', color: '#D97706' },
  ready:      { label: 'live', color: '#22C55E' },
  partial:    { label: 'partial', color: '#F59E0B' },
  error:      { label: 'error', color: '#EF4444' },
};

function formatNullableNumber(value: number | null, suffix = ''): string {
  return typeof value === 'number' ? `${value}${suffix}` : '—';
}

function formatTraceRecorded(value: boolean | null): string {
  if (value === null) return '—';
  return value ? 'true' : 'false · Trace not recorded';
}

function getProviderClass(provider: string | null): string {
  if (provider === 'claude') return 'debug-value-live';
  if (provider === 'mock') return 'debug-value-warning';
  return 'debug-value-muted';
}

function getTraceClass(value: boolean | null): string {
  if (value === true) return 'debug-value-live';
  if (value === false) return 'debug-value-warning';
  return 'debug-value-muted';
}

export default function DebugPanel() {
  const [collapsed, setCollapsed] = useState(false);
  const supabaseStatus = useDebugStore(s => s.supabaseStatus);
  const lastLlm = useDebugStore(s => s.lastLlm);
  const supabaseMeta = SUPABASE_META[supabaseStatus];

  return (
    <section className={`debug-panel${collapsed ? ' debug-panel--collapsed' : ''}`}>
      <div className="debug-panel-header">
        <span>DEBUG PANEL</span>
        <button
          className="panel-collapse-btn"
          type="button"
          onClick={() => setCollapsed(v => !v)}
          aria-expanded={!collapsed}
        >
          {collapsed ? 'OPEN' : 'CLOSE'}
        </button>
      </div>

      {!collapsed && (
        <div className="debug-panel-body">
          <div className="debug-row">
            <span>Supabase</span>
            <strong style={{ color: supabaseMeta.color }}>{supabaseMeta.label}</strong>
          </div>
          <div className="debug-row">
            <span>LLM provider</span>
            <strong className={getProviderClass(lastLlm.provider)}>
              {lastLlm.provider ?? '—'}
            </strong>
          </div>
          <div className="debug-row">
            <span>Last LLM</span>
            <strong>{lastLlm.lastPlanAt ? `${formatKstTime(lastLlm.lastPlanAt)} · ${lastLlm.agentId ?? 'agent'}` : '—'}</strong>
          </div>
          <div className="debug-row">
            <span>traceRecorded</span>
            <strong className={getTraceClass(lastLlm.traceRecorded)}>
              {formatTraceRecorded(lastLlm.traceRecorded)}
            </strong>
          </div>
          <div className="debug-row debug-row-wide">
            <span>last model</span>
            <strong>{lastLlm.model ?? '—'}</strong>
          </div>
          <div className="debug-metrics">
            <div>
              <span>latency_ms</span>
              <strong>{formatNullableNumber(lastLlm.latencyMs, 'ms')}</strong>
            </div>
            <div>
              <span>input_tokens</span>
              <strong>{formatNullableNumber(lastLlm.inputTokens)}</strong>
            </div>
            <div>
              <span>output_tokens</span>
              <strong>{formatNullableNumber(lastLlm.outputTokens)}</strong>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
