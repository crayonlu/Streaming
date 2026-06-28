/**
 * VideoPlayer — thin wrapper over usePlayerEngine.
 *
 * Mounts a <video> element, drives the engine via the hook, and renders the
 * React controls overlay. Props surface stays compatible with the previous
 * xgplayer wrapper so PlayerPage / ReplayPage need no changes here.
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Loader2, WifiOff } from "lucide-react";
import "@/app/styles/player.css";
import { ControlsOverlay } from "./ControlsOverlay";
import {
  type PlayerController,
  type PlayerFormat,
  usePlayerEngine,
} from "../model/usePlayerEngine";
import { useOnlineStatus } from "../model/useOnlineStatus";

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
  onUserPlay?: () => void;
  onUserPause?: () => void;
  /** Fires once when playback ends (VOD). */
  onEnded?: () => void;
  /** Fires once when playback enters the final 8 seconds (VOD), for prefetch. */
  onNearEnd?: () => void;
  instanceRef?: React.MutableRefObject<PlayerController | null>;
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
  onUserPlay,
  onUserPause,
  onEnded,
  onNearEnd,
  instanceRef,
}: VideoPlayerProps) {
  const { videoRef, controller, ready, error } = usePlayerEngine({
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

  const stageRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: ControlsOverlay expects a mutable ref
  const ctrlRef = useRef<any>(null);

  // Surface the controller to the parent (mirrors the old instanceRef contract).
  useEffect(() => {
    if (instanceRef) instanceRef.current = controller;
  }, [instanceRef, controller]);

  // Keep the stable ref fed to ControlsOverlay in sync with the latest controller.
  ctrlRef.current = controller;

  // VOD end-of-playback callbacks: onNearEnd fires once 8s before the end
  // (for prefetching the next part), onEnded fires when playback finishes.
  // Reset + re-bind whenever the source changes.
  const nearEndFiredRef = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: videoRef is a stable ref; .current is read at bind time
  useEffect(() => {
    nearEndFiredRef.current = false;
    if (isLive) return;
    const v = videoRef.current;
    if (!v) return;
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
  }, [isLive, onEnded, onNearEnd]);

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
        />
      )}

      {!online && streamUrl && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
          <WifiOff size={28} strokeWidth={1.6} className="text-white/60" />
          <span className="text-sm text-white/70">网络已断开 · 等待重连</span>
        </div>
      )}

      {/* Loading: before ready or while buffering */}
      {streamUrl && !error && <LoadingOverlay videoRef={videoRef} ready={ready} />}

      {/* Error: in-place recovery exhausted */}
      {error && streamUrl && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-sm">
          <AlertCircle size={28} strokeWidth={1.6} className="text-white/60" />
          <span className="text-sm text-white/70">播放失败 · 正在尝试恢复</span>
        </div>
      )}
    </section>
  );
}

// Shows a spinner until ready AND the <video> has buffered past HAVE_CURRENT_DATA.
function LoadingOverlay({
  videoRef,
  ready,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  ready: boolean;
}) {
  const [buffering, setBuffering] = useState(!ready);
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

  if (!buffering) return null;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
      <Loader2 size={30} className="animate-spin text-white/60" strokeWidth={1.8} />
    </div>
  );
}
