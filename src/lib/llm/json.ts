/** Helpers for the deliberately small, raw-JSON agent response contract. */

/** Tolerate a fence or accidental prose, but never evaluate model output. */
export function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const unfenced = (trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed).trim();
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  return first >= 0 && last > first ? unfenced.slice(first, last + 1) : unfenced;
}

/** null means JSON.parse failed (or the value was not a JSON object). */
export function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(extractJsonObject(content));
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function cleanText(value: unknown, fallback: string, max = 600): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
}

export function cleanStringArray(value: unknown, fallback: string[], max = 5): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, max);
}

export function cleanEnum<T extends string>(value: unknown, values: readonly T[], fallback: T): T {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return values.includes(normalized as T) ? normalized as T : fallback;
}
