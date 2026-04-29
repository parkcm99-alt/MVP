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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key);

let _client: SupabaseClient | null = null;

/** Returns the singleton Supabase client, or null when unconfigured. */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (!_client) {
    _client = createClient(url!, key!);
  }
  return _client;
}
