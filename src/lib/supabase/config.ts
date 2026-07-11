export type SupabaseConfigStatus = 'missing' | 'invalid_url' | 'invalid_key' | 'ready';

export function isSupabaseProjectUrl(url?: string | null): boolean {
  if (!url) return false;

  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.supabase.co')
      || parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function isSupabaseJwtKey(key?: string | null): key is string {
  const normalized = key?.trim();
  return Boolean(normalized?.startsWith('eyJ') && normalized.split('.').length === 3);
}

/** Browser-safe Supabase API key: legacy anon JWT or current publishable key. */
export function isSupabasePublicKey(key?: string | null): key is string {
  const normalized = key?.trim();
  if (!normalized) return false;
  const isLegacyJwt = normalized.startsWith('eyJ') && normalized.split('.').length === 3;
  return isLegacyJwt || normalized.startsWith('sb_publishable_');
}

/** Server-only elevated key: legacy service-role JWT or current secret key. */
export function isSupabaseServerKey(key?: string | null): key is string {
  const normalized = key?.trim();
  if (!normalized) return false;
  const isLegacyJwt = normalized.startsWith('eyJ') && normalized.split('.').length === 3;
  return isLegacyJwt || normalized.startsWith('sb_secret_');
}

export function getPublicSupabaseConfig(): {
  url?: string;
  key?: string;
  status: SupabaseConfigStatus;
} {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !key) {
    return { url, key, status: 'missing' };
  }

  if (!isSupabaseProjectUrl(url)) {
    return { url, key, status: 'invalid_url' };
  }

  // Accept both legacy anon JWTs and current publishable keys. Never accept secret keys here.
  if (!isSupabasePublicKey(key)) {
    return { url, key, status: 'invalid_key' };
  }

  return { url, key, status: 'ready' };
}
