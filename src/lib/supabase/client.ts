/**
 * Supabase browser client — null-safe.
 *
 * Returns null when env vars are not set (mock / local dev mode).
 * All call sites must check for null before using the client.
 *
 * Type note:
 *   The client is untyped (SupabaseClient without Database generic) because
 *   manually-authored Database types require `supabase gen types` to match the
 *   exact structure that supabase-js v2 demands. Import Database from ./types
 *   for documentation / future migration; pass it here once types are generated.
 *
 * Usage:
 *   const sb = getSupabaseClient();
 *   if (!sb) return; // graceful no-op in mock mode
 *   await sb.from('events').insert(row);
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const isSupabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

let _client: SupabaseClient | null = null;

function getSupabaseConfig(): { url?: string; key?: string } {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Returns the singleton Supabase client, or null when unconfigured. */
export function getSupabaseClient(): SupabaseClient | null {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;

  if (!_client) {
    _client = createClient(url, key);
  }
  return _client;
}
