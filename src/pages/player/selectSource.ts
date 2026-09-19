import type { StreamSource } from "@/shared/types/domain";

/**
 * Stream-source selection for the live player.
 *
 * Manual quality choices are matched by a STABLE triple
 * (qualityKey + cdn + format), not the per-fetch instance id — ids embed an
 * enumeration index (`bili-{qn}-{cdn}-{n}`, `huya-{key}-{n}`) that shifts
 * whenever the source list is refetched, which used to silently reset the
 * user's chosen quality back to default after any stall recovery.
 */

export interface ManualSelection {
  qualityKey: string;
  /** Preferred route within the quality. It may disappear after a refresh. */
  cdn?: string | null;
  format?: StreamSource["format"];
}

export function selectionOf(s: StreamSource): ManualSelection {
  return { qualityKey: s.qualityKey, cdn: s.cdn ?? null, format: s.format };
}

function sameSelection(s: StreamSource, sel: ManualSelection): boolean {
  return (
    s.qualityKey === sel.qualityKey &&
    (sel.cdn === undefined || (s.cdn ?? null) === sel.cdn) &&
    (sel.format === undefined || s.format === sel.format)
  );
}

export function selectStreamSource(
  sources: StreamSource[],
  manual: ManualSelection | null,
  failedIds: ReadonlySet<string>,
): StreamSource | null {
  if (!sources.length) return null;
  if (manual) {
    const matched = sources.find((s) => sameSelection(s, manual));
    if (matched && !failedIds.has(matched.id)) return matched;
    // Keep the user's chosen quality when a refreshed source catalogue no
    // longer contains the exact CDN/format route.
    const sameQuality = sources.find(
      (s) => s.qualityKey === manual.qualityKey && !failedIds.has(s.id),
    );
    if (sameQuality) return sameQuality;
  }
  const available = sources.filter((s) => !failedIds.has(s.id));
  if (!available.length) return null;
  return available.find((s) => s.isDefault) ?? available[0];
}

// ── self-check ──────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`selectSource check FAILED: ${msg}`);
}

function src(id: string, qualityKey: string, cdn: string | null, isDefault = false): StreamSource {
  return {
    id,
    platform: "bilibili",
    roomId: "1",
    qualityKey,
    qualityLabel: qualityKey,
    streamUrl: `https://cdn.example.com/${id}`,
    format: "hls",
    isDefault,
    cdn: cdn ?? undefined,
  };
}

function selfCheck() {
  const fetch1 = [
    src("bili-10000-主线路-0", "10000", "主线路", true),
    src("bili-10000-备用1-1", "10000", "备用1"),
    src("bili-400-主线路-2", "400", "主线路"),
  ];
  const manual: ManualSelection = { qualityKey: "10000", cdn: "备用1", format: "hls" };

  // Manual match wins over default
  assert(selectStreamSource(fetch1, manual, new Set())?.id === "bili-10000-备用1-1", "manual wins");

  // Refetch: ids shift (index embedded), triple still matches the same line
  const fetch2 = [
    src("bili-10000-主线路-0", "10000", "主线路", true),
    src("bili-400-主线路-1", "400", "主线路"),
    src("bili-10000-备用1-2", "10000", "备用1"), // same line, NEW id
  ];
  assert(
    selectStreamSource(fetch2, manual, new Set())?.id === "bili-10000-备用1-2",
    "manual selection survives id shift after refetch",
  );

  // Matched line marked failed → fall back to default
  assert(
    selectStreamSource(fetch2, manual, new Set(["bili-10000-备用1-2"]))?.id ===
      "bili-10000-主线路-0",
    "failed manual line falls back to default",
  );

  // Manual quality gone entirely → default
  const fetch3 = [src("bili-400-主线路-0", "400", "主线路", true)];
  assert(
    selectStreamSource(fetch3, manual, new Set())?.id === "bili-400-主线路-0",
    "missing manual quality falls back to default",
  );

  // Default missing → first available
  assert(
    selectStreamSource(fetch1, null, new Set(["bili-10000-主线路-0"]))?.id === "bili-10000-备用1-1",
    "failed default falls through to first available",
  );

  // Empty sources → null; all failed → null
  assert(selectStreamSource([], manual, new Set()) === null, "empty → null");
  assert(
    selectStreamSource(fetch3, null, new Set(["bili-400-主线路-0"])) === null,
    "all failed → null",
  );

  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log("selectSource check OK — 7 assertions passed");
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  selfCheck();
}
