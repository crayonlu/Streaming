/**
 * ReplayPage  —  /replay/:platform/:roomId
 *
 * Full-screen replay viewer:
 *   Left  (flex-1): xgplayer VOD player
 *   Right (w-72):   scrollable session / part list
 */

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Film, ListVideo, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { PlayerController } from "@/features/player/model/usePlayerEngine";
import type { PlayerQualityItem } from "@/features/player/ui/VideoPlayer";
import { VideoPlayer } from "@/features/player/ui/VideoPlayer";
import {
  loadReplayProgress,
  replayProgressKey,
  saveReplayProgress,
} from "@/features/replay/model/progress";
import {
  getReplayParts,
  getReplayQualities,
  getRoomDetail,
  loadPreferences,
} from "@/shared/api/commands";
import { fmtDuration } from "@/shared/lib/dom";
import { isPlatform } from "@/shared/lib/platform";
import type { PlatformId, ReplayItem, ReplayQuality } from "@/shared/types/domain";
import { ReplayList } from "./ReplayList";

// ── ReplayPage ────────────────────────────────────────────────────────────────

export function ReplayPage() {
  const params = useParams();
  const navigate = useNavigate();
  const platform = params.platform;
  const roomId = params.roomId;

  const [activeItem, setActiveItem] = useState<ReplayItem | null>(null);
  const [qualities, setQualities] = useState<ReplayQuality[]>([]);
  const [selectedQualityId, setSelectedQualityId] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [currentParts, setCurrentParts] = useState<ReplayItem[]>([]);
  const [ended, setEnded] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [listOpen, setListOpen] = useState(true);
  // Cache of prefetched qualities keyed by part id, to skip the fetch on switch.
  const prefetchRef = useRef<Map<string, ReplayQuality[]>>(new Map());
  const partsRef = useRef<Map<number, ReplayItem[]>>(new Map());
  const playerRef = useRef<PlayerController | null>(null);
  const restoredItemRef = useRef<string | null>(null);

  useEffect(() => {
    void loadPreferences()
      .then((p) => setAutoPlayNext(p.autoPlayNextReplay ?? true))
      .catch(() => undefined);
  }, []);

  const roomQuery = useQuery({
    queryKey: ["room-detail", platform, roomId],
    queryFn: () => getRoomDetail(platform as PlatformId, roomId as string),
    enabled: isPlatform(platform) && !!roomId,
  });

  const room = roomQuery.data;

  // Fetch all quality options when user selects a segment.
  // Uses prefetched qualities when available to avoid a network round-trip.
  const handlePlay = useCallback(async (item: ReplayItem) => {
    setActiveItem(item);
    setEnded(false);
    setQualities([]);
    setSelectedQualityId(null);
    setUrlError(null);
    if (item.totalParts > 1) {
      const cachedParts = partsRef.current.get(item.showId);
      if (cachedParts) {
        setCurrentParts(cachedParts);
      } else {
        void getReplayParts(item.platform, item.roomId, item.id, item.upId)
          .then((parts) => {
            partsRef.current.set(item.showId, parts);
            setCurrentParts(parts);
          })
          .catch(() => undefined);
      }
    } else {
      setCurrentParts([item]);
    }
    const cached = prefetchRef.current.get(item.id);
    if (cached) {
      setQualities(cached);
      if (cached.length > 0) setSelectedQualityId(cached[0].name);
      return;
    }
    setUrlLoading(true);
    try {
      const qs = await getReplayQualities(item.platform, item.id);
      setQualities(qs);
      if (qs.length > 0) setSelectedQualityId(qs[0].name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUrlError(msg);
    } finally {
      setUrlLoading(false);
    }
  }, []);

  // Next part within the currently expanded session's part list.
  const currentIndex = activeItem ? currentParts.findIndex((p) => p.id === activeItem.id) : -1;
  const nextPart =
    currentIndex >= 0 && currentIndex < currentParts.length - 1
      ? currentParts[currentIndex + 1]
      : null;

  // Prefetch the next part's qualities 8s before the current one ends.
  const handleNearEnd = useCallback(() => {
    if (!nextPart) return;
    if (prefetchRef.current.has(nextPart.id)) return;
    void getReplayQualities(nextPart.platform, nextPart.id)
      .then((qs) => prefetchRef.current.set(nextPart.id, qs))
      .catch(() => undefined);
  }, [nextPart]);

  // On ended: auto-play next, or surface the finished state.
  const handleEnded = useCallback(() => {
    if (activeItem && isPlatform(platform) && roomId && playerRef.current) {
      saveReplayProgress(
        replayProgressKey(platform, roomId, activeItem.id),
        playerRef.current.duration,
        playerRef.current.duration,
      );
    }
    if (autoPlayNext && nextPart) {
      void handlePlay(nextPart);
    } else {
      setEnded(true);
    }
  }, [activeItem, autoPlayNext, nextPart, handlePlay, platform, roomId]);

  // Map ReplayQuality[] → PlayerQualityItem[] for VideoPlayer
  const qualityItems: PlayerQualityItem[] = qualities.map((q) => ({
    id: q.name,
    label: q.name,
  }));
  const streamUrl = qualities.find((q) => q.name === selectedQualityId)?.url ?? null;
  const streamFormat = streamUrl?.includes(".m3u8")
    ? "hls"
    : streamUrl?.includes(".flv")
      ? "flv"
      : "mp4";

  // Restore once per replay item and persist at a low frequency plus lifecycle
  // boundaries. Quality changes keep the same item and therefore the same key.
  useEffect(() => {
    if (!activeItem || !streamUrl || !isPlatform(platform) || !roomId) return;
    const controller = playerRef.current;
    if (!controller) return;
    const key = replayProgressKey(platform, roomId, activeItem.id);
    const save = () => saveReplayProgress(key, controller.currentTime, controller.duration);
    const restore = () => {
      if (restoredItemRef.current === activeItem.id) return;
      const progress = loadReplayProgress(key);
      if (progress && progress.position < controller.duration) controller.seek(progress.position);
      restoredItemRef.current = activeItem.id;
    };
    controller.on("loadedmetadata", restore);
    controller.on("pause", save);
    const interval = window.setInterval(save, 5000);
    const onHidden = () => {
      if (document.hidden) save();
    };
    document.addEventListener("visibilitychange", onHidden);
    restore();
    return () => {
      save();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onHidden);
      controller.off("loadedmetadata", restore);
      controller.off("pause", save);
    };
  }, [activeItem, streamUrl, platform, roomId]);

  if (!isPlatform(platform) || !roomId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        无效的回放链接
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-3 py-3">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          className="-ml-1 shrink-0"
          aria-label="返回"
          title="返回"
        >
          <ArrowLeft size={16} />
        </Button>

        <Film size={14} className="text-muted-foreground shrink-0" />

        <div className="min-w-0 flex-1">
          {roomQuery.isLoading ? (
            <div className="h-4 w-40 animate-pulse rounded-xs bg-muted" />
          ) : (
            <span className="truncate text-sm font-medium">
              {room?.streamerName ?? roomId}
              <span className="ml-2 text-xs font-normal text-muted-foreground">的直播录像</span>
            </span>
          )}
        </div>

        {/* Currently playing */}
        {activeItem && (
          <span className="hidden sm:block truncate max-w-56 text-xs text-muted-foreground">
            {activeItem.showRemark || activeItem.title}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={listOpen ? "隐藏回放列表" : "显示回放列表"}
          aria-pressed={listOpen}
          title={listOpen ? "隐藏回放列表" : "显示回放列表"}
          onClick={() => setListOpen((open) => !open)}
        >
          <ListVideo size={14} />
        </Button>
      </div>

      {/* ── Main area ── */}
      <div className="flex min-h-0 flex-1">
        {/* ── Video player (left / center) ── */}
        <div className="flex flex-1 min-w-0 flex-col bg-stage-bg">
          {/*
           * Player area: always rendered as a "player-stage" block so the
           * height is consistent whether a stream is playing or not.
           * The placeholder states use the same min-height via the CSS class.
           */}
          <div className="relative flex-1 min-h-0 player-stage player-stage--flush">
            {streamUrl ? (
              <VideoPlayer
                streamUrl={streamUrl}
                isLive={false}
                format={streamFormat}
                instanceRef={playerRef}
                qualities={qualityItems}
                selectedQualityId={selectedQualityId}
                onQualityChange={setSelectedQualityId}
                onEnded={handleEnded}
                onNearEnd={handleNearEnd}
                nowPlaying={
                  activeItem ? { title: activeItem.title, streamer: room?.streamerName } : null
                }
              />
            ) : (
              /* Empty / loading / error — same container, no height jump */
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 transition-opacity duration-150">
                {urlLoading ? (
                  <>
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-stage-border border-t-stage-fg-2" />
                    <span className="text-xs text-stage-fg-3">加载回放地址…</span>
                  </>
                ) : urlError ? (
                  <>
                    <span className="text-sm text-stage-danger">{urlError}</span>
                    {activeItem && (
                      <button
                        type="button"
                        onClick={() => handlePlay(activeItem)}
                        className="rounded-xs border border-stage-border px-3 py-2 text-xs text-stage-fg-3 hover:text-stage-fg-1 transition-colors"
                      >
                        重试
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Film size={48} strokeWidth={1.2} className="text-stage-fg-4" />
                    <p className="text-sm text-stage-fg-4">从右侧选择一段录播开始播放</p>
                  </>
                )}
              </div>
            )}
            {ended && streamUrl && (
              <div className="absolute inset-0 z-stage-msg flex flex-col items-center justify-center gap-3 bg-stage-scrim backdrop-blur-sm">
                <span className="text-xs uppercase tracking-caps text-stage-fg-3">已播完</span>
                <span className="text-base font-medium text-stage-fg-1">
                  {nextPart ? "已暂停自动连播" : "最后一段"}
                </span>
                {activeItem && (
                  <button
                    type="button"
                    onClick={() => handlePlay(activeItem)}
                    className="flex items-center gap-2 rounded-full border border-stage-border bg-stage-surface px-4 py-2 text-xs font-medium text-stage-fg-1 transition-colors hover:bg-stage-hover"
                  >
                    <RotateCcw size={12} strokeWidth={2} />
                    重播
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Now-playing info bar */}
          {activeItem && (
            <div
              className="shrink-0 border-t border-stage-surface px-4 py-2 flex items-center gap-3"
              style={{ background: "var(--stage-bg)" }}
            >
              <span className="shrink-0 rounded-xs bg-stage-surface px-2 py-1 text-xs font-semibold text-stage-fg-3 tabular-nums">
                P{activeItem.partNum}
                {activeItem.totalParts > 1 && `/${activeItem.totalParts}`}
              </span>
              <span className="flex-1 truncate text-xs text-stage-fg-2">{activeItem.title}</span>
              {activeItem.durationStr && (
                <span className="shrink-0 text-xs tabular-nums text-stage-fg-4">
                  {fmtDuration(activeItem.durationStr)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Replay list (right sidebar) ── */}
        {listOpen && (
          <aside className="flex w-[min(24rem,40vw)] shrink-0 flex-col border-l border-border bg-card">
            {/* Sidebar header */}
            <div className="shrink-0 border-b border-border-faint px-3 py-3 flex items-center justify-between">
              <span className="text-xs font-semibold">直播录像</span>
              {roomQuery.data && (
                <span className="text-xs text-muted-foreground">{roomQuery.data.streamerName}</span>
              )}
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto">
              <ReplayList
                platform={platform}
                roomId={roomId}
                activeId={activeItem?.id ?? null}
                onPlay={handlePlay}
                onPartsChange={setCurrentParts}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
