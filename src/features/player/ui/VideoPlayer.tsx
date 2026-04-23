/**
 * VideoPlayer
 *
 * Unified xgplayer wrapper used by both the live player (PlayerPage) and the
 * VOD replay player (ReplayPage).  All custom controls are rendered as a React
 * overlay so xgplayer is always mounted with `controls: false`.
 *
 * Props:
 *   streamUrl        — HLS / FLV URL (switches source in-place via switchURL)
 *   isLive           — true  → live mode (static progress bar + LIVE badge)
 *                      false → VOD mode  (interactive scrub bar)
 *   format           — "hls" | "flv" | "mp4"   (default "hls")
 *   poster           — optional poster image
 *   qualities        — list of quality options to show in the selector
 *   selectedQuality  — currently active quality id
 *   onQualityChange  — called when user picks a different quality
 *   onError          — called when xgplayer emits an "error" event
 *   instanceRef      — optional ref that receives the live xgplayer instance
 *
 * Lifecycle:
 *   - Player instance is created when format/isLive changes (structural rebuild)
 *   - streamUrl changes use switchURL() — no destroy/recreate, preserving time
 */

// ── Module-level cache for xgplayer imports ───────────────────────────────────
// biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
let cachedModules: Promise<{ Player: any; HlsPlugin: any; FlvPlugin: any }> | null = null;

function getXgplayerModules() {
  if (!cachedModules) {
    cachedModules = Promise.all([
      import("xgplayer"),
      import("xgplayer-hls.js"),
      import("xgplayer-flv"),
    ]).then(([{ default: Player }, { default: HlsPlugin }, { default: FlvPlugin }]) => ({
      Player,
      HlsPlugin,
      FlvPlugin,
    }));
  }
  return cachedModules;
}

import { useEffect, useRef, useState } from "react";
import "xgplayer/dist/index.min.css";
import "@/app/styles/player.css";
import { ControlsOverlay } from "./ControlsOverlay";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlayerQualityItem {
  id: string;
  label: string;
  cdn?: string;
  failed?: boolean;
}

export interface VideoPlayerProps {
  streamUrl: string;
  isLive?: boolean;
  format?: "hls" | "flv" | "mp4";
  poster?: string;
  qualities?: PlayerQualityItem[];
  selectedQualityId?: string | null;
  onQualityChange?: (id: string) => void;
  onError?: () => void;
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  instanceRef?: React.MutableRefObject<any>;
}

function readVol(): number {
  try {
    const v = Number(localStorage.getItem("streaming_player_volume"));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
  } catch {
    return 0.7;
  }
}

// ── Player lifecycle ──────────────────────────────────────────────────────────
// Architecture:
//   - Player instance is created ONCE when format/isLive changes (structural rebuild)
//   - When only streamUrl changes (quality switch), the existing player switches
//     source WITHOUT destruction — preserving currentTime, playback state, etc.
//   - This eliminates the "destroy → recreate → restore time" fragility entirely.

// ── VideoPlayer (main export) ─────────────────────────────────────────────────

