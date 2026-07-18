/** Shared defensive parser for the small, structured agent responses. */

export function stripMarkdownCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export function extractJsonObject(content: string): string {
  const unfenced = stripMarkdownCodeFence(content);
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace
    ? unfenced.slice(firstBrace, lastBrace + 1)
    : unfenced;
}

/** Throws only when JSON.parse fails. Valid but incomplete JSON is normalized by callers. */
export function parseJsonObject(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(extractJsonObject(content));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

export function normalizeText(value: unknown, fallback: string, maxLength = 600): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

export function strings(value: unknown, fallback: string[], limit = 5): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 300))
    .filter(Boolean)
    .slice(0, limit);
  return cleaned.length ? cleaned : fallback;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return allowed.includes(normalized as T) ? normalized as T : fallback;
}
