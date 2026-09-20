/**
 * Live-recovery policy (pure planner).
 *
 * The ladder used to advance on every signal, which produced the periodic
 * "watch a bit → stutter → refresh" loop:
 *   - a `playing` event wiped the failure memory, so selection fell back to
 *     the source that had just failed (ping-pong between two dead sources);
 *   - a single transient stall retired a healthy source;
 *   - retiring the last source emptied the available set and unmounted the
 *     player into the "no source" panel.
 *
 * Policy:
 *   - the first stall on a source is answered in place (nudge to the live edge);
 *   - a second stall inside the same window, or any hard error, retires it;
 *   - failures are sticky until the user retries / picks a quality, or a
 *     catalogue refetch returns fresh URLs;
 *   - the last available source is never retired — a refetch is requested.
 */

export const MAX_LIVE_RECOVERY_ATTEMPTS = 6;

/** Consecutive stalls on one source before it counts as a real failure. */
export const STALL_RETIRE_THRESHOLD = 2;

/** Stall signals closer together than this are one incident: the engine's
 *  `waiting` timeout and the in-place nudge watchdog can fire together. */
export const STALL_DEDUPE_MS = 2000;

/** Stalls further apart than this do not accumulate — the count restarts. */
export const STALL_WINDOW_MS = 30_000;

/** Time an in-place nudge gets to bring playback back before it escalates.
 *  Mirrors the engine's 10s `waiting` timeout (usePlayerEngine). */
export const STALL_WATCHDOG_MS = 10_000;

/** Exponential backoff capped at 8s, plus up to 30% jitter. */
export function liveRecoveryDelayMs(attempt: number, jitterUnit = Math.random()): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = Math.min(8000, 500 * 2 ** (safeAttempt - 1));
  const jitter = Math.round(base * 0.3 * Math.min(1, Math.max(0, jitterUnit)));
  return base + jitter;
}

export type LiveRecoveryEvent = { kind: "stall" } | { kind: "hard-error" } | { kind: "playing" };

export type LiveRecoveryAction =
  /** Nothing to do (recovered, deduplicated, or the attempt budget is spent). */
  | { kind: "none" }
  /** Recover the current source in place: seek back to the live edge. */
  | { kind: "nudge" }
  /** Give up on the current source; the caller switches to another one. */
  | { kind: "retire" }
  /** Refresh the catalogue; a successful refetch resets the failure memory. */
  | { kind: "refetch" };

export interface LiveRecoveryContext {
  /** Source currently playing; null when the player has no source. */
  sourceId: string | null;
  /** Sources still available (not retired), including the current one. */
  availableCount: number;
}

export interface LiveRecoveryState {
  /** Source the stall counters below belong to. */
  sourceId: string | null;
  /** Consecutive stalls on that source. */
  stalls: number;
  /** Recovery actions taken since the last successful playback. */
  attempts: number;
  lastStallAt: number;
  /** Retired sources — sticky until an explicit user action or a refetch. */
  failed: ReadonlySet<string>;
}

export const INITIAL_LIVE_RECOVERY_STATE: LiveRecoveryState = {
  sourceId: null,
  stalls: 0,
  attempts: 0,
  lastStallAt: 0,
  failed: new Set(),
};

/** Fresh state; `failed` is a new set so the shared constant stays untouched. */
export function createLiveRecoveryState(): LiveRecoveryState {
  return { ...INITIAL_LIVE_RECOVERY_STATE, failed: new Set() };
}

/**
 * Restart the stall episode: the per-source stall count and the attempt budget
 * go back to zero. Called on successful playback (the last stall was therefore
 * transient) and on explicit user actions. The failure memory is deliberately
 * left alone — clearing it here is what sent selection back to a dead source.
 * Returns the same object when there is nothing to reset.
 */
export function resetStallBudget(state: LiveRecoveryState): LiveRecoveryState {
  if (state.stalls === 0 && state.attempts === 0) return state;
  return { ...state, stalls: 0, attempts: 0 };
}

/** Forget that the given sources were retired (explicit user choice). */
export function reviveSources(state: LiveRecoveryState, ids: Iterable<string>): LiveRecoveryState {
  const failed = new Set(state.failed);
  let changed = false;
  for (const id of ids) {
    if (failed.delete(id)) changed = true;
  }
  return changed ? { ...state, failed } : state;
}

