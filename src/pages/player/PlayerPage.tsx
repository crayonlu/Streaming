import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink, Film, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDanmakuStore } from "@/features/danmaku/model/useDanmakuStore";
import { DanmakuControls } from "@/features/danmaku/ui/DanmakuControls";
import { DanmakuOverlay } from "@/features/danmaku/ui/DanmakuOverlay";
import { FollowButton } from "@/features/follow-button/ui/FollowButton";
import {
  createLiveRecoveryState,
  type LiveRecoveryState,
  liveRecoveryDelayMs,
  planLiveRecovery,
  resetStallBudget,
  reviveSources,
  STALL_WATCHDOG_MS,
} from "@/features/player/model/liveRecovery";
import { useBilibiliAuth } from "@/features/player/model/useBilibiliAuth";
import { useOnlineStatus } from "@/features/player/model/useOnlineStatus";
import type { PlayerController } from "@/features/player/model/usePlayerEngine";
import { useStreamLifecycle } from "@/features/player/model/useStreamLifecycle";
import type { PlayerQualityItem } from "@/features/player/ui/VideoPlayer";
import { VideoPlayer } from "@/features/player/ui/VideoPlayer";
import { cn } from "@/lib/utils";
import {
  buildRoomWebUrl,
  getRoomDetail,
  getStreamSources,
  recordLastVisited,
} from "@/shared/api/commands";
import { isPlatform, PLATFORM_LABEL } from "@/shared/lib/platform";
import { supportsReplay as canReplay } from "@/shared/lib/replay";
import type { PlatformId, StreamSource } from "@/shared/types/domain";
import { StatusView } from "@/shared/ui/StatusView";
import { getPlaybackStatus } from "./playbackStatus";
import { type ManualSelection, selectionOf, selectStreamSource } from "./selectSource";

// ── PlayerPage ────────────────────────────────────────────────────────────────

function formatOnline(n: number): string {
  return n >= 10_000 ? `${(n / 10_000).toFixed(1)}万` : String(n);
}

