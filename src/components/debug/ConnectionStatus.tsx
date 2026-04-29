'use client';

/**
 * ConnectionStatus — small badge in the app titlebar.
 *
 * States:
 *   MOCK MODE      — NEXT_PUBLIC_SUPABASE_URL not set, app runs in full mock
 *   SUPABASE LIVE  — Realtime channel subscribed successfully
 *   SUPABASE ERROR — channel failed or timed out
 *
 * Only shown in development (process.env.NODE_ENV === 'development').
 * Remove the guard below to show it in production too.
 */

import { useEffect, useState } from 'react';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/client';

type ConnStatus = 'mock' | 'connecting' | 'ready' | 'error';

const META: Record<ConnStatus, { label: string; color: string }> = {
  mock:       { label: 'MOCK MODE',      color: '#475569' },
  connecting: { label: 'SUPABASE...',    color: '#D97706' },
  ready:      { label: 'SUPABASE LIVE',  color: '#16A34A' },
  error:      { label: 'SUPABASE ERROR', color: '#DC2626' },
};

export default function ConnectionStatus() {
  // Initialise synchronously so the effect never needs to call setStatus(error)
  // for the !sb case (avoids ESLint react-hooks/set-state-in-effect)
  const [status, setStatus] = useState<ConnStatus>(() => {
    if (!isSupabaseConfigured)    return 'mock';
    if (!getSupabaseClient())     return 'error'; // env set but client failed
    return 'connecting';
  });

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const sb = getSupabaseClient();
    if (!sb) return; // initial state already set to 'error'

    const ch = sb.channel('_conn_check').subscribe((state) => {
      switch (state) {
        case 'SUBSCRIBED':    setStatus('ready');   break;
        case 'CHANNEL_ERROR': setStatus('error');   break;
        case 'TIMED_OUT':     setStatus('error');   break;
        case 'CLOSED':        setStatus('error');   break;
      }
    });

    return () => { void sb.removeChannel(ch); };
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