export function planLiveRecovery(
  event: LiveRecoveryEvent,
  state: LiveRecoveryState,
  context: LiveRecoveryContext,
  now: number,
): { action: LiveRecoveryAction; next: LiveRecoveryState } {
  if (event.kind === "playing") {
    return { action: { kind: "none" }, next: resetStallBudget(state) };
  }

  const sourceId = context.sourceId;
  if (!sourceId) return { action: { kind: "none" }, next: state };

  // A different source means the previous one was retired (or the user
  // switched): stall counting starts over for the new one.
  const switched = state.sourceId !== sourceId;
  const windowExpired =
    !switched && state.lastStallAt > 0 && now - state.lastStallAt > STALL_WINDOW_MS;
  const stalls = switched || windowExpired ? 0 : state.stalls;

  if (event.kind === "stall" && !switched && now - state.lastStallAt < STALL_DEDUPE_MS) {
    return { action: { kind: "none" }, next: state };
  }

  if (state.attempts >= MAX_LIVE_RECOVERY_ATTEMPTS) {
    return { action: { kind: "none" }, next: { ...state, sourceId, stalls } };
  }

  const attempts = state.attempts + 1;
  const hardError = event.kind === "hard-error";
  const nextStalls = hardError ? stalls : stalls + 1;

  if (!hardError && nextStalls < STALL_RETIRE_THRESHOLD) {
    return {
      action: { kind: "nudge" },
      next: { ...state, sourceId, attempts, stalls: nextStalls, lastStallAt: now },
    };
  }

  // Never empty the available set: retiring the last source would unmount the
  // player into the "no source" panel, a full-stage flash. Refetch instead —
  // fresh URLs reset the failure memory.
  if (context.availableCount <= 1) {
    return {
      action: { kind: "refetch" },
      next: { ...state, sourceId, attempts, stalls: 0, lastStallAt: now },
    };
  }

  return {
    action: { kind: "retire" },
    next: {
      ...state,
      sourceId,
      attempts,
      stalls: 0,
      lastStallAt: now,
      failed: new Set([...state.failed, sourceId]),
    },
  };
}

// ── self-check ──────────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`liveRecovery check FAILED: ${msg}`);
}

function selfCheck() {
  const now = 1_700_000_000_000;
  const ctx = (sourceId: string, availableCount: number) => ({ sourceId, availableCount });
  let assertions = 0;
  const check = (cond: unknown, msg: string) => {
    assert(cond, msg);
    assertions += 1;
  };

  // First stall on a source is recovered in place, nothing is retired.
  let r = planLiveRecovery(
    { kind: "stall" },
    { ...createLiveRecoveryState(), sourceId: "a" },
    ctx("a", 3),
    now,
  );
  check(r.action.kind === "nudge", "first stall nudges in place");
  check(r.next.failed.size === 0, "first stall retires nothing");

  // Second stall inside the same window retires it.
  r = planLiveRecovery({ kind: "stall" }, r.next, ctx("a", 3), now + STALL_WATCHDOG_MS);
  check(r.action.kind === "retire", "second stall retires the source");
  check(r.next.failed.has("a"), "retired source is remembered");

  // Recovery does not un-retire.
  const resumed = planLiveRecovery(
    { kind: "playing" },
    r.next,
    ctx("b", 2),
    now + STALL_WATCHDOG_MS + 1000,
  );
  check(resumed.action.kind === "none", "playing takes no action");
  check(resumed.next.failed.has("a"), "playing keeps failures sticky");
  check(
    resumed.next.stalls === 0 && resumed.next.attempts === 0,
    "playing resets the stall budget",
  );

  // Hard errors retire at once; the last available source is never retired.
  r = planLiveRecovery(
    { kind: "hard-error" },
    { ...createLiveRecoveryState(), sourceId: "a" },
    ctx("a", 3),
    now,
  );
  check(r.action.kind === "retire", "hard error retires immediately");
  r = planLiveRecovery(
    { kind: "hard-error" },
    { ...createLiveRecoveryState(), sourceId: "a" },
    ctx("a", 1),
    now,
  );
  check(r.action.kind === "refetch", "last available source → refetch");
  check(r.next.failed.size === 0, "refetch path retires nothing");

  // Duplicate stall signals from one incident do not accumulate.
  const first = planLiveRecovery(
    { kind: "stall" },
    { ...createLiveRecoveryState(), sourceId: "a" },
    ctx("a", 3),
    now,
  );
  const dup = planLiveRecovery({ kind: "stall" }, first.next, ctx("a", 3), now + 500);
  check(dup.action.kind === "none" && dup.next.stalls === 1, "duplicate stall is ignored");

  // The attempt budget bounds the whole ladder.
  let state = createLiveRecoveryState();
  let retires = 0;
  for (let i = 0; i < MAX_LIVE_RECOVERY_ATTEMPTS + 2; i++) {
    const sourceId = `s${i}`;
    const out = planLiveRecovery(
      { kind: "hard-error" },
      state,
      ctx(sourceId, 3),
      now + i * STALL_WINDOW_MS,
    );
    state = out.next;
    if (out.action.kind === "retire") retires += 1;
  }
  check(retires === MAX_LIVE_RECOVERY_ATTEMPTS, "attempt cap bounds retirements");
  check(state.attempts === MAX_LIVE_RECOVERY_ATTEMPTS, "attempts stop at the cap");

  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log(`liveRecovery check OK — ${assertions} assertions passed`);
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  selfCheck();
}
