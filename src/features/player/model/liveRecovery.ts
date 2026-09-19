export const MAX_LIVE_RECOVERY_ATTEMPTS = 6;

/** Exponential backoff capped at 8s, plus up to 30% jitter. */
export function liveRecoveryDelayMs(attempt: number, jitterUnit = Math.random()): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const base = Math.min(8000, 500 * 2 ** (safeAttempt - 1));
  const jitter = Math.round(base * 0.3 * Math.min(1, Math.max(0, jitterUnit)));
  return base + jitter;
}
