/**
 * Session ID — one UUID per browser tab, persisted in sessionStorage.
 *
 * Used to:
 *   1. Tag events we insert so the Realtime subscription can skip them
 *      (prevents the same event appearing twice in the EventLog)
 *   2. Scope agent / task rows to one simulation run
 */

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // SSR / legacy fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

let _sessionId: string | null = null;

/** Returns the stable session UUID for this browser tab. */
export function getSessionId(): string {
  if (typeof window === 'undefined') return 'ssr-session';
  if (_sessionId) return _sessionId;

  const KEY = 'sim-session-id';
  const stored = window.sessionStorage.getItem(KEY);
  const validStoredId = stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored) ? stored : null;
  _sessionId = validStoredId ?? (() => {
    const id = uuid();
    window.sessionStorage.setItem(KEY, id);
    return id;
  })();
  return _sessionId;
}

/** Convenience: generate a one-off UUID (e.g. for row IDs). */
export { uuid };
