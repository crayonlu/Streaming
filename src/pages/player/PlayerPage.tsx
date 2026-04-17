import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Radio,
  RefreshCw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/features/follow-button/ui/FollowButton";
import { cn } from "@/lib/utils";
import {
  buildRoomWebUrl,
  getRoomDetail,
  getStreamSources,
  recordLastVisited,
} from "@/shared/api/commands";
import type { PlatformId, StreamSource } from "@/shared/types/domain";
import { StatusView } from "@/shared/ui/StatusView";
import "xgplayer/dist/index.min.css";
import "@/app/styles/player.css";

// ── Custom React controls overlay ────────────────────────────────────────────
// Best practice: disable xgplayer's built-in controls entirely (controls:false)
// and render a fully custom React bar as an absolute overlay on the stage.
// This gives complete control over appearance, state, and behavior without
// fighting xgplayer's DOM structure or CSS specificity.

// ── QualitySelector ─────────────────────────────────────────────────────────
// Custom popup (non-Portal, lives inside .player-stage) so:
// 1. Mouse-leave on the stage correctly covers it (no spurious hide)
// 2. All styles inherit directly from player.css — zero shadcn token conflicts

interface QualitySelectorProps {
  sources: StreamSource[];
  selectedSource: StreamSource | null;
  failedSourceIds: Set<string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
}

