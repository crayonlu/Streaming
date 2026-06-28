/**
 * usePlayerEngine — owns hls.js / mpegts.js lifecycle and exposes a stable
 * controller the controls layer can drive.
 *
 * The controller proxies to the underlying <video> element plus engine-specific
 * helpers, keeping ControlsOverlay's expected surface intact (play/pause/seek/
 * volume/muted/paused/duration/fullscreen + on/off event bus).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { INITIAL_RECOVERY_STATE, type RecoveryState, planHlsRecovery } from "./recovery";

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
  stopLoad?: () => void;
  recoverMediaError?: () => void;
  swapAudioCodec?: () => void;
  loadSource?: (url: string) => void;
  liveSyncPosition?: number;
  on?: (e: string, fn: (...args: unknown[]) => void) => void;
  off?: (e: string, fn: (...args: unknown[]) => void) => void;
};

function readVol(): number {
  try {
    const v = Number(localStorage.getItem("streaming_player_volume"));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
  } catch {
    return 0.7;
  }
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

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);

  // ── Engine bootstrap (rebuilt only when format/isLive changes) ─────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let engine: AnyEngine | null = null;

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

    const bootstrap = async () => {
      if (format === "hls") {
        const { default: Hls } = await import("hls.js");
        if (disposed) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: false,
            liveSyncDurationCount: 3,
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
          hls.loadSource(url);
          engine = hls as unknown as AnyEngine;
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = url;
        }
      } else if (format === "flv") {
        const { default: mpegts } = await import("mpegts.js");
        if (disposed) return;
        const player = mpegts.createPlayer(
          { type: "flv", isLive, url },
          { enableWorker: true, lazyLoad: false, autoCleanupSourceBuffer: true },
        );
        player.attachMediaElement(video);
        player.on(mpegts.Events.ERROR, onFlvError);
        player.load();
        engine = player as unknown as AnyEngine;
      } else {
        video.src = url;
      }

      if (disposed) {
        engine?.destroy?.();
        return;
      }
      engineRef.current = engine;
      void video.play().catch(() => undefined);
      setReady(true);
    };

    void bootstrap();

    return () => {
      disposed = true;
      setReady(false);
      setError(false);
      recoveryRef.current = INITIAL_RECOVERY_STATE;
      engine?.destroy?.();
      engineRef.current = null;
      video.removeAttribute("src");
    };
  }, [format, isLive, url]);

  // ── Live stall detection: waiting > 10s surfaces as a recoverable failure ─
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
  }, [isLive, ready]);

  // ── Controller (stable surface for ControlsOverlay) ────────────────────────
  const getController = useCallback((): PlayerController => {
    const v = videoRef.current;
    const wrap = {
      play: () => Promise.resolve(v?.play()),
      pause: () => v?.pause(),
      seek: (t: number) => {
        if (v) v.currentTime = t;
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
  return { videoRef, controller, ready, error };
}
