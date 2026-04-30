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

  // Supabase anon keys are JWTs. Anthropic/OpenAI/service secrets must never sit in NEXT_PUBLIC_*.
  if (!isSupabaseJwtKey(key)) {
    return { url, key, status: 'invalid_key' };
  }

  return { url, key, status: 'ready' };
}
