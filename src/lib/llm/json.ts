export function stripMarkdownCodeFence(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export function extractJsonObject(content: string): string {
  const unfenced = stripMarkdownCodeFence(content);
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return unfenced;
  }

  return unfenced.slice(firstBrace, lastBrace + 1);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseJsonCandidate(content: string): unknown {
  const unfenced = stripMarkdownCodeFence(content);

  try {
    return JSON.parse(unfenced) as unknown;
  } catch (primaryError) {
    const extracted = extractJsonObject(unfenced);

    if (extracted === unfenced) {
      throw primaryError;
    }

    return JSON.parse(extracted) as unknown;
  }
}

export function parseLlmJsonValue(content: string, maxStringUnwraps = 2): unknown {
  let current: unknown = content;

  for (let unwraps = 0; unwraps <= maxStringUnwraps; unwraps += 1) {
    if (typeof current !== 'string') return current;
    current = parseJsonCandidate(current);
  }

  return current;
}

export function parseLlmJsonObject(content: string, maxStringUnwraps = 2): Record<string, unknown> {
  const parsed = parseLlmJsonValue(content, maxStringUnwraps);

  if (!isJsonObject(parsed)) {
    throw new Error('LLM JSON response was not an object.');
  }

  return parsed;
}
