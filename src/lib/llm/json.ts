/** Small defensive JSON helpers shared by server-side agent routes. */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeText(value: unknown, fallback: string, maxLength = 600): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, maxLength)
    : fallback;
}

export function normalizeUuid(value: unknown): string | undefined {
  return typeof value === 'string' && UUID_V4.test(value.trim()) ? value.trim() : undefined;
}

export function arrayOfStrings(value: unknown, fallback: string[], limit = 6): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().slice(0, 320))
    .filter(Boolean)
    .slice(0, limit);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value.toLowerCase() as T)
    ? value.toLowerCase() as T
    : fallback;
}

/**
 * A model is instructed to emit raw JSON, but tolerate a fence or short prose
 * wrapper. Parsing itself remains the sole reason to use a structured fallback.
 */
export function parseJsonObject(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const unfenced = (trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed).trim();
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  const candidate = first >= 0 && last > first ? unfenced.slice(first, last + 1) : unfenced;

  try {
    const parsed: unknown = JSON.parse(candidate);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function buildRawJsonPrompt(basePrompt: string, shape: string): string {
  return [
    basePrompt,
    'Return exactly one raw JSON object and nothing else.',
    'No markdown, no ```json code fence, and no explanation before or after the object.',
    'The complete response must be valid input to JSON.parse.',
    `Use this exact shape and keys: ${shape}`,
    'Keep each list concise and use short, actionable Korean strings.',
  ].join('\n');
}
