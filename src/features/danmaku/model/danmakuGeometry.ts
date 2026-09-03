/**
 * Danmaku density geometry (ported from DTV, MIT).
 *
 * danmu.js uses virtual channels; channelSize should roughly match bullet
 * height. maxBullets caps on-screen bullets — under burst load we drop new
 * danmaku rather than overlap/stutter.
 */

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export function channelSizeFor(fontSizePx: number): number {
  return clamp(Math.round(fontSizePx + 10), 28, 64);
}

export function areaLinesFor(hostHeight: number, area: number, fontSizePx: number): number {
  if (hostHeight <= 0) return 1;
  const visibleHeight = Math.max(1, Math.floor(hostHeight * area));
  return clamp(Math.floor(visibleHeight / channelSizeFor(fontSizePx)), 1, 60);
}

export function maxBulletsFor(hostHeight: number, area: number, fontSizePx: number): number {
  return areaLinesFor(hostHeight, area, fontSizePx) * 4;
}

export const FONT_SIZE_MAP = { small: 16, medium: 20, large: 26 } as const;
export type DanmakuFontSize = keyof typeof FONT_SIZE_MAP;

// ── self-check ──────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`danmakuGeometry check FAILED: ${msg}`);
}

function selfCheck() {
  assert(channelSizeFor(20) === 30, "20px font → 30 channel");
  assert(channelSizeFor(4) === 28, "tiny font clamped to 28");
  assert(channelSizeFor(100) === 64, "huge font clamped to 64");
  assert(areaLinesFor(600, 1, 20) === 20, "600px full area → 20 lines");
  assert(areaLinesFor(600, 0.5, 20) === 10, "half area → 10 lines");
  assert(areaLinesFor(0, 1, 20) === 1, "zero height → 1 line floor");
  assert(areaLinesFor(100000, 1, 16) === 60, "line cap at 60");
  assert(maxBulletsFor(600, 1, 20) === 80, "maxBullets = lines * 4");
  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log("danmakuGeometry check OK — 8 assertions passed");
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  selfCheck();
}
