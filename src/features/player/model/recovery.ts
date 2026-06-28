/**
 * HLS fatal error recovery planner (pure function).
 *
 * Aligns with the hls.js official Fatal Error Recovery chain:
 *   MEDIA_ERROR   → recoverMediaError() (5s debounce) → swapAudioCodec → reloadSource
 *   NETWORK_ERROR → startLoad() (no rebuild, avoids loop loading) → reloadSource
 *   OTHER/KEY     → reloadSource
 *
 * Non-fatal errors are ignored; the engine retries internally.
 */

export type HlsErrorType =
  | "NETWORK_ERROR"
  | "MEDIA_ERROR"
  | "KEY_SYSTEM_ERROR"
  | "MUX_ERROR"
  | "OTHER_ERROR";

export interface HlsErrorData {
  fatal: boolean;
  type: HlsErrorType | string;
  details?: string;
}

export type RecoveryAction =
  | { kind: "ignore" }
  | { kind: "recoverMedia" }
  | { kind: "recoverMediaSwapCodec" }
  | { kind: "startLoad" }
  | { kind: "reloadSource" };

export interface RecoveryState {
  lastAt: number;
  lastKind: RecoveryAction["kind"] | null;
}

export const INITIAL_RECOVERY_STATE: RecoveryState = { lastAt: 0, lastKind: null };

const RECOVERY_COOLDOWN_MS = 5000;

export function planHlsRecovery(
  data: HlsErrorData,
  state: RecoveryState,
  now: number,
): { action: RecoveryAction; next: RecoveryState } {
  if (!data.fatal) {
    return { action: { kind: "ignore" }, next: state };
  }

  const withinCooldown = now - state.lastAt < RECOVERY_COOLDOWN_MS;

  switch (data.type) {
    case "MEDIA_ERROR": {
      if (withinCooldown) {
        if (state.lastKind === "recoverMedia") {
          return {
            action: { kind: "recoverMediaSwapCodec" },
            next: { lastAt: now, lastKind: "recoverMediaSwapCodec" },
          };
        }
        if (state.lastKind === "recoverMediaSwapCodec") {
          return {
            action: { kind: "reloadSource" },
            next: { lastAt: now, lastKind: "reloadSource" },
          };
        }
      }
      return {
        action: { kind: "recoverMedia" },
        next: { lastAt: now, lastKind: "recoverMedia" },
      };
    }

    case "NETWORK_ERROR": {
      if (state.lastKind === "startLoad" && withinCooldown) {
        return {
          action: { kind: "reloadSource" },
          next: { lastAt: now, lastKind: "reloadSource" },
        };
      }
      return {
        action: { kind: "startLoad" },
        next: { lastAt: now, lastKind: "startLoad" },
      };
    }

    default:
      return {
        action: { kind: "reloadSource" },
        next: { lastAt: now, lastKind: "reloadSource" },
      };
  }
}

// ── self-check ──────────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`recovery check FAILED: ${msg}`);
}

function selfCheck() {
  const now = 10_000;

  let r = planHlsRecovery({ fatal: false, type: "MEDIA_ERROR" }, INITIAL_RECOVERY_STATE, now);
  assert(r.action.kind === "ignore", "non-fatal should ignore");

  r = planHlsRecovery({ fatal: true, type: "MEDIA_ERROR" }, INITIAL_RECOVERY_STATE, now);
  assert(r.action.kind === "recoverMedia", "fatal media first → recoverMedia");

  r = planHlsRecovery(
    { fatal: true, type: "MEDIA_ERROR" },
    { lastAt: now, lastKind: "recoverMedia" },
    now + 1000,
  );
  assert(
    r.action.kind === "recoverMediaSwapCodec",
    "fatal media retry within cooldown → swapCodec",
  );

  r = planHlsRecovery(
    { fatal: true, type: "MEDIA_ERROR" },
    { lastAt: now, lastKind: "recoverMediaSwapCodec" },
    now + 2000,
  );
  assert(r.action.kind === "reloadSource", "fatal media after swap → reloadSource");

  r = planHlsRecovery(
    { fatal: true, type: "MEDIA_ERROR" },
    { lastAt: now, lastKind: "recoverMediaSwapCodec" },
    now + RECOVERY_COOLDOWN_MS + 1,
  );
  assert(r.action.kind === "recoverMedia", "after cooldown, media resets to recoverMedia");

  r = planHlsRecovery({ fatal: true, type: "NETWORK_ERROR" }, INITIAL_RECOVERY_STATE, now);
  assert(r.action.kind === "startLoad", "fatal network → startLoad (not reload)");

  r = planHlsRecovery(
    { fatal: true, type: "NETWORK_ERROR" },
    { lastAt: now, lastKind: "startLoad" },
    now + 1000,
  );
  assert(r.action.kind === "reloadSource", "fatal network after startLoad → reloadSource");

  r = planHlsRecovery({ fatal: true, type: "OTHER_ERROR" }, INITIAL_RECOVERY_STATE, now);
  assert(r.action.kind === "reloadSource", "fatal other → reloadSource");

  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log("recovery check OK — 8 assertions passed");
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  selfCheck();
}
