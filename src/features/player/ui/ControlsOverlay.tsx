/**
 * ControlsOverlay
 *
 * Custom player controls rendered as a React overlay on top of xgplayer.
 * Includes play/pause, volume, quality selector, fullscreen, and VOD scrub bar.
 */

import { Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PlayerProgress } from "./PlayerProgress";
import { QualityMenu } from "./QualityMenu";
import type { PlayerQualityItem } from "./VideoPlayer";

function readVol(): number {
  try {
    const v = Number(localStorage.getItem("streaming_player_volume"));
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7;
  } catch {
    return 0.7;
  }
}

function saveVol(v: number) {
  try {
    localStorage.setItem("streaming_player_volume", String(v));
  } catch {}
}

// ── ControlsOverlay ───────────────────────────────────────────────────────────

export interface ControlsOverlayProps {
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  playerRef: React.MutableRefObject<any>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  isLive: boolean;
  /** Called when the player stage should receive focus (e.g. after click) */
  onFocusStage?: () => void;
  playerReady: boolean;
  qualities: PlayerQualityItem[];
  selectedQualityId: string | null | undefined;
  onQualityChange: (id: string) => void;
  onUserPlay?: () => void;
  onUserPause?: () => void;
}

export function ControlsOverlay({
  playerRef,
  stageRef,
  isLive,
  playerReady,
  qualities,
  selectedQualityId,
  onQualityChange,
  onFocusStage,
  onUserPlay,
  onUserPause,
}: ControlsOverlayProps) {
  const [vol, setVol] = useState(readVol);
  const [muted, setMuted] = useState(false);
  // Start as false; the xgplayer event listeners below are the single source
  // of truth.  Once the player fires "play"/"playing" we flip to true.
  const [playing, setPlaying] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [visible, setVisible] = useState(true);
  const [qualityOpen, setQualityOpen] = useState(false);

  const idleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(idleRef.current), []);

  // ── Sync player events ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!playerReady) return;
    const p = playerRef.current;
    if (!p) return;

    // Sync initial values from player instance
    setVol(p.volume ?? readVol());
    setMuted(p.muted ?? false);
    setPlaying(!p.paused);

    const onVolumeChange = () => {
      setVol(p.volume ?? 0.7);
      setMuted(p.muted ?? false);
    };
    // "playing" fires when playback actually starts (after buffering).
    // "play"    fires when play() is called (before buffering completes).
    // "pause"   fires when the player actually pauses.
    // "waiting" fires when buffering stalls playback — treat as not-playing.
    // "ended"   fires when VOD reaches the end.
    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onWaiting = () => setPlaying(false);
    const onEnded = () => setPlaying(false);

    p.on?.("volumechange", onVolumeChange);
    p.on?.("playing", onPlaying);
    p.on?.("pause", onPause);
    p.on?.("waiting", onWaiting);
    p.on?.("ended", onEnded);
    return () => {
      p.off?.("volumechange", onVolumeChange);
      p.off?.("playing", onPlaying);
      p.off?.("pause", onPause);
      p.off?.("waiting", onWaiting);
      p.off?.("ended", onEnded);
    };
  }, [playerRef, playerReady]);

  // ── Fullscreen sync ─────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Bound to the player stage container (stageRef) rather than document, so
  // shortcuts don't fire when the user is typing elsewhere in the app.
  // Fallback guard on INPUT/TEXTAREA/contentEditable is kept for safety.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;

      const p = playerRef.current;
      if (!p) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          // Don't setPlaying here — let xgplayer events drive the state.
          if (p.paused) {
            p.play?.();
            onUserPlay?.();
          } else {
            p.pause?.();
            onUserPause?.();
          }
          break;
        case "m":
        case "M": {
          e.preventDefault();
          const next = !muted;
          p.muted = next;
          setMuted(next);
          break;
        }
        case "f":
        case "F":
          e.preventDefault();
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          else void el.requestFullscreen().catch(() => undefined);
          break;
        case "ArrowLeft":
          if (!isLive) {
            e.preventDefault();
            if (typeof p.currentTime === "number") {
              p.currentTime = Math.max(0, p.currentTime - 10);
            }
          }
          break;
        case "ArrowRight":
          if (!isLive) {
            e.preventDefault();
            if (typeof p.currentTime === "number" && typeof p.duration === "number") {
              p.currentTime = Math.min(p.duration, p.currentTime + 10);
            }
          }
          break;
        case "ArrowUp": {
          e.preventDefault();
          const nextVol = Math.min(1, (p.volume ?? vol) + 0.1);
          p.volume = nextVol;
          p.muted = false;
          setVol(nextVol);
          setMuted(false);
          saveVol(nextVol);
          break;
        }
        case "ArrowDown": {
          e.preventDefault();
          const nextVol = Math.max(0, (p.volume ?? vol) - 0.1);
          p.volume = nextVol;
          p.muted = nextVol === 0;
          setVol(nextVol);
          setMuted(nextVol === 0);
          saveVol(nextVol);
          break;
        }
      }
    };
    el.addEventListener("keydown", handler);
    return () => el.removeEventListener("keydown", handler);
  }, [playerRef, stageRef, muted, vol, isLive, onUserPlay, onUserPause]);

  // ── Idle timer ──────────────────────────────────────────────────────────────
  const resetIdle = useCallback(() => {
    setVisible(true);
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setVisible(false), 3500);
  }, []);

  const handleQualityOpen = useCallback(
    (open: boolean) => {
      setQualityOpen(open);
      if (open) {
        clearTimeout(idleRef.current);
        setVisible(true);
      } else resetIdle();
    },
    [resetIdle],
  );

  // ── Controls ────────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    // Don't setPlaying here — xgplayer "playing" / "pause" events are the
    // single source of truth for the playing state.
    if (p.paused) {
      p.play?.();
      onUserPlay?.();
    } else {
      p.pause?.();
      onUserPause?.();
    }
  }, [playerRef, onUserPlay, onUserPause]);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void el.requestFullscreen().catch(() => undefined);
  }, [stageRef]);

  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    const next = !muted;
    p.muted = next;
    setMuted(next);
    saveVol(next ? 0 : vol);
  }, [muted, vol, playerRef]);

  const handleVolume = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      const p = playerRef.current;
      if (!p) return;
      p.volume = v;
      p.muted = v === 0;
      setVol(v);
      setMuted(v === 0);
      saveVol(v);
    },
    [playerRef],
  );

  const effectiveVol = muted ? 0 : vol;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-idle tracking overlay
    // biome-ignore lint/a11y/useKeyWithClickEvents: focus intent only, keyboard shortcuts handled on stageRef
    <div
      className="absolute inset-0 z-10 select-none"
      onMouseMove={resetIdle}
      onMouseEnter={resetIdle}
      onClick={onFocusStage}
      onMouseLeave={() => {
        if (qualityOpen) return;
        clearTimeout(idleRef.current);
        setVisible(false);
      }}
    >
      {/* ── Bottom controls bar ── */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only */}
      <div
        className={cn(
          "absolute bottom-0 left-0 right-0 transition-all duration-200",
          visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none",
        )}
        onClick={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
      >
        {/* Gradient scrim */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(3,4,6,0.88) 0%, rgba(3,4,6,0.32) 60%, transparent 100%)",
          }}
          aria-hidden
        />

        <div className="relative px-3 pb-2.5 pt-9 flex flex-col gap-2">
          {/* ── Progress row ── */}
          <PlayerProgress playerRef={playerRef} isLive={isLive} playerReady={playerReady} />

          {/* ── Controls row ── */}
          <div className="flex items-center justify-between gap-1">
            {/* Left: play + volume */}
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={togglePlay}
                className="ctrl-btn"
                aria-label={playing ? "暂停" : "播放"}
              >
                {playing ? (
                  <Pause size={15} strokeWidth={1.9} />
                ) : (
                  <Play size={15} strokeWidth={1.9} />
                )}
              </button>
              <button
                type="button"
                onClick={toggleMute}
                className="ctrl-btn"
                aria-label={muted ? "取消静音" : "静音"}
              >
                {effectiveVol === 0 ? (
                  <VolumeX size={15} strokeWidth={1.8} />
                ) : (
                  <Volume2 size={15} strokeWidth={1.8} />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.025}
                value={effectiveVol}
                onChange={handleVolume}
                aria-label="音量"
                aria-valuenow={Math.round(effectiveVol * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
                className="vol-slider"
                style={{
                  background: `linear-gradient(90deg,rgba(255,255,255,0.78) ${effectiveVol * 100}%,rgba(255,255,255,0.18) ${effectiveVol * 100}%)`,
                }}
              />
            </div>

            {/* Right: quality + fullscreen */}
            <div className="flex items-center gap-1">
              {qualities.length > 1 && (
                <QualityMenu
                  items={qualities}
                  selectedId={selectedQualityId}
                  open={qualityOpen}
                  onOpenChange={handleQualityOpen}
                  onSelect={onQualityChange}
                />
              )}
              <button
                type="button"
                onClick={toggleFullscreen}
                className="ctrl-btn"
                aria-label={isFs ? "退出全屏" : "全屏"}
              >
                {isFs ? (
                  <Minimize2 size={15} strokeWidth={1.8} />
                ) : (
                  <Maximize2 size={15} strokeWidth={1.8} />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
