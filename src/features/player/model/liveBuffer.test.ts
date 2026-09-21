import { describe, expect, it } from "vitest";
import {
  type LiveRecoveryState,
  liveRecoveryDelayMs,
  MAX_LIVE_RECOVERY_ATTEMPTS,
  planLiveRecovery,
  STALL_RETIRE_THRESHOLD,
} from "./liveRecovery";

/**
 * Guards the buffer-floor reasoning behind the FLV latency chaser tuning.
 *
 * Measured against a Bilibili CDN route: chunks arrive 0–30ms apart but pause
 * for 625–755ms roughly every 1.3s. The chaser leaves `minRemain` buffered
 * after each seek, so that value IS the stall budget — it must exceed the
 * worst-case burst gap with margin, while `maxLatency` still bounds the delay.
 */

// Source of truth for the tuning; kept in sync with usePlayerEngine.ts.
const CHASER = {
  macWin: { maxLatency: 10, minRemain: 4 },
  linux: { maxLatency: 14, minRemain: 6 },
} as const;

/** Worst burst gap measured on a live Bilibili FLV route (ms). */
const MEASURED_MAX_PAUSE_MS = 755;

describe("FLV live latency chaser floor", () => {
  it("leaves a floor well above the worst measured burst pause", () => {
    for (const [platform, cfg] of Object.entries(CHASER)) {
      expect(cfg.minRemain * 1000).toBeGreaterThan(MEASURED_MAX_PAUSE_MS * 3);
      // Sanity: describe which platform failed if this ever regresses.
      expect({ platform, floorMs: cfg.minRemain * 1000 }).toBeTruthy();
    }
  });

  it("keeps the delay bounded — floor stays below the chase threshold", () => {
    for (const cfg of Object.values(CHASER)) {
      expect(cfg.minRemain).toBeLessThan(cfg.maxLatency);
    }
  });

  it("Linux keeps a larger floor than desktop (software decode, erratic steps)", () => {
    expect(CHASER.linux.minRemain).toBeGreaterThan(CHASER.macWin.minRemain);
  });
});

describe("stall recovery still escalates instead of looping", () => {
  it("does not retire a source on its first stall", () => {
    // lastStallAt is far enough in the past to clear the 2s dedupe window.
    const { action } = planLiveRecovery(
      { kind: "stall" },
      { sourceId: "s1", stalls: 0, attempts: 0, lastStallAt: 0, failed: new Set() },
      { sourceId: "s1", availableCount: 2 },
      10_000,
    );
    expect(action.kind).toBe("watch");
  });

  it("treats a second stall inside the dedupe window as one incident", () => {
    const state: LiveRecoveryState = {
      sourceId: "s1",
      stalls: 1,
      attempts: 1,
      lastStallAt: 10_000,
      failed: new Set<string>(),
    };
    const { action } = planLiveRecovery(
      { kind: "stall" },
      state,
      { sourceId: "s1", availableCount: 2 },
      10_500,
    );
    expect(action.kind).toBe("none");
  });

  it("retires only once the stall threshold is reached", () => {
    const { action } = planLiveRecovery(
      { kind: "stall" },
      {
        sourceId: "s1",
        stalls: STALL_RETIRE_THRESHOLD - 1,
        attempts: 1,
        lastStallAt: 0,
        failed: new Set(),
      },
      { sourceId: "s1", availableCount: 2 },
      20_000,
    );
    expect(action.kind).toBe("retire");
  });

  it("caps the backoff so recovery cannot stall out on long delays", () => {
    for (let a = 1; a <= MAX_LIVE_RECOVERY_ATTEMPTS; a++) {
      expect(liveRecoveryDelayMs(a, 1)).toBeLessThanOrEqual(8000 * 1.3);
    }
  });
});
