/** Tolerant extraction for model output; the returned value is still parsed by JSON.parse. */
export function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = (fenced?.[1] ?? trimmed).trim();
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace
    ? unfenced.slice(firstBrace, lastBrace + 1)
    : unfenced;
}

export function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(extractJsonObject(content));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function textField(value: unknown, fallback: string, maxLength = 600): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

export function stringList(value: unknown, fallback: string[], limit = 6): string[] {
  if (!Array.isArray(value)) return fallback;
  const clean = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 280))
    .filter(Boolean)
    .slice(0, limit);
  return clean.length ? clean : fallback;
}

export function enumField<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value.toLowerCase())
    ? value.toLowerCase() as T
    : fallback;
}
