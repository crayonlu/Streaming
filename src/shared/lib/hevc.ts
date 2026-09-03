/**
 * HEVC codec-brand compatibility shim.
 *
 * Some Windows WebView2 builds report `hev1.*` as unsupported by
 * MediaSource.isTypeSupported while accepting `hvc1.*` for the same HEVC
 * stream. Both hls.js and mpegts.js ask MSE with the `hev1` brand and then
 * refuse to play. When (and only when) the environment shows that mismatch
 * we install a global shim that rewrites the brand in the probe string.
 */

export type HevcSupport = "hev1" | "hvc1" | "none";

const HEV1_PROBE = 'video/mp4; codecs="hev1.1.6.L93.B0"';
const HVC1_PROBE = 'video/mp4; codecs="hvc1.1.6.L93.B0"';

let cached: HevcSupport | null = null;

export function detectHevcSupport(isTypeSupported?: (mime: string) => boolean): HevcSupport {
  if (isTypeSupported) {
    if (isTypeSupported(HEV1_PROBE)) return "hev1";
    if (isTypeSupported(HVC1_PROBE)) return "hvc1";
    return "none";
  }
  if (cached) return cached;
  let result: HevcSupport = "none";
  try {
    const ms = window.MediaSource;
    if (ms?.isTypeSupported) {
      result = detectHevcSupport(ms.isTypeSupported.bind(ms));
    }
  } catch {
    // keep "none"
  }
  cached = result;
  return result;
}

/** Rewrite only the codec brand token; everything else in the MIME stays. */
export function rewriteHevcMime(mime: string): string {
  return mime.replace(/\bhev1\./g, "hvc1.");
}

let installed = false;

export function installHevcCodecShim(): void {
  if (installed) return;
  installed = true;
  // Only rewrite when the environment prefers hvc1. Native hev1 support or
  // no HEVC support at all both make the shim pointless.
  if (detectHevcSupport() !== "hvc1") return;
  try {
    const orig = window.MediaSource.isTypeSupported.bind(window.MediaSource);
    window.MediaSource.isTypeSupported = (mime: string) =>
      orig(/\bhev1\./.test(mime) ? rewriteHevcMime(mime) : mime);
  } catch {
    // Non-critical — playback of HEVC streams may fail on this platform.
  }
}

/** Reset internal caches — test/self-check only. */
export function _resetHevcForTest() {
  cached = null;
  installed = false;
}

// ── self-check ──────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`hevc check FAILED: ${msg}`);
}

function selfCheck() {
  assert(rewriteHevcMime(HEV1_PROBE) === HVC1_PROBE, "rewrites hev1 brand");
  assert(
    rewriteHevcMime('video/mp4; codecs="avc1.640028"') === 'video/mp4; codecs="avc1.640028"',
    "leaves avc untouched",
  );
  assert(
    rewriteHevcMime('video/mp4; codecs="hvc1.1.6.L93.B0"') === HVC1_PROBE,
    "leaves hvc1 untouched",
  );
  assert(detectHevcSupport(() => true) === "hev1", "prefers native hev1");
  assert(detectHevcSupport((m) => m.includes("hvc1")) === "hvc1", "detects hvc1-only environment");
  assert(detectHevcSupport(() => false) === "none", "detects no support");
  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log("hevc check OK — 6 assertions passed");
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  selfCheck();
}
