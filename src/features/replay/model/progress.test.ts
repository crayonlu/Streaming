import { beforeEach, describe, expect, it } from "vitest";
import { loadReplayProgress, replayProgressKey, saveReplayProgress } from "./progress";

const values = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  },
});

describe("replay progress", () => {
  beforeEach(() => values.clear());

  it("restores a meaningful unfinished position", () => {
    const key = replayProgressKey("douyu", "1", "part-1");
    saveReplayProgress(key, 120, 600);
    expect(loadReplayProgress(key)?.position).toBe(120);
  });

  it("does not resume near the beginning or after completion", () => {
    const early = replayProgressKey("douyu", "1", "early");
    saveReplayProgress(early, 5, 600);
    expect(loadReplayProgress(early)).toBeNull();

    const complete = replayProgressKey("douyu", "1", "complete");
    saveReplayProgress(complete, 580, 600);
    expect(loadReplayProgress(complete)).toBeNull();
  });
});
