import { useQuery } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ExternalLink, Film, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FollowButton } from "@/features/follow-button/ui/FollowButton";
import type { PlayerQualityItem } from "@/features/player/ui/VideoPlayer";
import { VideoPlayer } from "@/features/player/ui/VideoPlayer";
import { cn } from "@/lib/utils";
import {
  buildRoomWebUrl,
  closeBilibiliLoginWindow,
  getBilibiliCookie,
  getRoomDetail,
  getStreamSources,
  openBilibiliLoginWindow,
  recordLastVisited,
  setBilibiliSessdata,
} from "@/shared/api/commands";
import { isPlatform, PLATFORM_LABEL } from "@/shared/lib/platform";
import { supportsReplay as canReplay } from "@/shared/lib/replay";
import type { PlatformId, StreamSource } from "@/shared/types/domain";
import { StatusView } from "@/shared/ui/StatusView";
import { getPlaybackStatus } from "./playbackStatus";

// ── PlayerPage ────────────────────────────────────────────────────────────────

export function PlayerPage() {
  const params = useParams();
  const navigate = useNavigate();
  const platform = params.platform;
  const roomId = params.roomId;

  const [manualSourceId, setManualSourceId] = useState<string | null>(null);
  const [failedSourceIds, setFailedSourceIds] = useState<Set<string>>(new Set());
  const [retryKey, setRetryKey] = useState(0);
  const [bilibiliLoginState, setBilibiliLoginState] = useState<"idle" | "logging-in" | "logged-in">(
    "idle",
  );

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

  // Record visit
  useEffect(() => {
    if (room && isPlatform(platform) && roomId) {
      void recordLastVisited({ type: "room", platform, roomId });
    }
  }, [room, platform, roomId]);

  // Resolve the active source (highest-priority non-failed)
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
    setRetryKey((k) => k + 1);
  };

  // Check login state on mount and whenever room changes (for B站).
  useEffect(() => {
    if (platform !== "bilibili") return;
    void getBilibiliCookie()
      .then((r) => setBilibiliLoginState(r.hasSessdata ? "logged-in" : "idle"))
      .catch(() => setBilibiliLoginState("idle"));
  }, [platform]);

  // Opens the visible login window and polls until SESSDATA arrives.
  const handleBilibiliLogin = useCallback(async () => {
    if (bilibiliLoginState === "logging-in") return;
    setBilibiliLoginState("logging-in");
    try {
      await openBilibiliLoginWindow();
      // Poll every 1.5s for up to 120s.
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const result = await getBilibiliCookie();
        if (result.hasSessdata) {
          if (result.cookie) await setBilibiliSessdata(result.cookie);
          await closeBilibiliLoginWindow();
          setBilibiliLoginState("logged-in");
          return;
        }
      }
      // Timeout — user may have closed the window without logging in.
      setBilibiliLoginState("idle");
    } catch {
      setBilibiliLoginState("idle");
    }
  }, [bilibiliLoginState]);

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
  const qualityItems: PlayerQualityItem[] = sources.map((s) => ({
    id: s.id,
    label: s.qualityLabel,
    cdn: s.cdn,
    failed: failedSourceIds.has(s.id),
  }));

  // ── Render ────────────────────────────────────────────────────────────────
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
                <span className="clamp-1 max-w-30">{room.streamerName}</span>
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
                    <span className="clamp-1 max-w-25 shrink-0">{room.areaName}</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {room && (
          <div className="shrink-0 flex items-center gap-1.5">
            {platform === "bilibili" && (
              <button
                type="button"
                disabled={bilibiliLoginState === "logging-in"}
                onClick={() => void handleBilibiliLogin()}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors",
                  bilibiliLoginState === "logged-in"
                    ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-500/80 hover:bg-emerald-500/15"
                    : "border border-border bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
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
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-border/60 bg-muted/30 p-4">
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
          <div className="flex-1 min-h-0 relative">
            {selectedSource ? (
              /* ── Live player via shared VideoPlayer ── */
              <VideoPlayer
                streamUrl={selectedSource.streamUrl}
                format={selectedSource.format}
                poster={room?.coverUrl}
                isLive
                qualities={qualityItems}
                selectedQualityId={selectedSource.id}
                onQualityChange={(id) => {
                  setManualSourceId(id);
                  setFailedSourceIds((prev) => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                  });
                }}
                onError={() => handleSourceError(selectedSource)}
              />
            ) : (
              /* ── No-source overlay ── */
              <div
                className="player-stage flex flex-col items-center justify-center gap-3.5"
                style={{ background: "rgba(5,6,8,0.78)" }}
              >
                <p
                  className={cn(
                    "text-sm font-medium",
                    allFailed ? "text-red-400" : "text-white/55",
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
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Offline nudge: suggest replay ── */}
        {isRoomOffline && supportsReplay && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-4 py-3">
            <div className="flex items-center gap-2.5 text-muted-foreground">
              <Film size={15} strokeWidth={1.6} className="shrink-0" />
              <span className="text-xs">主播当前未开播，可查看历史录播</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              onClick={() => navigate(`/replay/${platform}/${roomId}`)}
            >
              <Film size={11} />
              查看录播
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