export function PlayerPage() {
  const params = useParams();
  const navigate = useNavigate();
  const platform = params.platform;
  const roomId = params.roomId;

  const [manualSelection, setManualSelection] = useState<ManualSelection | null>(null);
  const [recovery, setRecovery] = useState<LiveRecoveryState>(createLiveRecoveryState);
  const [retryKey, setRetryKey] = useState(0);
  const recoveryRef = useRef(recovery);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controllerRef = useRef<PlayerController | null>(null);
  const { loginState: bilibiliLoginState, login: handleBilibiliLogin } = useBilibiliAuth(platform);
  const streamLifecycle = useStreamLifecycle();
  const onlineCount = useDanmakuStore((s) => s.onlineCount);

  const validRoute = isPlatform(platform) && !!roomId;

  const detailQuery = useQuery({
    queryKey: ["room-detail", platform, roomId],
    queryFn: () => getRoomDetail(platform as PlatformId, roomId as string),
    enabled: validRoute,
    retry: 2,
  });

  const streamQuery = useQuery({
    queryKey: ["stream-sources", platform, roomId, retryKey],
    queryFn: async () => {
      const result = await getStreamSources(platform as PlatformId, roomId as string);
      // Record successful fetch so we know when the URL becomes stale.
      streamLifecycle.recordFetch();
      return result;
    },
    enabled: validRoute,
    retry: 2,
  });

  const room = detailQuery.data;
  const sources = streamQuery.data ?? [];
  const failedSourceIds = recovery.failed;
  const availableSourceCount = sources.reduce(
    (count, source) => (failedSourceIds.has(source.id) ? count : count + 1),
    0,
  );
  const allFailed = sources.length > 0 && availableSourceCount === 0;

  // Record visit
  useEffect(() => {
    if (room && isPlatform(platform) && roomId) {
      void recordLastVisited({ type: "room", platform, roomId });
    }
  }, [room, platform, roomId]);

  // Resolve the active source (manual pick by stable triple, else default)
  const selectedSource: StreamSource | null = useMemo(
    () => selectStreamSource(sources, manualSelection, failedSourceIds),
    [sources, manualSelection, failedSourceIds],
  );

  // Latest-value refs: the recovery handlers read these instead of closing over
  // state, so their identity stays stable across the frequent re-renders that
  // the danmaku store triggers (VideoPlayer re-binds <video> listeners when
  // these callbacks change).
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const selectedSourceRef = useRef(selectedSource);
  selectedSourceRef.current = selectedSource;
  const streamQueryRef = useRef(streamQuery);
  streamQueryRef.current = streamQuery;

  const applyRecovery = useCallback((next: LiveRecoveryState) => {
    recoveryRef.current = next;
    setRecovery(next);
  }, []);

  const handleRetryAll = () => {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    applyRecovery(createLiveRecoveryState());
    setManualSelection(null);
    setRetryKey((k) => k + 1);
  };

  useEffect(
    () => () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
    },
    [],
  );

  const handleUserPlay = useCallback(() => {
    const query = streamQueryRef.current;
    if (query.isFetching) return;
    // A recovery (nudge watchdog or backoff refetch) owns the ladder — a user
    // play must not race it with a second request.
    if (recoveryTimerRef.current) return;
    if (streamLifecycle.shouldRefresh()) {
      void query.refetch().then((result) => {
        // Fresh URLs: the user asked to play, so retired sources get a retry.
        if (result.isSuccess) applyRecovery(createLiveRecoveryState());
      });
    }
  }, [applyRecovery, streamLifecycle]);

  // Auto-recover on network reconnect: refresh the stream source if it has gone
  // stale while offline, so playback resumes at the live edge. Deliberately
  // driven by the offline→online transition only: `streamQuery` is a new object
  // on every render, and depending on it made unrelated re-renders (the danmaku
  // store pushes the online count continuously) refetch the catalogue every
  // time the 12s staleness threshold had passed — the periodic stutter.
  const online = useOnlineStatus();
  const wasOnlineRef = useRef(online);
  useEffect(() => {
    const wasOnline = wasOnlineRef.current;
    wasOnlineRef.current = online;
    if (!online || wasOnline) return;
    if (streamLifecycle.shouldRefresh() && !streamQueryRef.current.isFetching) {
      void streamQueryRef.current.refetch();
    }
  }, [online, streamLifecycle]);

  const scheduleRecoveryRefetch = useCallback(
    (attempt: number) => {
      if (recoveryTimerRef.current) return;
      recoveryTimerRef.current = setTimeout(() => {
        recoveryTimerRef.current = null;
        void streamQueryRef.current.refetch().then((result) => {
          if (result.isSuccess) applyRecovery(createLiveRecoveryState());
        });
      }, liveRecoveryDelayMs(attempt));
    },
    [applyRecovery],
  );

  // Stable self-reference: the nudge watchdog re-enters the stall path.
  const stallHandlerRef = useRef<(reason: "error" | "waiting-timeout") => void>(() => undefined);

  const handlePlaybackStall = useCallback(
    (reason: "error" | "waiting-timeout") => {
      if (streamQueryRef.current.isFetching) return;
      if (reason === "waiting-timeout") {
        // A nudge or refetch is already in flight for this incident.
        if (recoveryTimerRef.current) return;
      } else if (recoveryTimerRef.current) {
        // Hard error: the source is gone, no point waiting for the watchdog.
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }

      const source = selectedSourceRef.current;
      const available = sourcesRef.current.reduce(
        (count, candidate) => (recoveryRef.current.failed.has(candidate.id) ? count : count + 1),
        0,
      );
      const { action, next } = planLiveRecovery(
        { kind: reason === "error" ? "hard-error" : "stall" },
        recoveryRef.current,
        { sourceId: source?.id ?? null, availableCount: available },
        Date.now(),
      );
      applyRecovery(next);

      switch (action.kind) {
        case "nudge":
          // Same source, no reload: jump back to the live edge, then give it
          // one stall window to resume before the next stall retires it.
          controllerRef.current?.seekToLiveEdge();
          recoveryTimerRef.current = setTimeout(() => {
            recoveryTimerRef.current = null;
            stallHandlerRef.current("waiting-timeout");
          }, STALL_WATCHDOG_MS);
          break;
        case "refetch":
          scheduleRecoveryRefetch(next.attempts);
          break;
        case "retire":
        case "none":
          break;
      }

      // biome-ignore lint/suspicious/noConsole: debug
      console.log("[PlayerPage] live recovery", {
        reason,
        action: action.kind,
        attempt: next.attempts,
        source: source?.id ?? null,
        available,
      });
    },
    [applyRecovery, scheduleRecoveryRefetch],
  );
  stallHandlerRef.current = handlePlaybackStall;

  const handlePlaybackRecovered = useCallback(() => {
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    // Playback resumed, so the last stall was transient. Retired sources stay
    // retired — clearing them here is what sent selection back to the source
    // that had just failed, and produced the switch/fail/switch loop.
    applyRecovery(resetStallBudget(recoveryRef.current));
  }, [applyRecovery]);

  // ── Early return after all hooks ──────────────────────────────────────────
  if (!validRoute) {
    return <StatusView title="无效的播放链接" tone="error" />;
  }

  const isLoading = detailQuery.isLoading || streamQuery.isLoading;
  const allQueriesDone =
    (detailQuery.isSuccess || detailQuery.isError) &&
    (streamQuery.isSuccess || streamQuery.isError);
  const isError = allQueriesDone && (detailQuery.isError || streamQuery.isError);

  const openExternal = () => void openUrl(buildRoomWebUrl(platform, roomId));

  const supportsReplay = canReplay(platform);
  const isRoomOffline =
    !isLoading &&
    (streamQuery.isError ||
      (streamQuery.isSuccess && sources.length === 0) ||
      (room && !room.isLive));
  const playbackStatus = getPlaybackStatus({
    room,
    sources,
    detailQuery,
    streamQuery,
    allFailed,
  });

  // Map StreamSource[] → PlayerQualityItem[] for VideoPlayer
  // Quality is a user choice; CDN/format is an automatic recovery route.
  // Grouping prevents duplicate, reordering options as probe completion order
  // changes during initial load or a background refresh.
  const qualityItems: PlayerQualityItem[] = Array.from(
    sources.reduce((groups, source) => {
      const current = groups.get(source.qualityKey);
      if (!current) {
        groups.set(source.qualityKey, {
          id: source.qualityKey,
          label: source.qualityLabel,
          failed: failedSourceIds.has(source.id),
        });
      } else if (!failedSourceIds.has(source.id)) {
        current.failed = false;
      }
      return groups;
    }, new Map<string, PlayerQualityItem>()),
  ).map(([, item]) => item);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* ── Room info bar ── */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(-1)}
            className="shrink-0 -ml-1"
            aria-label="返回"
            title="返回"
          >
            <ArrowLeft size={16} />
          </Button>

          {isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-4 w-44 animate-pulse rounded-xs bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded-xs bg-muted" />
            </div>
          ) : room ? (
            <div className="min-w-0">
              <h1 className="clamp-1 text-sm font-semibold leading-snug">{room.title}</h1>
              <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <span className="clamp-1 max-w-32">{room.streamerName}</span>
                <span className="text-disabled-foreground shrink-0">·</span>
                <Badge
                  variant="outline"
                  className="text-xs px-2 py-0 h-4 rounded-xs shrink-0 font-normal"
                >
                  {PLATFORM_LABEL[room.platform] ?? room.platform}
                </Badge>
                {room.areaName && (
                  <>
                    <span className="text-disabled-foreground shrink-0">·</span>
                    <span className="clamp-1 max-w-24 shrink-0">{room.areaName}</span>
                  </>
                )}
                {room.isLoop ? (
                  <>
                    <span className="text-disabled-foreground shrink-0">·</span>
                    <span className="shrink-0 text-warning">轮播回放</span>
                  </>
                ) : room.isLive ? (
                  <>
                    <span className="text-disabled-foreground shrink-0">·</span>
                    <span className="shrink-0 inline-flex items-center gap-1 text-live">
                      <span className="h-2 w-2 rounded-full bg-live animate-pulse" />
                      直播中
                    </span>
                  </>
                ) : null}
                {room.isLive && onlineCount != null && (
                  <>
                    <span className="text-disabled-foreground shrink-0">·</span>
                    <span className="shrink-0">{formatOnline(onlineCount)} 人在看</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {room && (
          <div className="shrink-0 flex items-center gap-2">
            {platform === "bilibili" && (
              <button
                type="button"
                disabled={bilibiliLoginState === "logging-in"}
                onClick={() => void handleBilibiliLogin()}
                className={cn(
                  "flex items-center gap-1 rounded-xs px-2 py-1 text-xs font-medium transition-colors",
                  bilibiliLoginState === "logged-in"
                    ? "border border-success bg-success-tint text-success hover:bg-success-hover"
                    : "border border-border bg-muted text-muted-foreground hover:bg-muted-hover hover:text-foreground",
                  bilibiliLoginState === "logging-in" && "opacity-60 cursor-not-allowed",
                )}
              >
                {bilibiliLoginState === "logging-in" ? (
                  <>
                    <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    登录中…
                  </>
                ) : bilibiliLoginState === "logged-in" ? (
                  <>
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 10 10"
                      fill="none"
                      role="img"
                      aria-hidden="true"
                    >
                      <path
                        d="M2 5l2.5 2.5L8 3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    已登录
                  </>
                ) : (
                  "登录Bilibili"
                )}
              </button>
            )}
            {supportsReplay && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="查看录播"
                onClick={() => navigate(`/replay/${platform}/${roomId}`)}
              >
                <Film size={14} strokeWidth={1.8} />
              </Button>
            )}
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
      <div className="flex-1 min-h-0 flex flex-col gap-3">
        {isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 border border-border bg-muted p-4">
            <StatusView
              title={playbackStatus.title}
              tone={playbackStatus.tone}
              hint={playbackStatus.hint}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleRetryAll}
                className="gap-2 text-xs"
              >
                <RefreshCw size={12} />
                重试
              </Button>
              <Button variant="ghost" size="sm" onClick={openExternal} className="gap-2 text-xs">
                <ExternalLink size={12} />
                外部打开
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 relative">
            {selectedSource ? (
              /* ── Live player via shared VideoPlayer ── */
              <VideoPlayer
                streamUrl={selectedSource.streamUrl}
                format={selectedSource.format}
                poster={room?.coverUrl}
                isLive
                qualities={qualityItems}
                selectedQualityId={selectedSource.qualityKey}
                onQualityChange={(qualityKey) => {
                  const picked = sources.find(
                    (s) => s.qualityKey === qualityKey && !failedSourceIds.has(s.id),
                  );
                  if (picked) setManualSelection(selectionOf(picked));
                  // Explicit user choice: revive that quality's routes and
                  // restart the recovery budget for them.
                  applyRecovery(
                    resetStallBudget(
                      reviveSources(
                        recoveryRef.current,
                        sources.filter((s) => s.qualityKey === qualityKey).map((s) => s.id),
                      ),
                    ),
                  );
                }}
                onPlaybackStall={handlePlaybackStall}
                onPlaybackRecovered={handlePlaybackRecovered}
                onUserPlay={handleUserPlay}
                instanceRef={controllerRef}
                nowPlaying={room ? { title: room.title, streamer: room.streamerName } : null}
                recoveryHint={
                  recovery.attempts > 0
                    ? `播放失败 · 正在重新拉流（第 ${recovery.attempts} 次）`
                    : undefined
                }
                overlaySlot={
                  room?.isLive && isPlatform(platform) ? (
                    // room.roomId is the normalized (real) id — the danmaku
                    // backend emits events with the resolved real id, so
                    // filtering must use it, not the raw URL param (which can
                    // be a Bilibili short id like /player/bilibili/6).
                    <DanmakuOverlay platform={platform} roomId={room.roomId} />
                  ) : null
                }
                controlsEndSlot={room?.isLive ? <DanmakuControls /> : null}
              />
            ) : (
              /* ── No-source overlay ── */
              <div
                className="player-stage flex flex-col items-center justify-center gap-4"
                style={{ background: "var(--stage-scrim)" }}
              >
                <p
                  className={cn(
                    "text-sm font-medium",
                    allFailed ? "text-stage-danger" : "text-stage-fg-3",
                  )}
                >
                  {allFailed
                    ? playbackStatus.title
                    : streamQuery.isLoading
                      ? "获取播放源…"
                      : playbackStatus.title}
                </p>
                {!streamQuery.isLoading && (
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRetryAll}
                      className="gap-2 text-xs text-stage-fg-2 hover:text-stage-fg-1 hover:bg-stage-surface border-stage-border border"
                    >
                      <RefreshCw size={12} />
                      重试
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={openExternal}
                      className="gap-2 text-xs text-stage-fg-3 hover:text-stage-fg-2 hover:bg-stage-surface"
                    >
                      <ExternalLink size={12} />
                      外部打开
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Offline nudge: suggest replay ── */}
        {isRoomOffline && supportsReplay && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-4 py-3">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Film size={16} strokeWidth={1.6} className="shrink-0" />
              <span className="text-xs">主播当前未开播，可查看历史录播</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-2 text-xs"
              onClick={() => navigate(`/replay/${platform}/${roomId}`)}
            >
              <Film size={12} />
              查看录播
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
