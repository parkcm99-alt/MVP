'use client';

import { useCallback, useEffect, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AgentTraceRow } from '@/lib/supabase/types';
import { formatKstTime } from '@/lib/time';

type TraceLoadState = 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';

interface AgentTraceViewerProps {
  refreshKey?: number | null;
}

const TRACE_LIMIT = 30;
const SENSITIVE_METADATA_KEY = /api|auth|authorization|credential|key|password|secret|token/i;

function formatNullableNumber(value: number | null, suffix = ''): string {
  return typeof value === 'number' ? `${value}${suffix}` : '—';
}

function getTraceBadgeClass(traceType: string): string {
  switch (traceType) {
    case 'llm_call':
      return 'trace-badge--llm';
    case 'handoff':
      return 'trace-badge--handoff';
    case 'decision':
      return 'trace-badge--decision';
    case 'tool_use':
      return 'trace-badge--tool';
    default:
      return 'trace-badge--unknown';
  }
}

function summarizeValue(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'string') return value.length > 42 ? `${value.slice(0, 39)}...` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.length} items]`;
  if (typeof value === 'object') return '{...}';
  return null;
}

function summarizeMetadata(metadata: AgentTraceRow['metadata']): string {
  if (!metadata) return 'metadata —';

  const parts = Object.entries(metadata)
    .filter(([key]) => !SENSITIVE_METADATA_KEY.test(key))
    .map(([key, value]) => {
      const summary = summarizeValue(value);
      return summary ? `${key}: ${summary}` : null;
    })
    .filter((part): part is string => Boolean(part))
    .slice(0, 3);

  if (parts.length === 0) return 'metadata redacted';
  return parts.join(' · ');
}

function getStatusLabel(status: TraceLoadState, count: number): string {
  if (status === 'loading') return 'Loading traces...';
  if (status === 'unavailable') return 'Supabase unavailable';
  if (status === 'error') return 'Trace query failed';
  if (status === 'ready') return `${count} recent traces`;
  return 'Ready';
}

export default function AgentTraceViewer({ refreshKey = null }: AgentTraceViewerProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [status, setStatus] = useState<TraceLoadState>('idle');
  const [traces, setTraces] = useState<AgentTraceRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  const loadTraces = useCallback(async () => {
    const supabase = getSupabaseClient();

    if (!supabase) {
      setStatus('unavailable');
      setMessage('Supabase client is not configured.');
      setTraces([]);
      return;
    }

    setStatus('loading');
    setMessage(null);

    const { data, error } = await supabase
      .from('agent_traces')
      .select('id,session_id,agent_id,trace_type,input_tokens,output_tokens,latency_ms,model,metadata,created_at')
      .order('created_at', { ascending: false })
      .limit(TRACE_LIMIT);

    if (error) {
      console.warn('[Supabase] agent_traces query failed:', error.message);
      setStatus('error');
      setMessage('Could not load agent traces.');
      setTraces([]);
      return;
    }

    setTraces((data ?? []) as AgentTraceRow[]);
    setLastLoadedAt(Date.now());
    setStatus('ready');
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadTraces();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadTraces, refreshKey]);

  return (
    <section className={`trace-viewer${collapsed ? ' trace-viewer--collapsed' : ''}`}>
      <div className="trace-viewer-header">
        <button
          className="trace-viewer-toggle"
          type="button"
          onClick={() => setCollapsed(value => !value)}
          aria-expanded={!collapsed}
        >
          <span>AGENT TRACE VIEWER</span>
          <strong>{traces.length}/{TRACE_LIMIT}</strong>
        </button>
        <button
          className="trace-refresh-btn"
          type="button"
          onClick={() => void loadTraces()}
          disabled={status === 'loading'}
        >
          {status === 'loading' ? 'LOADING' : 'REFRESH'}
        </button>
      </div>

      {!collapsed && (
        <div className="trace-viewer-body">
          <div className="trace-viewer-meta">
            <span>{getStatusLabel(status, traces.length)}</span>
            <span>{lastLoadedAt ? `${formatKstTime(lastLoadedAt)} KST` : 'not loaded'}</span>
          </div>

          {message && <div className={`trace-message trace-message--${status}`}>{message}</div>}

          {traces.length === 0 && !message ? (
            <div className="trace-empty">No traces yet.</div>
          ) : (
            <div className="trace-list">
              {traces.map(trace => (
                <article className="trace-card" key={trace.id}>
                  <div className="trace-card-top">
                    <span className={`trace-badge ${getTraceBadgeClass(trace.trace_type)}`}>
                      {trace.trace_type}
                    </span>
                    <strong>{trace.agent_id}</strong>
                    <time>{formatKstTime(trace.created_at)} KST</time>
                  </div>

                  <div className="trace-card-metrics">
                    <span title={trace.model ?? undefined}>{trace.model ?? 'model —'}</span>
                    <span>{formatNullableNumber(trace.latency_ms, 'ms')}</span>
                    <span>in {formatNullableNumber(trace.input_tokens)}</span>
                    <span>out {formatNullableNumber(trace.output_tokens)}</span>
                  </div>

                  <p>{summarizeMetadata(trace.metadata)}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
