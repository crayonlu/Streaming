import { describe, expect, it } from "vitest";
import { liveRecoveryDelayMs, MAX_LIVE_RECOVERY_ATTEMPTS } from "./liveRecovery";

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
});