function QualitySelector({
  sources,
  selectedSource,
  failedSourceIds,
  open,
  onOpenChange,
  onSelect,
}: QualitySelectorProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  const currentLabel = selectedSource?.qualityLabel ?? "";

  return (
    <div ref={rootRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        className="ctrl-btn ctrl-btn-label"
        aria-label="切换画质"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {currentLabel}
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

      {/* Popup panel — absolute, opens upward, styled to match the controls bar */}
      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions: popup backdrop stops click bubbling
        // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard nav handled by individual buttons inside
        <div className="player-quality-popup" onClick={(e) => e.stopPropagation()}>
          {sources.map((s) => {
            const isActive = s.id === selectedSource?.id;
            const isFailed = failedSourceIds.has(s.id);
            return (
              <button
                type="button"
                key={s.id}
                disabled={isFailed}
                className={cn(
                  "player-quality-item",
                  isActive && "is-active",
                  isFailed && "is-failed",
                )}
                onClick={() => {
                  if (!isFailed) {
                    onSelect(s.id);
                    onOpenChange(false);
                  }
                }}
              >
                <Check
                  size={11}
                  strokeWidth={2.2}
                  className={isActive ? "opacity-100 shrink-0" : "opacity-0 shrink-0"}
                />
                {s.qualityLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── ControlsBar ──────────────────────────────────────────────────────────────

interface ControlsBarProps {
  /** Ref to the xgplayer instance for imperative control */
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  playerRef: React.MutableRefObject<any>;
  /** The outer stage container used for fullscreen requests */
  stageRef: React.RefObject<HTMLDivElement | null>;
  sources: StreamSource[];
  selectedSource: StreamSource | null;
  failedSourceIds: Set<string>;
  onQualityChange: (id: string) => void;
}

function ControlsBar({
  playerRef,
  stageRef,
  sources,
  selectedSource,
  failedSourceIds,
  onQualityChange,
}: ControlsBarProps) {
  const [vol, setVol] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [isFs, setIsFs] = useState(false);
  const [visible, setVisible] = useState(true);
  // Quality popup state lives here so resetIdle can be called on close
  const [qualityOpen, setQualityOpen] = useState(false);
  const idleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ── Sync player state ──
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;

    setVol(p.volume ?? 0.7);
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
  }, [playerRef]);

  // ── Auto-hide ──
  const resetIdle = useCallback(() => {
    setVisible(true);
    clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => setVisible(false), 3500);
  }, []);

  const handleQualityOpen = useCallback(
    (open: boolean) => {
      setQualityOpen(open);
      if (open) {
        // Quality popup is inside the stage DOM (not a Portal), so mouse-leave
        // won't fire spuriously. But we still lock the idle timer while it's open.
        clearTimeout(idleRef.current);
        setVisible(true);
      } else {
        resetIdle();
      }
    },
    [resetIdle],
  );

  // ── Play / Pause ──
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

  // ── Fullscreen ──
  useEffect(() => {
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void el.requestFullscreen().catch(() => undefined);
    }
  }, [stageRef]);

  // ── Volume ──
  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    const next = !muted;
    p.muted = next;
    setMuted(next);
    try {
      localStorage.setItem("streaming_player_volume", next ? "0" : String(vol));
    } catch {}
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
      try {
        localStorage.setItem("streaming_player_volume", String(v));
      } catch {}
    },
    [playerRef],
  );

  const effectiveVol = muted ? 0 : vol;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: mouse-idle tracking overlay, not a semantic widget
    <div
      className="absolute inset-0 z-10 select-none"
      onMouseMove={resetIdle}
      onMouseEnter={resetIdle}
      onMouseLeave={() => {
        if (qualityOpen) return; // quality popup is inside → no spurious leave
        clearTimeout(idleRef.current);
        setVisible(false);
      }}
    >
      {/* ── Bottom controls bar ── */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, not a semantic action */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation only, not a semantic action */}
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
          {/* ── Live progress bar row ── */}
          <div className="flex items-center gap-2">
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-live px-1.5 py-0.5 text-[9px] font-semibold tracking-widest text-white uppercase">
              <Radio size={7} strokeWidth={2.5} />
              Live
            </span>
            <div className="flex-1 h-[3px] rounded-full overflow-hidden bg-white/15">
              <div className="h-full w-full rounded-full bg-white/55" />
            </div>
          </div>

          {/* ── Controls row ── */}
          <div className="flex items-center justify-between gap-1">
            {/* ── Left cluster: play + volume ── */}
            <div className="flex items-center gap-0.5">
              {/* Play / Pause */}
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

              {/* Mute toggle */}
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

              {/* Volume slider */}
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

            {/* ── Right cluster: quality + fullscreen ── */}
            <div className="flex items-center gap-1">
              {/* Quality selector — custom popup, stays inside stage DOM (no Portal)
                  so mouse-leave never fires spuriously and styles are fully ours */}
              {sources.length > 1 && (
                <QualitySelector
                  sources={sources}
                  selectedSource={selectedSource}
                  failedSourceIds={failedSourceIds}
                  open={qualityOpen}
                  onOpenChange={handleQualityOpen}
                  onSelect={onQualityChange}
                />
              )}

              {/* Fullscreen */}
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

// ── Utilities ────────────────────────────────────────────────────────────────

function isPlatform(value: string | undefined): value is PlatformId {
  return value === "bilibili" || value === "douyu";
}

const PLATFORM_LABEL: Record<string, string> = {
  bilibili: "Bilibili",
  douyu: "斗鱼",
};

// ── PlayerPage ───────────────────────────────────────────────────────────────

export function PlayerPage() {
  const params = useParams();
  const navigate = useNavigate();
  const platform = params.platform;
  const roomId = params.roomId;

  const playerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  const playerInstanceRef = useRef<any>(null);

  const [manualSourceId, setManualSourceId] = useState<string | null>(null);
  const [failedSourceIds, setFailedSourceIds] = useState<Set<string>>(new Set());
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  // Validate route params. All hooks are called unconditionally above and below
  // this check; `enabled: false` prevents queries from firing with bad params.
  const validRoute = isPlatform(platform) && !!roomId;

  const detailQuery = useQuery({
    queryKey: ["room-detail", platform, roomId],
    queryFn: () => getRoomDetail(platform as PlatformId, roomId as string),
    enabled: validRoute,
    retry: 2,
  });

  const streamQuery = useQuery({
    queryKey: ["stream-sources", platform, roomId, retryKey],
    queryFn: () => getStreamSources(platform as PlatformId, roomId as string),
    enabled: validRoute,
    retry: 2,
  });

  const room = detailQuery.data;
  const sources = streamQuery.data ?? [];
  const allFailed = sources.length > 0 && failedSourceIds.size >= sources.length;

  // Record visit — runs when room data arrives
  useEffect(() => {
    if (room && isPlatform(platform) && roomId) {
      void recordLastVisited({ type: "room", platform, roomId });
    }
  }, [room, platform, roomId]);

  const selectedSource: StreamSource | null = useMemo(() => {
    if (!sources.length) return null;
    if (manualSourceId) {
      const matched = sources.find((s) => s.id === manualSourceId);
      if (matched && !failedSourceIds.has(matched.id)) return matched;
    }
    const available = sources.filter((s) => !failedSourceIds.has(s.id));
    if (!available.length) return null;
    return available.find((s) => s.isDefault) ?? available[0];
  }, [sources, manualSourceId, failedSourceIds]);

  const handleSourceError = useCallback((source: StreamSource) => {
    setFailedSourceIds((prev) => new Set([...prev, source.id]));
  }, []);

  const handleRetryAll = () => {
    setFailedSourceIds(new Set());
    setManualSourceId(null);
    setPlaybackError(null);
    setRetryKey((k) => k + 1);
  };

  // ── xgplayer lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedSource) {
      if (!streamQuery.isLoading) {
        setPlaybackError(allFailed ? "所有播放源均不可用，请重试" : "暂无可用播放源");
      }
      return;
    }

    const mountEl = playerRef.current;
    if (!mountEl) return;
    setPlaybackError(null);

    let disposed = false;
    let playerInstance: {
      destroy?: () => void;
      on?: (event: string, cb: () => void) => void;
      off?: (event: string, cb: () => void) => void;
    } | null = null;

    const capturedSource = selectedSource;

    const bootstrap = async () => {
      try {
        const [{ default: Player }, { default: HlsPlugin }, { default: FlvPlugin }] =
          await Promise.all([
            import("xgplayer"),
            import("xgplayer-hls.js"),
            import("xgplayer-flv"),
          ]);

        if (disposed) return;

        // Restore persisted volume
        const savedVol = (() => {
          try {
            const v = Number(localStorage.getItem("streaming_player_volume"));
            return Number.isFinite(v) ? v : 0.7;
          } catch {
            return 0.7;
          }
        })();

        // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
        playerInstance = new (Player as any)({
          el: mountEl,
          url: capturedSource.streamUrl,
          poster: room?.coverUrl ?? undefined,
          fluid: true,
          autoplay: true,
          playsinline: true,
          muted: false,
          volume: savedVol,
          isLive: true,
          lang: "zh-cn",
          // ── Completely disable xgplayer's built-in controls ──────────
          // We replace them entirely with the React ControlsBar overlay.
          controls: false,
          // ── Stream-specific options ──────────────────────────────────
          ...(capturedSource.format === "flv"
            ? {
                flv: {
                  isLive: true,
                  cors: true,
                  autoCleanupSourceBuffer: true,
                  enableWorker: true,
                  stashInitialSize: 128,
                },
              }
            : {
                hls: {
                  isLive: true,
                  retryCount: 3,
                  retryDelay: 2000,
                  enableWorker: true,
                  withCredentials: false,
                  lowLatencyMode: false,
                },
              }),
          plugins: [capturedSource.format === "hls" ? HlsPlugin : FlvPlugin],
        });

        // Expose instance to React controls overlay
        playerInstanceRef.current = playerInstance;

        (playerInstance as NonNullable<typeof playerInstance>).on?.("error", () => {
          if (!disposed) handleSourceError(capturedSource);
        });
      } catch (error) {
        if (disposed) return;
        setPlaybackError(error instanceof Error ? error.message : "播放器初始化失败");
      }
    };

    void bootstrap();

    return () => {
      disposed = true;
      playerInstance?.destroy?.();
      playerInstance = null;
      playerInstanceRef.current = null;
      if (mountEl) mountEl.innerHTML = "";
    };
  }, [room?.coverUrl, selectedSource, handleSourceError, allFailed, streamQuery.isLoading]);

  // ── Early return after all hooks ────────────────────────────────────────────
  if (!validRoute) {
    return <StatusView title="无效的播放链接" tone="error" />;
  }

  const isLoading = detailQuery.isLoading || streamQuery.isLoading;
  const isError = detailQuery.isError || streamQuery.isError;

  const openExternal = () => {
    void openUrl(buildRoomWebUrl(platform, roomId));
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3.5 h-full">
      {/* ── Room info bar ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(-1)}
            className="shrink-0 -ml-1"
          >
            <ArrowLeft size={15} />
          </Button>

          {isLoading ? (
            <div className="flex flex-col gap-1.5">
              <div className="h-4 w-44 animate-pulse rounded bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            </div>
          ) : room ? (
            <div className="min-w-0">
              <h1 className="clamp-1 text-sm font-semibold leading-snug">{room.title}</h1>
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                <span className="clamp-1 max-w-[120px]">{room.streamerName}</span>
                <span className="text-border shrink-0">·</span>
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 h-3.5 rounded-full shrink-0 font-normal"
                >
                  {PLATFORM_LABEL[room.platform] ?? room.platform}
                </Badge>
                {room.areaName && (
                  <>
                    <span className="text-border shrink-0">·</span>
                    <span className="clamp-1 max-w-[100px] shrink-0">{room.areaName}</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {room && (
          <div className="shrink-0">
            <FollowButton
              room={{
                platform: room.platform,
                roomId: room.roomId,
                followed: room.followed,
                title: room.title,
                streamerName: room.streamerName,
                coverUrl: room.coverUrl ?? "",
              }}
            />
          </div>
        )}
      </div>

      {/* ── Video stage ── */}
      <div className="flex-1 min-h-0">
        {isError ? (
          <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-border/60 bg-muted/30 min-h-[400px] h-full">
            <StatusView title="暂时无法播放" tone="error" hint="平台风控或房间未开播" />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryAll}
                className="gap-1.5 text-xs"
              >
                <RefreshCw size={12} />
                重试
              </Button>
              <Button variant="ghost" size="sm" onClick={openExternal} className="gap-1.5 text-xs">
                <ExternalLink size={12} />
                外部打开
              </Button>
            </div>
          </div>
        ) : (
          // Stage: xgplayer mount + React controls overlay
          <div ref={stageRef} className="player-stage relative overflow-hidden w-full h-full">
            {/* xgplayer mounts into this div */}
            <div ref={playerRef} className="absolute inset-0" />

            {/* React controls overlay — only shown when stream is ready */}
            {!isLoading && !playbackError && selectedSource && (
              <ControlsBar
                playerRef={playerInstanceRef}
                stageRef={stageRef}
                sources={sources}
                selectedSource={selectedSource}
                failedSourceIds={failedSourceIds}
                onQualityChange={(id) => {
                  setManualSourceId(id);
                  setFailedSourceIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                }}
              />
            )}

            {/* No-source overlay */}
            {!selectedSource && !streamQuery.isLoading && (
              <div
                className="absolute inset-0 flex flex-col items-center justify-center gap-3.5"
                style={{ background: "rgba(5,6,8,0.78)" }}
              >
                <p
                  className={cn(
                    "text-sm font-medium",
                    allFailed ? "text-red-400" : "text-white/55",
                  )}
                >
                  {playbackError ?? "暂无可用流"}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRetryAll}
                    className="gap-1.5 text-xs text-white/70 hover:text-white hover:bg-white/10 border-white/15 border"
                  >
                    <RefreshCw size={11} />
                    重试
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={openExternal}
                    className="gap-1.5 text-xs text-white/45 hover:text-white/70 hover:bg-white/8"
                  >
                    <ExternalLink size={11} />
                    外部打开
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
