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
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';
import { onPersistenceErrorChange } from '@/lib/supabase/errorTracker';

type ConnStatus = 'mock' | 'connecting' | 'ready' | 'partial' | 'error';

const META: Record<ConnStatus, { label: string; color: string }> = {
  mock:       { label: 'MOCK MODE',            color: '#475569' },
  connecting: { label: 'SUPABASE...',           color: '#D97706' },
  ready:      { label: 'SUPABASE LIVE',         color: '#16A34A' },
  partial:    { label: 'SUPABASE PARTIAL ERR',  color: '#CA8A04' },
  error:      { label: 'SUPABASE ERROR',        color: '#DC2626' },
};

export default function ConnectionStatus() {
  const [status, setStatus] = useState<ConnStatus>(() => {
    if (!isSupabaseConfigured)    return 'mock';
    if (!getSupabaseClient())     return 'error';
    return 'connecting';
  });

  // Channel subscription state
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const sb = getSupabaseClient();
    if (!sb) return;

    const ch = sb.channel('_conn_check').subscribe((state) => {
      switch (state) {
        case 'SUBSCRIBED':    setStatus(s => s === 'partial' ? 'partial' : 'ready'); break;
        case 'CHANNEL_ERROR': setStatus('error'); break;
        case 'TIMED_OUT':     setStatus('error'); break;
        case 'CLOSED':        setStatus('error'); break;
      }
    });

    return () => { void sb.removeChannel(ch); };
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
