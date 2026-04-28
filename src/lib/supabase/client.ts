/**
 * Supabase browser client — null-safe.
 *
 * Returns null when env vars are not set (mock / local dev mode).
 * All call sites must check for null before using the client.
 *
 * Usage:
 *   const sb = getSupabaseClient();
 *   if (!sb) return; // graceful no-op in mock mode
 *   await sb.from('events').insert(row);
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './types';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && key);

let _client: SupabaseClient<Database> | null = null;

/** Returns the singleton Supabase client, or null when unconfigured. */
export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (!isSupabaseConfigured) return null;
  if (!_client) {
    // Non-null asserted — guarded by isSupabaseConfigured above
    _client = createClient<Database>(url!, key!);
  }
  return _client;
}
