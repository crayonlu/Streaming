/**
 * ReplayPage  —  /replay/:platform/:roomId
 *
 * Full-screen replay viewer:
 *   Left  (flex-1): xgplayer VOD player
 *   Right (w-72):   scrollable session / part list
 */

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Film, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { PlayerQualityItem } from "@/features/player/ui/VideoPlayer";
import { VideoPlayer } from "@/features/player/ui/VideoPlayer";
import { getReplayQualities, getRoomDetail, loadPreferences } from "@/shared/api/commands";
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
  // Cache of prefetched qualities keyed by part id, to skip the fetch on switch.
  const prefetchRef = useRef<Map<string, ReplayQuality[]>>(new Map());

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
    if (autoPlayNext && nextPart) {
      void handlePlay(nextPart);
    } else {
      setEnded(true);
    }
  }, [autoPlayNext, nextPart, handlePlay]);

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
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 bg-card px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          className="-ml-1 shrink-0"
        >
          <ArrowLeft size={15} />
        </Button>

        <Film size={13} className="text-muted-foreground shrink-0" />

        <div className="min-w-0 flex-1">
          {roomQuery.isLoading ? (
            <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
          ) : (
            <span className="truncate text-sm font-medium">
              {room?.streamerName ?? roomId}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">的直播录像</span>
            </span>
          )}
        </div>

        {/* Currently playing */}
        {activeItem && (
          <span className="hidden sm:block truncate max-w-55 text-[11px] text-muted-foreground">
            {activeItem.showRemark || activeItem.title}
          </span>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex min-h-0 flex-1">
        {/* ── Video player (left / center) ── */}
        <div className="flex flex-1 min-w-0 flex-col bg-black">
          {/*
           * Player area: always rendered as a "player-stage" block so the
           * height is consistent whether a stream is playing or not.
           * The placeholder states use the same min-height via the CSS class.
           */}
          <div className="relative flex-1 min-h-0 player-stage rounded-none">
            {streamUrl ? (
              <VideoPlayer
                streamUrl={streamUrl}
                isLive={false}
                format={streamFormat}
                qualities={qualityItems}
                selectedQualityId={selectedQualityId}
                onQualityChange={setSelectedQualityId}
                onEnded={handleEnded}
                onNearEnd={handleNearEnd}
              />
            ) : (
              /* Empty / loading / error — same container, no height jump */
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 transition-opacity duration-200">
                {urlLoading ? (
                  <>
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                    <span className="text-xs text-white/50">加载回放地址…</span>
                  </>
                ) : urlError ? (
                  <>
                    <span className="text-sm text-red-400">{urlError}</span>
                    {activeItem && (
                      <button
                        type="button"
                        onClick={() => handlePlay(activeItem)}
                        className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/60 hover:text-white transition-colors"
                      >
                        重试
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Film size={48} strokeWidth={1.2} className="text-white/20" />
                    <p className="text-sm text-white/35">从右侧选择一段录播开始播放</p>
                  </>
                )}
              </div>
            )}
            {ended && streamUrl && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/70 backdrop-blur-sm">
                <span className="text-[11px] uppercase tracking-widest text-white/45">已播完</span>
                <span className="text-base font-medium text-white/85">
                  {nextPart ? "已暂停自动连播" : "最后一段"}
                </span>
                {activeItem && (
                  <button
                    type="button"
                    onClick={() => handlePlay(activeItem)}
                    className="flex items-center gap-1.5 rounded-full border border-white/16 bg-white/10 px-4 py-1.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/20"
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
              className="shrink-0 border-t border-white/8 px-4 py-2 flex items-center gap-3"
              style={{ background: "var(--player-stage-bg)" }}
            >
              <span className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-semibold text-white/55 tabular-nums">
                P{activeItem.partNum}
                {activeItem.totalParts > 1 && `/${activeItem.totalParts}`}
              </span>
              <span className="flex-1 truncate text-xs text-white/70">{activeItem.title}</span>
              {activeItem.durationStr && (
                <span className="shrink-0 text-[11px] tabular-nums text-white/40">
                  {fmtDuration(activeItem.durationStr)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Replay list (right sidebar) ── */}
        <aside className="flex w-72 shrink-0 flex-col border-l border-border/60 bg-card">
          {/* Sidebar header */}
          <div className="shrink-0 border-b border-border/50 px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold">直播录像</span>
            {roomQuery.data && (
              <span className="text-[10px] text-muted-foreground">
                {roomQuery.data.streamerName}
              </span>
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
      </div>
    </div>
  );
}
