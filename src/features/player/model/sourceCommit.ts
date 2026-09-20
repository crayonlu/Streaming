/**
 * Source-commit planner (pure function).
 *
 * A quality or CDN-line switch re-points the engine, and for hls.js that is
 * `loadSource()`, which internally tears the MediaSource down and rebuilds it
 * (detachMedia → attachMedia). Measured: ten fast clicks produced ten
 * MediaSource objects, ten `emptied` events and ten playback restarts in about
 * one second — the buffer is dropped and the playhead kicked back to the live
 * edge each time. That is what reads as "the UI freezes and then keeps
 * playing".
 *
 * The engine therefore never applies a URL synchronously. Clicks only state an
 * intent (`desiredUrl`); this planner decides when that intent is committed:
 *
 *   - wait for the burst to settle (`SOURCE_COMMIT_SETTLE_MS`);
 *   - but never defer longer than `SOURCE_COMMIT_MAX_PENDING_MS`, so a long
 *     burst cannot postpone the switch indefinitely;
 *   - the commit always uses the newest desired URL, so the last click wins
 *     and the intermediate ones never reach the engine at all.
 */

/** Quiet period after the last change before a pending URL is committed. */
export const SOURCE_COMMIT_SETTLE_MS = 220;

/** Upper bound on how long a switch may stay pending. */
export const SOURCE_COMMIT_MAX_PENDING_MS = 900;

export interface SourceCommitInput {
  /** URL the user last asked for. */
  desiredUrl: string;
  /** URL the engine is actually playing; null before the first load. */
  committedUrl: string | null;
  /** Timestamp of the most recent change of `desiredUrl`. */
  lastChangeAt: number;
  /** Timestamp the current pending URL was first requested (0 = none). */
  pendingSince: number;
  now: number;
}

export type SourceCommitPlan =
  /** Load now. */
  | { kind: "commit" }
  /** Still inside the coalescing window — retry after `delayMs`. */
  | { kind: "defer"; delayMs: number }
  /** Nothing to do: the engine already plays the desired URL. */
  | { kind: "noop" };

export function planSourceCommit(input: SourceCommitInput): SourceCommitPlan {
  const { desiredUrl, committedUrl, lastChangeAt, pendingSince, now } = input;

  // Nothing loaded yet — the engine bootstrap owns the first load.
  if (committedUrl === null) return { kind: "commit" };
  if (desiredUrl === committedUrl) return { kind: "noop" };

  // A burst that keeps changing must not postpone the switch forever.
  if (pendingSince > 0 && now - pendingSince >= SOURCE_COMMIT_MAX_PENDING_MS) {
    return { kind: "commit" };
  }

  const elapsed = now - lastChangeAt;
  if (elapsed >= SOURCE_COMMIT_SETTLE_MS) return { kind: "commit" };
  return { kind: "defer", delayMs: SOURCE_COMMIT_SETTLE_MS - elapsed };
}

// ── self-check ──────────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`sourceCommit check FAILED: ${msg}`);
}

function selfCheck() {
  const now = 1_700_000_000_000;
  const base = {
    desiredUrl: "https://cdn.example.com/b.m3u8",
    committedUrl: "https://cdn.example.com/a.m3u8",
    lastChangeAt: now,
    pendingSince: now,
    now,
  };
  let assertions = 0;
  const check = (cond: unknown, msg: string) => {
    assert(cond, msg);
    assertions += 1;
  };

  // A fresh change starts inside the settle window.
  const fresh = planSourceCommit(base);
  check(fresh.kind === "defer", "a new request waits for the burst to settle");
  check(
    fresh.kind === "defer" && fresh.delayMs === SOURCE_COMMIT_SETTLE_MS,
    "delay counts down from the settle window",
  );

  // Later inside the same window: shorter remaining delay.
  const midway = planSourceCommit({
    ...base,
    now: now + SOURCE_COMMIT_SETTLE_MS - 50,
  });
  check(midway.kind === "defer" && midway.delayMs === 50, "delay shrinks as the window elapses");

  // Window elapsed → commit.
  check(
    planSourceCommit({ ...base, now: now + SOURCE_COMMIT_SETTLE_MS }).kind === "commit",
    "commit once the burst settles",
  );

  // Already playing the desired URL → nothing to do.
  check(
    planSourceCommit({ ...base, committedUrl: base.desiredUrl }).kind === "noop",
    "same url is a no-op",
  );

  // A long burst is bounded: commit even though the last change was instant.
  const stalled = planSourceCommit({
    ...base,
    pendingSince: now - SOURCE_COMMIT_MAX_PENDING_MS,
    now,
  });
  check(stalled.kind === "commit", "max pending bound forces a commit");

  // No pending timestamp yet → the max-wait rule does not fire.
  check(
    planSourceCommit({ ...base, pendingSince: 0 }).kind === "defer",
    "without a pending start the settle window governs",
  );

  // Nothing committed yet → the bootstrap loads immediately.
  check(
    planSourceCommit({ ...base, committedUrl: null }).kind === "commit",
    "first load is immediate",
  );

  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log(`sourceCommit check OK — ${assertions} assertions passed`);
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  selfCheck();
}
