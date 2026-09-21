/**
 * usePlayerEngine — owns hls.js / mpegts.js lifecycle and exposes a stable
 * controller the controls layer can drive.
 *
 * The controller proxies to the underlying <video> element plus engine-specific
 * helpers, keeping ControlsOverlay's expected surface intact (play/pause/seek/
 * volume/muted/paused/duration/fullscreen + on/off event bus).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { os } from "@/shared/lib/os";
import { type EngineTarget, planEngineTransition } from "./engineTransition";
import { INITIAL_RECOVERY_STATE, planHlsRecovery, type RecoveryState } from "./recovery";
import { planSourceCommit } from "./sourceCommit";

export type PlayerFormat = "hls" | "flv" | "mp4";

export interface PlayerEngineOptions {
  url: string;
  format: PlayerFormat;
  isLive: boolean;
  /** Called when all in-place recovery is exhausted; parent should refresh the source. */
  onRecoverableFailure?: (reason: "error" | "stall") => void;
}

export interface PlayerController {
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  seekToLiveEdge(): void;
  readonly liveLatency: number;
  readonly currentTime: number;
  readonly duration: number;
  readonly paused: boolean;
  volume: number;
  muted: boolean;
  readonly fullscreen: boolean;
  getFullscreen(el?: HTMLElement): Promise<void>;
  exitFullscreen(): void;
  on(event: string, fn: (...args: unknown[]) => void): void;
  off(event: string, fn: (...args: unknown[]) => void): void;
  /** engine instance (hls.js Hls or mpegts.js Player) for advanced callers */
  readonly engine: unknown;
}

type AnyEngine = {
  destroy?: () => void;
  startLoad?: (pos?: number) => void;
  recoverMediaError?: () => void;
  swapAudioCodec?: () => void;
  loadSource?: (url: string) => void;
  liveSyncPosition?: number;
  on?: (e: string, fn: (...args: unknown[]) => void) => void;
  off?: (e: string, fn: (...args: unknown[]) => void) => void;
};

type MpegtsModule = typeof import("mpegts.js")["default"];

function readVol(): number {
  try {
    const v = Number(localStorage.getItem("streaming_player_volume"));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
  } catch {
    return 0.7;
  }
}

/**
 * Builds an mpegts.js Player against `video` and starts loading `url`.
 * mpegts.js bakes the URL into the instance at creation, so swapping source
 * means a new Player over the same media element — never a new media element.
 */
function createFlvPlayer(
  mpegts: MpegtsModule,
  video: HTMLVideoElement,
  url: string,
  isLive: boolean,
  onError: () => void,
): AnyEngine {
  const player = mpegts.createPlayer(
    { type: "flv", isLive, url },
    {
      enableWorker: true,
      lazyLoad: false,
      autoCleanupSourceBuffer: true,
      // Live FLV delivery is bursty: measured against a Bilibili CDN route,
      // chunks arrive 0–30ms apart but pause for ~625–755ms about once every
      // 1.3s. The chaser seeks forward whenever buffered latency exceeds
      // maxLatency, and leaves only `minRemain` buffered behind it — so
      // `minRemain` is the entire stall budget. At 2s, two consecutive pauses
      // (1.4s) plus continuous consumption empty the buffer, which is the
      // periodic "watch a while → stutter" loop: chase, starve, stall, chase.
      // Raise the floor to ~3x the longest measured pause so a burst arriving
      // late cannot starve playback, while maxLatency still bounds the delay.
      // Linux WebKitGTK decodes in software, so the buffered latency grows in
      // erratic steps; the default tight cap makes the chaser yank the
      // playhead forward every few seconds (visible jitter), so relax it there.
      ...(isLive
        ? {
            liveBufferLatencyChasing: true,
            liveBufferLatencyMaxLatency: os === "linux" ? 14 : 10,
            liveBufferLatencyMinRemain: os === "linux" ? 6 : 4,
          }
        : {}),
    },
  );
  player.attachMediaElement(video);
  player.on(mpegts.Events.ERROR, onError);
  // A live FLV stream that ends cleanly (server closed the connection)
  // fires LOADING_COMPLETE instead of ERROR — treat it as a drop.
  if (isLive) player.on(mpegts.Events.LOADING_COMPLETE, onError);
  player.load();
  return player as unknown as AnyEngine;
}

