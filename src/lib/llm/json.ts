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

export function parseLlmJsonObject(content: string): Record<string, unknown> {
  return JSON.parse(extractJsonObject(content)) as Record<string, unknown>;
}