export function VideoPlayer({
  streamUrl,
  isLive = true,
  format = "hls",
  poster,
  qualities = [],
  selectedQualityId,
  onQualityChange,
  onError,
  instanceRef: externalRef,
}: VideoPlayerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  const instRef = useRef<any>(null);
  const [playerReady, setPlayerReady] = useState(false);

  const latestStreamUrlRef = useRef(streamUrl);
  const activeStreamUrlRef = useRef<string | null>(null);
  const onErrorRef = useRef(onError);

  latestStreamUrlRef.current = streamUrl;
  onErrorRef.current = onError;

  // ── Single lifecycle effect ──────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el || !latestStreamUrlRef.current) return;

    let disposed = false;
    // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
    let bootInst: any = null;
    const pendingTimers: ReturnType<typeof setTimeout>[] = [];

    const boot = async () => {
      // biome-ignore lint/suspicious/noConsole: debug
      console.log("[VideoPlayer] boot START", { format, isLive, disposed });

      const { Player, HlsPlugin, FlvPlugin } = await getXgplayerModules();

      if (disposed) {
        // biome-ignore lint/suspicious/noConsole: debug
        console.log("[VideoPlayer] boot ABORTED (disposed after module load)");
        return;
      }

      // ── Full rebuild path: destroy old + create new ──────────────────────────
      const existing = instRef.current;
      if (existing) {
        // biome-ignore lint/suspicious/noConsole: debug
        console.log("[VideoPlayer] destroying previous instance before rebuild");
        existing.destroy?.();
      }
      instRef.current = null;
      el.innerHTML = "";

      const initialUrl = latestStreamUrlRef.current;
      const inst = new (Player as any)({
        el,
        url: initialUrl,
        poster: poster ?? undefined,
        fluid: true,
        autoplay: true,
        playsinline: true,
        volume: readVol(),
        muted: false,
        isLive,
        lang: "zh-cn",
        controls: false,
        ...(format === "flv"
          ? {
              flv: {
                isLive,
                cors: true,
                autoCleanupSourceBuffer: true,
                enableWorker: true,
                stashInitialSize: 128,
              },
            }
          : format === "hls"
            ? {
                hls: {
                  isLive,
                  retryCount: 3,
                  retryDelay: 2000,
                  enableWorker: true,
                  withCredentials: false,
                  lowLatencyMode: false,
                },
              }
            : {}),
        plugins: format === "mp4" ? [] : [format === "flv" ? FlvPlugin : HlsPlugin],
      });

      bootInst = inst;
      instRef.current = inst;
      activeStreamUrlRef.current = initialUrl;
      if (externalRef) externalRef.current = inst;
      setPlayerReady(true);

      // Guard: if component unmounted while Player was constructing (modules
      // cached → no await suspension between disposed=true and new Player).
      if (disposed) {
        inst.destroy?.();
        instRef.current = null;
        bootInst = null;
        activeStreamUrlRef.current = null;
        if (externalRef) externalRef.current = null;
        return;
      }

      // ── Auto-retry on error (up to 3 times with increasing delay) ───────
      let retryCount = 0;
      const maxRetries = 3;
      const retryDelays = [1000, 3000, 5000];

      inst.on?.("error", () => {
        if (disposed) return;
        if (retryCount < maxRetries) {
          const delay = retryDelays[retryCount] ?? 5000;
          retryCount++;
          setTimeout(() => {
            if (disposed) return;
            inst?.reload?.();
          }, delay);
        } else {
          onErrorRef.current?.();
        }
      });

      // ── Stream recovery: reload if waiting > 10s ─────────────────────────
      if (isLive) {
        let waitingTimer: ReturnType<typeof setTimeout> | null = null;

        inst.on?.("waiting", () => {
          if (disposed) return;
          if (waitingTimer) return;
          waitingTimer = setTimeout(() => {
            waitingTimer = null;
            if (disposed) return;
            inst?.reload?.();
          }, 10_000);
        });

        inst.on?.("playing", () => {
          if (waitingTimer) {
            clearTimeout(waitingTimer);
            waitingTimer = null;
          }
        });
      }
    };

    void boot();

    return () => {
      disposed = true;
      setPlayerReady(false);

      // Always destroy on cleanup — boot() has its own disposed guard and
      // will recreate the player if it still needs to run.  The previous
      // conditional (`structuralChanged || unmounting`) was incorrect:
      // `unmounting` relied on el.parentElement which stays attached during
      // React StrictMode double-invoke and normal re-renders, so the player
      // was never destroyed and kept playing audio after navigation.
      const target = instRef.current ?? bootInst;
      target?.destroy?.();
      instRef.current = null;
      bootInst = null;
      activeStreamUrlRef.current = null;
      if (externalRef) externalRef.current = null;
      if (el) el.innerHTML = "";
      for (const t of pendingTimers) clearTimeout(t);
      pendingTimers.length = 0;
    };
  }, [format, isLive, poster, externalRef]);

  // ── Source lifecycle: quality changes reuse the current instance ─────────
  useEffect(() => {
    const inst = instRef.current;
    if (!inst || !streamUrl || activeStreamUrlRef.current === streamUrl) return;

    const media = inst.video ?? inst.media;
    const resumeTime = isLive ? 0 : (media?.currentTime ?? inst.currentTime ?? 0);
    const wasPaused = Boolean(media?.paused ?? inst.paused);
    let restored = false;

    const restoreVodPosition = () => {
      if (restored) return;
      restored = true;
      if (!isLive && resumeTime > 0) {
        if (typeof inst.seek === "function") inst.seek(resumeTime);
        else if (media) media.currentTime = resumeTime;
      }
      if (!wasPaused) void inst.play?.();
      setPlayerReady(true);
    };

    activeStreamUrlRef.current = streamUrl;
    setPlayerReady(false);
    inst.on?.("loadedmetadata", restoreVodPosition);
    inst.on?.("canplay", restoreVodPosition);

    if (typeof inst.switchURL === "function") inst.switchURL(streamUrl);
    else inst.src = streamUrl;

    const fallbackTimer = setTimeout(restoreVodPosition, 800);

    return () => {
      clearTimeout(fallbackTimer);
      inst.off?.("loadedmetadata", restoreVodPosition);
      inst.off?.("canplay", restoreVodPosition);
    };
  }, [streamUrl, isLive]);

  return (
    <section
      ref={stageRef}
      aria-label="视频播放器"
      // tabIndex={0} makes the container focusable so keyboard shortcuts work
      // when the user clicks into the player or tabs to it.
      // biome-ignore lint/a11y/noNoninteractiveTabindex: player container needs focus for keyboard shortcuts
      tabIndex={0}
      className="player-stage relative overflow-hidden w-full h-full focus:outline-none"
    >
      {/* xgplayer mount target */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Custom controls overlay — always rendered after player mounts */}
      {streamUrl && (
        <ControlsOverlay
          playerRef={instRef}
          stageRef={stageRef}
          isLive={isLive}
          playerReady={playerReady}
          qualities={qualities}
          selectedQualityId={selectedQualityId}
          onQualityChange={onQualityChange ?? (() => undefined)}
          onFocusStage={() => stageRef.current?.focus()}
        />
      )}
    </section>
  );
}