export function usePlayerEngine({
  url,
  format,
  isLive,
  onRecoverableFailure,
}: PlayerEngineOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const engineRef = useRef<AnyEngine | null>(null);
  const recoveryRef = useRef<RecoveryState>(INITIAL_RECOVERY_STATE);
  const onFailRef = useRef(onRecoverableFailure);
  onFailRef.current = onRecoverableFailure;

  // Coalescing window for the desired URL (see sourceCommit.ts).
  const lastChangeAtRef = useRef(0);
  const pendingSinceRef = useRef(0);
  // Latest URL, read by the async bootstrap below: the dynamic import() may
  // still be in flight when a URL change lands, and the newest value must win
  // rather than the one captured when the effect body first ran.
  const urlRef = useRef(url);
  const prevUrlRef = useRef<string | null>(null);
  if (prevUrlRef.current !== url) {
    prevUrlRef.current = url;
    urlRef.current = url;
    // Only a genuine change starts a coalescing window. Re-renders carrying
    // the same URL must not push `lastChangeAt` forward, or a burst could
    // never settle.
    lastChangeAtRef.current = Date.now();
    if (pendingSinceRef.current === 0) pendingSinceRef.current = lastChangeAtRef.current;
  }
  // Target currently loaded into engineRef; null until an engine has loaded
  // something, and again after teardown.
  const targetRef = useRef<EngineTarget | null>(null);
  // Loads a URL into the live engine in place. Set once the engine exists and
  // cleared on teardown, so a late URL change cannot resurrect a dead engine.
  const loadSourceRef = useRef<((nextUrl: string) => void) | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  // Terminal condition, not recoverable by refetch: the WebView has no MSE
  // codec support (e.g. WebKitGTK without GStreamer decoders). Surfaced
  // separately so the UI can show a decoder hint instead of spinning forever.
  const [codecUnsupported, setCodecUnsupported] = useState(false);

  // ── Engine lifecycle ──────────────────────────────────────────────────────
  // Deliberately split from the URL effect below. React runs an effect's
  // cleanup before re-running that same effect, so one effect keyed on the URL
  // could never observe the previous engine: its own cleanup had already
  // destroyed it and nulled the ref. This effect owns creation/teardown and
  // only re-runs when the engine family changes; the URL effect reloads the
  // source into the surviving engine, so a quality/line switch costs no
  // black frame and no `ready` flip.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = readVol();

    let disposed = false;
    let nextEngine: AnyEngine | null = null;

    recoveryRef.current = INITIAL_RECOVERY_STATE;
    setError(false);
    setCodecUnsupported(false);

    const onHlsError = (hls: AnyEngine, data: { fatal: boolean; type: string }) => {
      const { action, next } = planHlsRecovery(data, recoveryRef.current, Date.now());
      recoveryRef.current = next;
      switch (action.kind) {
        case "ignore":
          return;
        case "recoverMedia":
          hls.recoverMediaError?.();
          return;
        case "recoverMediaSwapCodec":
          hls.swapAudioCodec?.();
          hls.recoverMediaError?.();
          return;
        case "startLoad":
          hls.startLoad?.();
          return;
        case "reloadSource":
          setError(true);
          onFailRef.current?.("error");
          return;
        default:
          return;
      }
    };

    const onFlvError = () => {
      setError(true);
      onFailRef.current?.("error");
    };

    // In-place source swap: same engine family, new URL. VOD keeps its position
    // across the switch; live re-seeks to the edge from MANIFEST_PARSED
    // (hls.js) or the mpegts latency chaser.
    const reload = (nextUrl: string, load: (u: string) => void) => {
      const resumeAt = !isLive && Number.isFinite(video.currentTime) ? video.currentTime : 0;
      recoveryRef.current = INITIAL_RECOVERY_STATE;
      setError(false);
      load(nextUrl);
      if (!isLive && resumeAt > 0) {
        const restore = () => {
          video.currentTime = Math.min(
            resumeAt,
            Number.isFinite(video.duration) ? video.duration : resumeAt,
          );
          video.removeEventListener("loadedmetadata", restore);
        };
        video.addEventListener("loadedmetadata", restore);
      }
      void video.play().catch(() => undefined);
    };

    const bootstrap = async () => {
      // Loads a URL into this family's engine. hls.js reuses the instance
      // already attached to the media element; mpegts.js and the plain-mp4
      // path (re)build their attachment on demand.
      let load: (u: string) => void;

      if (format === "hls") {
        const { default: Hls } = await import("hls.js");
        if (disposed) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            liveSyncDurationCount: 3,
            // Cap retained playback history — without this the back buffer
            // grows unbounded on long live sessions and playback stutters.
            backBufferLength: isLive ? 30 : Infinity,
          });
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_e: unknown, data: { fatal: boolean; type: string }) =>
            onHlsError(hls as unknown as AnyEngine, data),
          );
          if (isLive) {
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              const edge = hls.liveSyncPosition;
              if (edge !== null && Number.isFinite(edge)) video.currentTime = edge;
            });
          }
          nextEngine = hls as unknown as AnyEngine;
          load = (u) => hls.loadSource(u);
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          load = (u) => {
            video.src = u;
          };
        } else {
          // No MSE and no native HLS — nothing can ever start; fail fast
          // with the decoder hint instead of spinning forever.
          setCodecUnsupported(true);
          return;
        }
      } else if (format === "flv") {
        const { default: mpegts } = await import("mpegts.js");
        if (disposed) return;
        if (!mpegts.isSupported()) {
          setCodecUnsupported(true);
          return;
        }
        load = (u) => {
          nextEngine?.destroy?.();
          nextEngine = createFlvPlayer(mpegts, video, u, isLive, onFlvError);
          engineRef.current = nextEngine;
        };
      } else {
        load = (u) => {
          video.src = u;
        };
      }

      if (disposed) {
        nextEngine?.destroy?.();
        return;
      }

      const initialUrl = urlRef.current;
      load(initialUrl);
      engineRef.current = nextEngine;
      targetRef.current = { url: initialUrl, format, isLive };
      loadSourceRef.current = (nextUrl) => {
        if (disposed) return;
        reload(nextUrl, load);
      };
      void video.play().catch(() => undefined);
      setReady(true);
    };

    void bootstrap();

    return () => {
      disposed = true;
      setReady(false);
      setError(false);
      setCodecUnsupported(false);
      recoveryRef.current = INITIAL_RECOVERY_STATE;
      loadSourceRef.current = null;
      targetRef.current = null;
      nextEngine?.destroy?.();
      engineRef.current = null;
      video.removeAttribute("src");
    };
  }, [format, isLive]);

  // ── Source commit ─────────────────────────────────────────────────────────
  // A new URL inside the same engine family reloads in place: no destroy, no
  // `setReady(false)`, no `video.removeAttribute("src")` — so the controls
  // keep their bindings and the <video> keeps its identity.
  //
  // The reload is *coalesced*, not immediate. hls.js `loadSource()` tears the
  // MediaSource down and rebuilds it, so applying every click synchronously
  // costs one full re-buffer per click (measured: 24 clicks → 24 MediaSources
  // and 24 playback restarts in ~1.1s, which freezes the UI and leaves the
  // playhead back at the live edge). `planSourceCommit` waits for the burst to
  // settle and then loads only the newest URL.
  useEffect(() => {
    const next: EngineTarget = { url, format, isLive };
    if (planEngineTransition(targetRef.current, next) !== "reload") return;

    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      const load = loadSourceRef.current;
      // Engine still being built (dynamic import in flight): the lifecycle
      // effect loads `urlRef` — the newest URL — as soon as it is up.
      if (!load) return;
      const plan = planSourceCommit({
        desiredUrl: url,
        committedUrl: targetRef.current?.url ?? null,
        lastChangeAt: lastChangeAtRef.current,
        pendingSince: pendingSinceRef.current,
        now: Date.now(),
      });
      if (plan.kind === "defer") {
        timer = setTimeout(schedule, plan.delayMs);
        return;
      }
      // Committed, or the burst came back to what is already playing. Either
      // way the pending window is over.
      pendingSinceRef.current = 0;
      if (plan.kind === "noop") return;
      load(url);
      targetRef.current = next;
    };

    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [url, format, isLive]);

  // ── Live stall detection: waiting > 10s surfaces as a recoverable failure ─
  // `url` is a dependency on purpose: re-subscribing clears a pending timer, so
  // a stall that started on the previous source cannot be reported against the
  // new one, which is still filling its buffer. The recovery policy treats
  // back-to-back stalls as one incident, but this keeps the signal itself clean
  // at the source.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `url` is a reset trigger, not a value this effect reads
  useEffect(() => {
    if (!isLive || !ready) return;
    const video = videoRef.current;
    if (!video) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onWaiting = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        onFailRef.current?.("stall");
      }, 10_000);
    };
    const onPlaying = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    return () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      if (timer) clearTimeout(timer);
    };
  }, [isLive, ready, url]);

  // ── Controller (stable surface for ControlsOverlay) ────────────────────────
  const getController = useCallback((): PlayerController => {
    const v = videoRef.current;
    const wrap = {
      play: () => Promise.resolve(v?.play()),
      pause: () => v?.pause(),
      seek: (t: number) => {
        if (v) v.currentTime = t;
      },
      seekToLiveEdge: () => {
        if (!v) return;
        const engineEdge = engineRef.current?.liveSyncPosition;
        const bufferedEdge = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
        const edge = Number.isFinite(engineEdge) ? Number(engineEdge) : bufferedEdge;
        if (edge > 0) v.currentTime = edge;
      },
      get liveLatency() {
        if (!v) return 0;
        const engineEdge = engineRef.current?.liveSyncPosition;
        const bufferedEdge = v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
        const edge = Number.isFinite(engineEdge) ? Number(engineEdge) : bufferedEdge;
        return Math.max(0, edge - v.currentTime);
      },
      get currentTime() {
        return v?.currentTime ?? 0;
      },
      set currentTime(t: number) {
        if (v) v.currentTime = t;
      },
      get duration() {
        return v?.duration ?? 0;
      },
      get paused() {
        return v?.paused ?? true;
      },
      get volume() {
        return v?.volume ?? readVol();
      },
      set volume(val: number) {
        if (v) v.volume = val;
      },
      get muted() {
        return v?.muted ?? false;
      },
      set muted(val: boolean) {
        if (v) v.muted = val;
      },
      get fullscreen() {
        return Boolean(document.fullscreenElement);
      },
      getFullscreen: (el?: HTMLElement) => {
        const target = el ?? v?.parentElement;
        return target?.requestFullscreen?.() ?? Promise.resolve();
      },
      exitFullscreen: () => document.exitFullscreen?.(),
      on: (event: string, fn: (...args: unknown[]) => void) => {
        v?.addEventListener(event, fn as EventListener);
      },
      off: (event: string, fn: (...args: unknown[]) => void) => {
        v?.removeEventListener(event, fn as EventListener);
      },
      get engine() {
        return engineRef.current;
      },
    };
    return wrap;
  }, []);

  const controller = getController();
  return { videoRef, controller, ready, error, codecUnsupported };
}
