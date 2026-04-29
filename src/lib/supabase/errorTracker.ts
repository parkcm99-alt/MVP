/**
 * Persistence error tracker — lightweight pub/sub for non-fatal Supabase
 * write failures (agents/tasks upsert). Drives the SUPABASE PARTIAL ERROR badge.
 *
 * Error state is sticky for the session lifetime. Once set, only a page reload
 * resets it (aligns with user expectation: the badge is a warning, not a counter).
 */

let _hasError = false;
const _listeners = new Set<() => void>();

/** Called by persistence.ts whenever an upsert fails. */
export function reportPersistenceError(): void {
  if (_hasError) return;
  _hasError = true;
  _listeners.forEach(fn => fn());
}

export function hasPersistenceError(): boolean {
  return _hasError;
}

/** Subscribe to error state changes. Returns an unsubscribe function. */
export function onPersistenceErrorChange(fn: () => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
