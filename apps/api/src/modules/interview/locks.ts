const inFlight = new Set<string>();

/** Per-session in-memory lock: returns false when a turn is already running. */
export function acquireLock(sessionId: string): boolean {
  if (inFlight.has(sessionId)) return false;
  inFlight.add(sessionId);
  return true;
}

export function releaseLock(sessionId: string): void {
  inFlight.delete(sessionId);
}

export function isLocked(sessionId: string): boolean {
  return inFlight.has(sessionId);
}
