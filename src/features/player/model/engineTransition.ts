/**
 * Engine transition planner (pure function).
 *
 * The player engine is rebuilt only when its family changes (hls / flv / mp4,
 * live vs VOD). A new URL inside the same family is reloaded into the engine
 * already attached to the <video> element, which keeps that element, the
 * engine instance and its event handlers alive — a destroy + recreate cycle
 * drops the media source and flashes a black frame on every quality or
 * CDN-line switch.
 */

import type { PlayerFormat } from "./usePlayerEngine";

/** What the engine is currently pointed at. */
export interface EngineTarget {
  url: string;
  format: PlayerFormat;
  isLive: boolean;
}

export type EngineTransition = "rebuild" | "reload" | "none";

export function planEngineTransition(
  prev: EngineTarget | null,
  next: EngineTarget,
): EngineTransition {
  if (!prev || prev.format !== next.format || prev.isLive !== next.isLive) return "rebuild";
  return prev.url === next.url ? "none" : "reload";
}

// ── self-check ──────────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`engineTransition check FAILED: ${msg}`);
}

function selfCheck() {
  const base: EngineTarget = { url: "https://cdn.example.com/a.m3u8", format: "hls", isLive: true };

  assert(planEngineTransition(null, base) === "rebuild", "no previous target → rebuild");
  assert(
    planEngineTransition(base, { ...base, format: "flv" }) === "rebuild",
    "format change → rebuild",
  );
  assert(
    planEngineTransition(base, { ...base, isLive: false }) === "rebuild",
    "live flag change → rebuild",
  );
  assert(
    planEngineTransition(base, { ...base, url: "https://cdn.example.com/b.m3u8" }) === "reload",
    "url-only change → reload",
  );
  assert(planEngineTransition(base, { ...base }) === "none", "identical target → none");

  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log("engineTransition check OK — 5 assertions passed");
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  selfCheck();
}
