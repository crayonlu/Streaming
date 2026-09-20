import { describe, expect, it } from "vitest";
import {
  planSourceCommit,
  SOURCE_COMMIT_MAX_PENDING_MS,
  SOURCE_COMMIT_SETTLE_MS,
  type SourceCommitInput,
} from "./sourceCommit";

const NOW = 1_700_000_000_000;

function input(overrides: Partial<SourceCommitInput> = {}): SourceCommitInput {
  return {
    desiredUrl: "https://cdn.example.com/b.m3u8",
    committedUrl: "https://cdn.example.com/a.m3u8",
    lastChangeAt: NOW,
    pendingSince: NOW,
    now: NOW,
    ...overrides,
  };
}

describe("planSourceCommit", () => {
  it("coalesces a burst into one commit", () => {
    // The burst: nine rapid clicks 60ms apart, all within the max-pending bound.
    let plan = planSourceCommit(input({ pendingSince: NOW, now: NOW }));
    expect(plan.kind).toBe("defer");
    for (const offset of [60, 120, 180]) {
      plan = planSourceCommit(
        input({ lastChangeAt: NOW + offset, pendingSince: NOW, now: NOW + offset }),
      );
      expect(plan.kind).toBe("defer");
    }
    // Settled: the newest URL wins and exactly one commit is issued.
    plan = planSourceCommit(
      input({
        lastChangeAt: NOW + 180,
        pendingSince: NOW,
        now: NOW + 180 + SOURCE_COMMIT_SETTLE_MS,
      }),
    );
    expect(plan).toEqual({ kind: "commit" });
  });

  it("is a no-op when the engine already plays the desired url", () => {
    expect(planSourceCommit(input({ committedUrl: "https://cdn.example.com/b.m3u8" }))).toEqual({
      kind: "noop",
    });
  });

  it("commits the first load immediately", () => {
    expect(planSourceCommit(input({ committedUrl: null }))).toEqual({ kind: "commit" });
  });

  it("bounds how long an ongoing burst may defer", () => {
    // A click storm that never settles must still switch.
    const plan = planSourceCommit(
      input({
        lastChangeAt: NOW + SOURCE_COMMIT_MAX_PENDING_MS,
        pendingSince: NOW,
        now: NOW + SOURCE_COMMIT_MAX_PENDING_MS,
      }),
    );
    expect(plan).toEqual({ kind: "commit" });
  });

  it("respects the settle window when no burst is in progress", () => {
    const plan = planSourceCommit(input({ pendingSince: 0 }));
    expect(plan.kind).toBe("defer");
    expect(plan).toHaveProperty("delayMs", SOURCE_COMMIT_SETTLE_MS);
  });
});
