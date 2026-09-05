/**
 * Tracks whether this process has finished startup (migrations + schema
 * validation) and can serve real traffic. Deliberately just a module-level
 * flag, not a class or event emitter — there is exactly one transition,
 * "starting" -> "ready", once per process lifetime. A migration failure
 * never flips it; index.ts exits the process instead (see runPendingMigrations's
 * caller), so there is no "failed" state to represent here — a process that
 * failed startup simply stops existing.
 */
let ready = false;

export function isReady(): boolean {
  return ready;
}

export function markReady(): void {
  ready = true;
}
