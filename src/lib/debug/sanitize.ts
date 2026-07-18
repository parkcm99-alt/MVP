const SENSITIVE_KEY = /(?:api[_-]?key|apikey|authorization|auth[_-]?token|bearer|credential|password|secret|service[_-]?role|access[_-]?token|refresh[_-]?token|private[_-]?key|^token$)/i;

/** Redacts recognizable credentials without trying to validate or preserve them. */
export function redactText(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-ant-|sk-proj-|sk-|sb_secret_|sbp_)[A-Za-z0-9_-]{8,}/gi, '[REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_JWT]')
    .replace(/((?:api[_-]?key|authorization|password|secret|service[_-]?role|token)\s*[:=]\s*)["']?[^"',\s}]+/gi, '$1[REDACTED]');
}

/** Bounded, recursive sanitizer for metadata and portable debug bundles. */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value).slice(0, 1000);
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 40).map(([key, item]) => [
        key.slice(0, 80),
        SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1),
      ]),
    );
  }
  return null;
}

export function sanitizeRecord(value: unknown): Record<string, unknown> | null {
  const clean = sanitizeValue(value);
  return clean && typeof clean === 'object' && !Array.isArray(clean)
    ? clean as Record<string, unknown>
    : null;
}
