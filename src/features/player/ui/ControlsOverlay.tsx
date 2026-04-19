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
  playerReady: boolean;
  qualities: PlayerQualityItem[];
  selectedQualityId: string | null | undefined;
  onQualityChange: (id: string) => void;
}

export function ControlsOverlay({
  playerRef,
  stageRef,
  isLive,
  playerReady,
  qualities,
  selectedQualityId,
  onQualityChange,
}: ControlsOverlayProps) {
  const [vol, setVol] = useState(readVol);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const [visible, setVisible] = useState(true);
  const [qualityOpen, setQualityOpen] = useState(false);

  const idleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Sync player events ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!playerReady) return;
    const p = playerRef.current;
    if (!p) return;

    setVol(p.volume ?? readVol());
    setMuted(p.muted ?? false);
    setPlaying(!p.paused);

    const onVolumeChange = () => {
      setVol(p.volume ?? 0.7);
      setMuted(p.muted ?? false);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);

    p.on?.("volumechange", onVolumeChange);
    p.on?.("play", onPlay);
    p.on?.("pause", onPause);
    return () => {
      p.off?.("volumechange", onVolumeChange);
      p.off?.("play", onPlay);
      p.off?.("pause", onPause);
    };
  }, [playerRef, playerReady]);

  // ── Fullscreen sync ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // ── Keyboard shortcuts (Space, M, F) ───────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
        return;

      const p = playerRef.current;
      if (!p) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (p.paused) {
            p.play?.();
            setPlaying(true);
          } else {
            p.pause?.();
            setPlaying(false);
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
          if (stageRef.current) {
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
            else void stageRef.current.requestFullscreen().catch(() => undefined);
          }
          break;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [playerRef, stageRef, muted]);

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
    if (p.paused) {
      p.play?.();
      setPlaying(true);
    } else {
      p.pause?.();
      setPlaying(false);
    }
  }, [playerRef]);

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
    <div
      className="absolute inset-0 z-10 select-none"
      onMouseMove={resetIdle}
      onMouseEnter={resetIdle}
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
