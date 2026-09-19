/**
 * VideoPlayer — thin wrapper over usePlayerEngine.
 *
 * Mounts a <video> element, drives the engine via the hook, and renders the
 * React controls overlay. Props surface stays compatible with the previous
 * xgplayer wrapper so PlayerPage / ReplayPage need no changes here.
 */

import { AlertCircle, Loader2, WifiOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { os } from "@/shared/lib/os";
import "@/app/styles/player.css";
import { detectHevcSupport } from "@/shared/lib/hevc";
import { type NowPlayingInfo, useNowPlaying } from "../model/useNowPlaying";
import { useOnlineStatus } from "../model/useOnlineStatus";
import {
  type PlayerController,
  type PlayerFormat,
  usePlayerEngine,
} from "../model/usePlayerEngine";
import { useVisibilityResume } from "../model/useVisibilityResume";
import { ControlsOverlay } from "./ControlsOverlay";

export interface PlayerQualityItem {
  id: string;
  label: string;
  cdn?: string;
  failed?: boolean;
}

export interface VideoPlayerProps {
  streamUrl: string;
  isLive?: boolean;
  format?: PlayerFormat;
  poster?: string;
  qualities?: PlayerQualityItem[];
  selectedQualityId?: string | null;
  onQualityChange?: (id: string) => void;
  onError?: () => void;
  onPlaybackStall?: (reason: "error" | "waiting-timeout") => void;
  onPlaybackRecovered?: () => void;
  onUserPlay?: () => void;
  onUserPause?: () => void;
  /** Fires once when playback ends (VOD). */
  onEnded?: () => void;
  /** Fires once when playback enters the final 8 seconds (VOD), for prefetch. */
  onNearEnd?: () => void;
  instanceRef?: React.MutableRefObject<PlayerController | null>;
  /** Extra layer rendered above <video> and below controls (e.g. danmaku).
   *  Must be inside the stage for fullscreen. */
  overlaySlot?: React.ReactNode;
  /** Extra buttons in the right cluster of the controls bar. */
  controlsEndSlot?: React.ReactNode;
  /** Overrides the static error-overlay text during stall recovery
   *  (e.g. "播放失败 · 正在重新拉流（第 2 次）"). */
  recoveryHint?: string;
  /** Stream identity mirrored into the OS tray / macOS menu bar.
   *  Omit (or pass null) to leave the tray untouched. */
  nowPlaying?: NowPlayingInfo | null;
}

export function VideoPlayer({
  streamUrl,
  isLive = true,
  format = "hls",
  poster,
  qualities = [],
  selectedQualityId,
  onQualityChange,
  onError,
  onPlaybackStall,
  onPlaybackRecovered,
  onUserPlay,
  onUserPause,
  onEnded,
  onNearEnd,
  instanceRef,
  overlaySlot,
  controlsEndSlot,
  recoveryHint,
  nowPlaying,
}: VideoPlayerProps) {
  const { videoRef, controller, ready, error, codecUnsupported } = usePlayerEngine({
    url: streamUrl,
    format,
    isLive,
    onRecoverableFailure: (reason) => {
      if (reason === "stall") {
        onPlaybackStall?.("waiting-timeout");
      } else {
        onError?.();
        onPlaybackStall?.("error");
      }
    },
  });

  const online = useOnlineStatus();

  // Publish what is playing to the tray, and let the tray menu drive the
  // media element back.
  useNowPlaying(nowPlaying, videoRef);
  // Nudge the engine back to life when the window returns from another Space
  // (macOS parks invisible windows — see useVisibilityResume).
  useVisibilityResume(videoRef, controller.engine);

  const stageRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: ControlsOverlay expects a mutable ref
  const ctrlRef = useRef<any>(null);

  // Surface the controller to the parent (mirrors the old instanceRef contract).
  useEffect(() => {
    if (instanceRef) instanceRef.current = controller;
  }, [instanceRef, controller]);

  // Keep the stable ref fed to ControlsOverlay in sync with the latest controller.
  ctrlRef.current = controller;

  const nearEndFiredRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isLive || !onPlaybackRecovered) return;
    video.addEventListener("playing", onPlaybackRecovered);
    return () => video.removeEventListener("playing", onPlaybackRecovered);
  }, [isLive, onPlaybackRecovered, videoRef]);

  // VOD: onNearEnd fires once 8s before the end (for prefetching the next
  // part), onEnded fires when playback finishes.
  // LIVE: a dropped FLV/HLS connection surfaces as "ended" rather than an
  // error (mpegts.js completes cleanly when the TCP stream closes), so we
  // route it into the stall-recovery path which refetches stream sources.
  // biome-ignore lint/correctness/useExhaustiveDependencies: videoRef is a stable ref; .current is read at bind time
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    if (isLive) {
      const onLiveEnd = () => onPlaybackStall?.("error");
      v.addEventListener("ended", onLiveEnd);
      return () => v.removeEventListener("ended", onLiveEnd);
    }

    nearEndFiredRef.current = false;
    const onTime = () => {
      if (nearEndFiredRef.current) return;
      const remaining = (v.duration || 0) - v.currentTime;
      if (Number.isFinite(remaining) && remaining <= 8) {
        nearEndFiredRef.current = true;
        onNearEnd?.();
      }
    };
    const onEnd = () => onEnded?.();
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("ended", onEnd);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("ended", onEnd);
    };
  }, [isLive, onEnded, onNearEnd, onPlaybackStall]);

  return (
    <section
      ref={stageRef as React.RefObject<HTMLElement | null>}
      aria-label="视频播放器"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: player container needs focus for keyboard shortcuts
      tabIndex={0}
      className="player-stage relative overflow-hidden w-full h-full focus:outline-none"
    >
      <video
        ref={videoRef}
        poster={poster}
        playsInline
        autoPlay
        className="absolute inset-0 w-full h-full"
      >
        <track kind="captions" />
      </video>

      {overlaySlot}

      {streamUrl && (
        <ControlsOverlay
          playerRef={ctrlRef}
          stageRef={stageRef}
          isLive={isLive}
          playerReady={ready}
          qualities={qualities}
          selectedQualityId={selectedQualityId}
          onQualityChange={onQualityChange ?? (() => undefined)}
          onFocusStage={() => stageRef.current?.focus()}
          onUserPlay={onUserPlay}
          onUserPause={onUserPause}
          controlsEndSlot={controlsEndSlot}
        />
      )}

      {/* Informational overlays below are pointer-events-none on purpose:
          they sit above the controls bar, and without this a buffering or
          error state swallows every click — including the fullscreen exit
          button (only Esc worked). */}
      {!online && streamUrl && (
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
          <WifiOff size={28} strokeWidth={1.6} className="text-white/60" />
          <span className="text-sm text-white/70">网络已断开 · 等待重连</span>
        </div>
      )}

      {/* Loading: before ready or while buffering */}
      {online && streamUrl && !error && !codecUnsupported && (
        <LoadingOverlay videoRef={videoRef} ready={ready} />
      )}

      {/* Terminal failure: the WebView cannot decode H.264/AAC at all
          (Linux WebKitGTK without GStreamer decoder packages). Refetching
          stream sources cannot help — show the fix instead of a spinner. */}
      {online && codecUnsupported && streamUrl && (
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
          <AlertCircle size={28} strokeWidth={1.6} className="text-white/60" />
          <span className="text-sm text-white/70">当前系统缺少视频解码器，无法播放</span>
          <span className="text-xs text-white/40">
            {os === "linux"
              ? "请安装 gstreamer1.0-libav、gstreamer1.0-plugins-bad 后重启应用"
              : "请检查系统或 WebView 的解码组件安装情况"}
          </span>
        </div>
      )}

      {/* Error: in-place recovery exhausted */}
      {online && error && !codecUnsupported && streamUrl && (
        <div className="absolute inset-0 z-20 pointer-events-none flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
          <AlertCircle size={28} strokeWidth={1.6} className="text-white/60" />
          <span className="text-sm text-white/70">{recoveryHint ?? "播放失败 · 正在尝试恢复"}</span>
          {detectHevcSupport() === "none" && (
            <span className="text-xs text-white/40">
              当前系统可能缺少 HEVC 解码支持（Windows 请安装「HEVC 视频扩展」）
            </span>
          )}
        </div>
      )}
    </section>
  );
}

// Shows a spinner until ready AND the <video> has buffered past HAVE_CURRENT_DATA.
// The overlay itself is debounced: on Linux, software decoding hiccups fire
// brief "waiting" events constantly and an instant overlay visibly flickers.
function LoadingOverlay({
  videoRef,
  ready,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
}) {
  const [buffering, setBuffering] = useState(!ready);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => setBuffering(v.readyState < 3);
    sync();
    v.addEventListener("waiting", sync);
    v.addEventListener("canplay", sync);
    const onPlaying = () => setBuffering(false);
    v.addEventListener("playing", onPlaying);
    return () => {
      v.removeEventListener("waiting", sync);
      v.removeEventListener("canplay", sync);
      v.removeEventListener("playing", onPlaying);
    };
  }, [videoRef]);

  // Only surface the overlay once buffering has persisted for a while.
  useEffect(() => {
    if (!buffering) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 400);
    return () => clearTimeout(t);
  }, [buffering]);

  if (!show) return null;
  return (
    <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center bg-black/40">
      <Loader2 size={30} className="animate-spin text-white/60" strokeWidth={1.8} />
    </div>
  );
}
