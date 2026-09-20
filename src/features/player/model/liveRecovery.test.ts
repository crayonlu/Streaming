import { describe, expect, it } from "vitest";
import {
  createLiveRecoveryState,
  liveRecoveryDelayMs,
  MAX_LIVE_RECOVERY_ATTEMPTS,
  planLiveRecovery,
  STALL_WATCHDOG_MS,
  type LiveRecoveryState,
} from "./liveRecovery";

const T0 = 1_700_000_000_000;

function context(sourceId: string | null, availableCount = 3) {
  return { sourceId, availableCount };
}

/** State as it looks right after `sourceId` has been retired. */
function retired(sourceId: string): LiveRecoveryState {
  return {
    ...createLiveRecoveryState(),
    sourceId,
    attempts: 1,
    failed: new Set([sourceId]),
  };
}

describe("live recovery policy", () => {
  it("backs off exponentially and caps the base delay", () => {
    expect(
      Array.from({ length: MAX_LIVE_RECOVERY_ATTEMPTS }, (_, i) => liveRecoveryDelayMs(i + 1, 0)),
    ).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
  });

  it("adds bounded jitter", () => {
    expect(liveRecoveryDelayMs(3, 1)).toBe(2600);
    expect(liveRecoveryDelayMs(3, -1)).toBe(2000);
  });

  it("nudges the same source on the first stall instead of switching", () => {
    const { action, next } = planLiveRecovery(
      { kind: "stall" },
      { ...createLiveRecoveryState(), sourceId: "a" },
      context("a"),
      T0,
    );
    expect(action.kind).toBe("nudge");
    expect(next.failed.size).toBe(0);
    expect(next.stalls).toBe(1);
  });

  it("retires a source that stalls again inside the window", () => {
    const first = planLiveRecovery(
      { kind: "stall" },
      { ...createLiveRecoveryState(), sourceId: "a" },
      context("a"),
      T0,
    );
    const second = planLiveRecovery(
      { kind: "stall" },
      first.next,
      context("a"),
      T0 + STALL_WATCHDOG_MS,
    );
    expect(second.action.kind).toBe("retire");
    expect(second.next.failed.has("a")).toBe(true);
    expect(second.next.stalls).toBe(0);
  });

  it("does not un-retire a failed source when playback recovers", () => {
    const { action, next } = planLiveRecovery(
      { kind: "playing" },
      { ...retired("a"), stalls: 2 },
      context("b", 2),
      T0,
    );
    expect(action.kind).toBe("none");
    expect(next.failed.has("a")).toBe(true);
    // Selection therefore cannot fall back to the source that just failed.
    expect(next.stalls).toBe(0);
    expect(next.attempts).toBe(0);
  });

  it("refetches instead of retiring the last available source", () => {
    const first = planLiveRecovery(
      { kind: "stall" },
      { ...createLiveRecoveryState(), sourceId: "a" },
      context("a", 1),
      T0,
    );
    const second = planLiveRecovery(
      { kind: "stall" },
      first.next,
      context("a", 1),
      T0 + STALL_WATCHDOG_MS,
    );
    expect(second.action.kind).toBe("refetch");
    expect(second.next.failed.size).toBe(0);
  });

  it("retires immediately on a hard error while other sources remain", () => {
    const { action, next } = planLiveRecovery(
      { kind: "hard-error" },
      { ...createLiveRecoveryState(), sourceId: "a" },
      context("a", 2),
      T0,
    );
    expect(action.kind).toBe("retire");
    expect(next.failed.has("a")).toBe(true);
  });

  it("honours the total attempt cap", () => {
    let state = createLiveRecoveryState();
    let retires = 0;
    for (let i = 0; i < MAX_LIVE_RECOVERY_ATTEMPTS + 3; i++) {
      const sourceId = `s${i}`;
      const out = planLiveRecovery(
        { kind: "hard-error" },
        state,
        context(sourceId, 3),
        T0 + i * 60_000,
      );
      state = out.next;
      if (out.action.kind === "retire") retires += 1;
    }
    expect(retires).toBe(MAX_LIVE_RECOVERY_ATTEMPTS);
    expect(state.attempts).toBe(MAX_LIVE_RECOVERY_ATTEMPTS);
  });
});
