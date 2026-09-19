import { describe, expect, it } from "vitest";
import type { StreamSource } from "@/shared/types/domain";
import { selectStreamSource } from "./selectSource";

function source(id: string, qualityKey: string, cdn: string, isDefault = false): StreamSource {
  return {
    id,
    platform: "huya",
    roomId: "1",
    qualityKey,
    qualityLabel: qualityKey,
    streamUrl: `https://example.com/${id}`,
    format: "flv",
    cdn,
    isDefault,
  };
}

describe("selectStreamSource", () => {
  it("preserves quality when the preferred route disappears", () => {
    const sources = [
      source("source-al", "source", "阿里线路"),
      source("hd-tx", "hd", "腾讯线路", true),
    ];
    expect(
      selectStreamSource(
        sources,
        { qualityKey: "source", cdn: "腾讯线路", format: "flv" },
        new Set(),
      )?.id,
    ).toBe("source-al");
  });

  it("moves to another route in the same quality after failure", () => {
    const sources = [
      source("source-tx", "source", "腾讯线路", true),
      source("source-al", "source", "阿里线路"),
    ];
    expect(selectStreamSource(sources, { qualityKey: "source" }, new Set(["source-tx"]))?.id).toBe(
      "source-al",
    );
  });
});
