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
import {
  getPublicSupabaseConfig,
  type SupabaseConfigStatus,
} from './config';

export type { SupabaseConfigStatus } from './config';

let didWarnInvalidConfig = false;

let _client: SupabaseClient | null = null;

function getSupabaseConfig(): { url?: string; key?: string; status: SupabaseConfigStatus } {
  return getPublicSupabaseConfig();
}

export function getSupabaseConfigStatus(): SupabaseConfigStatus {
  return getSupabaseConfig().status;
}

export const isSupabaseConfigured = getSupabaseConfigStatus() === 'ready';

/** Returns the singleton Supabase client, or null when unconfigured. */
export function getSupabaseClient(): SupabaseClient | null {
  const { url, key, status } = getSupabaseConfig();
  if (status !== 'ready' || !url || !key) {
    if (status !== 'missing' && !didWarnInvalidConfig) {
      didWarnInvalidConfig = true;
      console.warn('[Supabase] browser client disabled:', status);
    }
    return null;
  }

  if (!_client) {
    _client = createClient(url, key);
  }
  return _client;
}
