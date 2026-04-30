'use client';

/**
 * ConnectionStatus — small badge in the app titlebar.
 *
 * States:
 *   MOCK MODE             — NEXT_PUBLIC_SUPABASE_URL not set
 *   SUPABASE LIVE         — channel subscribed, all writes OK
 *   SUPABASE PARTIAL ERR  — channel OK but ≥1 agent/task upsert failed
 *   SUPABASE ERROR        — channel failed or timed out
 */

import { useEffect, useState } from 'react';
import { getSupabaseClient, getSupabaseConfigStatus, isSupabaseConfigured } from '@/lib/supabase/client';
import { onPersistenceErrorChange } from '@/lib/supabase/errorTracker';
import { useDebugStore, type SupabaseDebugStatus } from '@/store/debugStore';

type ConnStatus = SupabaseDebugStatus;

const META: Record<ConnStatus, { label: string; color: string }> = {
  mock:       { label: 'MOCK MODE',            color: '#475569' },
  misconfigured: { label: 'SUPABASE CONFIG ERR', color: '#F97316' },
  connecting: { label: 'SUPABASE...',           color: '#D97706' },
  ready:      { label: 'SUPABASE LIVE',         color: '#16A34A' },
  partial:    { label: 'SUPABASE PARTIAL ERR',  color: '#CA8A04' },
  error:      { label: 'SUPABASE ERROR',        color: '#DC2626' },
};

const CONN_CHECK_TIMEOUT_MS = 8_000;

async function canReachSupabaseRest(): Promise<boolean> {
  const sb = getSupabaseClient();
  if (!sb) return false;

  const { error } = await sb
    .from('events')
    .select('id')
    .limit(1);

  return !error;
}

export default function ConnectionStatus() {
  const setSupabaseStatus = useDebugStore(s => s.setSupabaseStatus);
  const [status, setStatus] = useState<ConnStatus>(() => {
    const configStatus = getSupabaseConfigStatus();
    if (configStatus === 'missing') return 'mock';
    if (configStatus !== 'ready') return 'misconfigured';
    if (!getSupabaseClient())     return 'error';
    return 'connecting';
  });

  useEffect(() => {
    setSupabaseStatus(status);
  }, [setSupabaseStatus, status]);

  // Channel subscription state
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const sb = getSupabaseClient();
    if (!sb) return;

    let cancelled = false;
    let manualClose = false;
    let timeoutId: number | null = null;

    async function verifyRestFallback() {
      const restReachable = await canReachSupabaseRest();
      if (!cancelled) setStatus(restReachable ? 'partial' : 'error');
    }

    timeoutId = window.setTimeout(() => {
      void verifyRestFallback();
    }, CONN_CHECK_TIMEOUT_MS);

    const ch = sb.channel('_conn_check').subscribe((state) => {
      if (cancelled) return;

      switch (state) {
        case 'SUBSCRIBED':
          if (timeoutId) window.clearTimeout(timeoutId);
          setStatus(s => s === 'partial' ? 'partial' : 'ready');
          break;
        case 'CHANNEL_ERROR':
        case 'TIMED_OUT':
          if (timeoutId) window.clearTimeout(timeoutId);
          void verifyRestFallback();
          break;
        case 'CLOSED':
          if (!manualClose) void verifyRestFallback();
          break;
      }
    });

    return () => {
      cancelled = true;
      manualClose = true;
      if (timeoutId) window.clearTimeout(timeoutId);
      void sb.removeChannel(ch);
    };
  }, []);

  // Persistence error subscription — setStatus only called from the async callback,
  // never synchronously in the effect body (avoids react-hooks/set-state-in-effect)
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    return onPersistenceErrorChange(() => {
      setStatus(s => s === 'ready' || s === 'connecting' ? 'partial' : s);
    });
  }, []);

  const { label, color } = META[status];

  return (
    <div className="conn-status">
      <span
        className={`conn-dot${status === 'ready' ? ' conn-dot--live' : ''}`}
        style={{ background: color }}
      />
      <span style={{ color }}>{label}</span>
    </div>
  );
}
