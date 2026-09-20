import { describe, expect, it } from "vitest";
import { type EngineTarget, planEngineTransition } from "./engineTransition";

function target(over: Partial<EngineTarget> = {}): EngineTarget {
  return { url: "https://cdn.example.com/live.m3u8", format: "hls", isLive: true, ...over };
}

describe("planEngineTransition", () => {
  it("rebuilds without a previous target, or when the engine family changed", () => {
    expect(planEngineTransition(null, target())).toBe("rebuild");
    expect(planEngineTransition(target(), target({ format: "flv" }))).toBe("rebuild");
    expect(planEngineTransition(target(), target({ isLive: false }))).toBe("rebuild");
  });

  it("reloads in place when only the URL changed", () => {
    const next = target({ url: "https://cdn2.example.com/live.m3u8" });
    expect(planEngineTransition(target(), next)).toBe("reload");
  });

  it("does nothing when the target is unchanged", () => {
    expect(planEngineTransition(target(), target())).toBe("none");
  });
});
