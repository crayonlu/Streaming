/**
 * VideoPlayer
 *
 * Unified xgplayer wrapper used by both the live player (PlayerPage) and the
 * VOD replay player (ReplayPage).  All custom controls are rendered as a React
 * overlay so xgplayer is always mounted with `controls: false`.
 *
 * Props:
 *   streamUrl        — HLS / FLV URL (changing it remounts the player)
 *   isLive           — true  → live mode (static progress bar + LIVE badge)
 *                      false → VOD mode  (interactive scrub bar)
 *   format           — "hls" | "flv"   (default "hls")
 *   poster           — optional poster image
 *   qualities        — list of quality options to show in the selector
 *   selectedQuality  — currently active quality id
 *   onQualityChange  — called when user picks a different quality
 *   onError          — called when xgplayer emits an "error" event
 *   instanceRef      — optional ref that receives the live xgplayer instance
 */

import {
  Check,
  ChevronDown,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import "xgplayer/dist/index.min.css";
import "@/app/styles/player.css";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PlayerQualityItem {
  id: string;
  label: string;
  /** Marks a CDN source that already failed (live only) */
  failed?: boolean;
}

export interface VideoPlayerProps {
  streamUrl: string;
  isLive?: boolean;
  format?: "hls" | "flv";
  poster?: string;
  qualities?: PlayerQualityItem[];
  selectedQualityId?: string | null;
  onQualityChange?: (id: string) => void;
  onError?: () => void;
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  instanceRef?: React.MutableRefObject<any>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

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

// ── QualityMenu ───────────────────────────────────────────────────────────────

interface QualityMenuProps {
  items: PlayerQualityItem[];
  selectedId: string | null | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (id: string) => void;
}

function QualityMenu({ items, selectedId, open, onOpenChange, onSelect }: QualityMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="ctrl-btn ctrl-btn-label"
        aria-label="切换画质"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {selected?.label ?? "画质"}
        <ChevronDown
          size={10}
          strokeWidth={2.2}
          className="shrink-0 opacity-55"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: popup backdrop stops click bubbling
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav handled by buttons inside
        <div className="player-quality-popup" onClick={(e) => e.stopPropagation()}>
          {items.map((item) => {
            const isActive = item.id === selectedId;
            return (
              <button
                type="button"
                key={item.id}
                disabled={item.failed}
                className={cn(
                  "player-quality-item",
                  isActive && "is-active",
                  item.failed && "is-failed",
                )}
                onClick={() => {
                  if (!item.failed) {
                    onSelect(item.id);
                    onOpenChange(false);
                  }
                }}
              >
                <Check
                  size={11}
                  strokeWidth={2.2}
                  className={isActive ? "opacity-100 shrink-0" : "opacity-0 shrink-0"}
                />
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ControlsOverlay ───────────────────────────────────────────────────────────

interface ControlsOverlayProps {
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  playerRef: React.MutableRefObject<any>;
  stageRef: React.RefObject<HTMLDivElement | null>;
  isLive: boolean;
  playerReady: boolean;
  qualities: PlayerQualityItem[];
  selectedQualityId: string | null | undefined;
  onQualityChange: (id: string) => void;
}

function ControlsOverlay({
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

  // VOD-only progress state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const seeking = useRef(false);

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
    const onDurationChange = () => setDuration(p.duration ?? 0);

    p.on?.("volumechange", onVolumeChange);
    p.on?.("play", onPlay);
    p.on?.("pause", onPause);
    if (!isLive) {
      p.on?.("durationchange", onDurationChange);
      p.on?.("loadedmetadata", onDurationChange);
    }

    return () => {
      p.off?.("volumechange", onVolumeChange);
      p.off?.("play", onPlay);
      p.off?.("pause", onPause);
      if (!isLive) {
        p.off?.("durationchange", onDurationChange);
        p.off?.("loadedmetadata", onDurationChange);
      }
    };
  }, [playerRef, isLive, playerReady]);

  // ── VOD current-time polling (250 ms) ────────────────────────────────────
  // xgplayer's timeupdate fires per HLS segment boundary for some streams,
  // giving minute-level precision. Polling media.currentTime directly is
  // more reliable and stays accurate across all segment lengths.
  useEffect(() => {
    if (isLive || !playerReady) return;
    const p = playerRef.current;
    if (!p) return;
    const id = setInterval(() => {
      if (!seeking.current) {
        const t = (p.video ?? p.media)?.currentTime ?? p.currentTime ?? 0;
        setCurrentTime(t);
      }
    }, 250);
    return () => clearInterval(id);
  }, [playerRef, isLive, playerReady]);

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

  // VOD seek
  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = Number(e.target.value);
      setCurrentTime(t);
      const p = playerRef.current;
      if (p?.seek) p.seek(t);
      else if (p) p.currentTime = t;
    },
    [playerRef],
  );

  const effectiveVol = muted ? 0 : vol;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

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
          {isLive ? (
            /* Live: static "LIVE" badge + non-interactive bar */
            <div className="flex items-center gap-2">
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-live px-1.5 py-0.5 text-[9px] font-semibold tracking-widest text-white uppercase">
                <Radio size={7} strokeWidth={2.5} />
                Live
              </span>
              <div className="flex-1 h-0.75 rounded-full overflow-hidden bg-white/15">
                <div className="h-full w-full rounded-full bg-white/55" />
              </div>
            </div>
          ) : (
            /* VOD: interactive scrub bar with timestamps */
            <div className="flex items-center gap-2">
              <span className="shrink-0 tabular-nums text-[10px] text-white/55">
                {fmtTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={1}
                value={currentTime}
                onMouseDown={() => {
                  seeking.current = true;
                }}
                onMouseUp={() => {
                  seeking.current = false;
                }}
                onChange={handleSeek}
                aria-label="播放进度"
                className="vol-slider flex-1"
                style={{
                  background: `linear-gradient(90deg, rgba(255,255,255,0.75) ${progress}%, rgba(255,255,255,0.15) ${progress}%)`,
                }}
              />
              <span className="shrink-0 tabular-nums text-[10px] text-white/40">
                {fmtTime(duration)}
              </span>
            </div>
          )}

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
  const instanceRef = useRef<any>(null);
  const [playerReady, setPlayerReady] = useState(false);

  // ── Mount / remount xgplayer whenever streamUrl or format changes ──────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el || !streamUrl) return;

    let disposed = false;
    // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
    let inst: any = null;

    const boot = async () => {
      const [{ default: Player }, { default: HlsPlugin }, { default: FlvPlugin }] =
        await Promise.all([import("xgplayer"), import("xgplayer-hls.js"), import("xgplayer-flv")]);

      if (disposed) return;

      // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
      inst = new (Player as any)({
        el,
        url: streamUrl,
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
          : {
              hls: {
                isLive,
                retryCount: 3,
                retryDelay: 2000,
                enableWorker: true,
                withCredentials: false,
                lowLatencyMode: false,
              },
            }),
        plugins: [format === "flv" ? FlvPlugin : HlsPlugin],
      });

      instanceRef.current = inst;
      if (externalRef) externalRef.current = inst;
      setPlayerReady(true);

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
          onError?.();
        }
      });

      // ── Stream recovery: reload if waiting > 10s ─────────────────────
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
      inst?.destroy?.();
      inst = null;
      instanceRef.current = null;
      if (externalRef) externalRef.current = null;
      if (el) el.innerHTML = "";
    };
  }, [streamUrl, format, isLive, poster, onError, externalRef]);

  return (
    <div ref={stageRef} className="player-stage relative overflow-hidden w-full h-full">
      {/* xgplayer mount target */}
      <div ref={mountRef} className="absolute inset-0" />

      {/* Custom controls overlay — always rendered after player mounts */}
      {streamUrl && (
        <ControlsOverlay
          playerRef={instanceRef}
          stageRef={stageRef}
          isLive={isLive}
          playerReady={playerReady}
          qualities={qualities}
          selectedQualityId={selectedQualityId}
          onQualityChange={onQualityChange ?? (() => undefined)}
        />
      )}
    </div>
  );
}
