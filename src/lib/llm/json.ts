/** Extract a JSON object from an LLM response without accepting markdown prose. */
export function parseLlmJson(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const unfenced = (trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed).trim();
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function jsonString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 1200) : fallback;
}

export function jsonStrings(value: unknown, fallback: string[] = []): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean).slice(0, 8)
    : fallback;
}
