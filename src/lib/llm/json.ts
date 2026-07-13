export function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  return start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
}

export function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(extractJsonObject(content));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1200) : fallback;
}

export function strings(value: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(value)) return fallback;
  const clean = value.filter((item): item is string => typeof item === 'string')
    .map(item => item.trim()).filter(Boolean).slice(0, 8);
  return clean.length ? clean : fallback;
}
