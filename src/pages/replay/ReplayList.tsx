/**
 * ReplayList
 *
 * Infinite-scrolling sidebar list of replay sessions and their parts.
 * Extracted from ReplayPage.tsx to reduce file size.
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Eye, Film, PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getReplayProgress, replayProgressKey } from "@/features/replay/model/progress";
import { cn } from "@/lib/utils";
import { getReplayList, getReplayParts } from "@/shared/api/commands";
import { fmtDate, fmtDuration } from "@/shared/lib/dom";
import type { PlatformId, ReplayItem } from "@/shared/types/domain";

// ── PartRow ───────────────────────────────────────────────────────────────────

function PartRow({
  part,
  active,
  onPlay,
}: {
  part: ReplayItem;
  active: boolean;
  onPlay: (item: ReplayItem) => void;
}) {
  const progress = getReplayProgress(replayProgressKey(part.platform, part.roomId, part.id));
  const percent = progress?.completed
    ? 100
    : progress && progress.duration > 0
      ? Math.round((progress.position / progress.duration) * 100)
      : 0;
  return (
    <button
      type="button"
      onClick={() => onPlay(part)}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent-hover text-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "shrink-0 w-5 text-center text-xs font-semibold",
          active ? "text-accent-foreground" : "text-muted-foreground",
        )}
      >
        P{part.partNum}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{part.showRemark || part.title}</span>
        {percent > 0 && (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-primary" style={{ width: `${percent}%` }} />
          </span>
        )}
      </span>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {fmtDuration(part.durationStr)}
      </span>
    </button>
  );
}

// ── SessionRow ────────────────────────────────────────────────────────────────

function SessionRow({
  session,
  expanded,
  parts,
  partsLoading,
  activeId,
  onToggle,
  onPlay,
}: {
  session: ReplayItem;
  expanded: boolean;
  parts?: ReplayItem[];
  partsLoading: boolean;
  activeId: string | null;
  onToggle: () => void;
  onPlay: (item: ReplayItem) => void;
}) {
  const hasParts = session.totalParts > 1;
  const progress = !hasParts
    ? getReplayProgress(replayProgressKey(session.platform, session.roomId, session.id))
    : null;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          if (hasParts) onToggle();
          onPlay(session);
        }}
        aria-expanded={hasParts ? expanded : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left transition-colors group",
          !hasParts && activeId === session.id ? "bg-accent" : "hover:bg-accent-hover",
        )}
      >
        {/* Cover */}
        {session.coverUrl ? (
          <img
            src={session.coverUrl}
            alt=""
            className="h-10 w-18 shrink-0 rounded-xs object-cover bg-muted"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-18 shrink-0 rounded-xs bg-muted flex items-center justify-center">
            <Film size={14} className="text-disabled-foreground" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-xs font-medium leading-tight">{session.title}</span>
          {/* Metadata ordered by importance: date > duration > view count.
              The first three never shrink, so the view count is the only
              compressible item — it truncates first when space runs out,
              instead of squeezing the date onto two lines and sliding under
              the badge on the right as it used to. */}
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {session.recordedAt > 0 && (
              <span className="shrink-0">{fmtDate(session.recordedAt)}</span>
            )}
            {session.durationStr && (
              <span className="flex shrink-0 items-center gap-1">
                <Clock size={12} className="shrink-0" />
                {fmtDuration(session.durationStr)}
              </span>
            )}
            {session.viewCountText && (
              <span className="flex min-w-0 items-center gap-1">
                <Eye size={12} className="shrink-0" />
                <span className="truncate">{session.viewCountText}</span>
              </span>
            )}
            {progress?.completed ? (
              <span className="shrink-0 text-accent-foreground">已看完</span>
            ) : progress && progress.duration > 0 ? (
              <span className="shrink-0 text-accent-foreground">
                继续观看 {Math.round((progress.position / progress.duration) * 100)}%
              </span>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2">
          {hasParts && (
            <span className="inline-flex h-5 shrink-0 items-center rounded-xs bg-muted px-2 text-xs tabular-nums text-muted-foreground">
              {session.totalParts}P
            </span>
          )}
          <ChevronRight
            size={12}
            className={cn(
              "text-disabled-foreground transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </div>
      </button>

      {/* Expanded parts */}
      {hasParts && expanded && (
        <div className="ml-2 mt-1 mb-1 border-l border-border-faint pl-2">
          {partsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground animate-pulse">
              加载中…
            </div>
          ) : (
            parts?.map((part) => (
              <PartRow key={part.id} part={part} active={activeId === part.id} onPlay={onPlay} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── ReplayList sidebar ────────────────────────────────────────────────────────

const PAGE_SIZE = 12;

export function ReplayList({
  platform,
  roomId,
  activeId,
  onPlay,
  onPartsChange,
}: {
  platform: PlatformId;
  roomId: string;
  activeId: string | null;
  onPlay: (item: ReplayItem) => void;
  onPartsChange?: (parts: ReplayItem[]) => void;
}) {
  const [expandedShowId, setExpandedShowId] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Infinite query — each page returns up to PAGE_SIZE sessions
  const infinite = useInfiniteQuery({
    queryKey: ["replay-list-inf", platform, roomId],
    queryFn: ({ pageParam }) => getReplayList(platform, roomId, pageParam as number),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
    staleTime: 60_000,
  });

  // Flatten all pages into a single session array
  const sessions = infinite.data?.pages.flat() ?? [];

  // IntersectionObserver: auto-fetch next page when sentinel enters viewport
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && infinite.hasNextPage && !infinite.isFetchingNextPage) {
          void infinite.fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [infinite]);

  // Parts for the currently expanded session
  const expandedSession = sessions.find((s) => s.showId === expandedShowId);
  const partsQuery = useQuery({
    queryKey: ["replay-parts", platform, roomId, expandedShowId],
    queryFn: () =>
      expandedSession
        ? getReplayParts(platform, roomId, expandedSession.id, expandedSession.upId)
        : Promise.resolve([]),
    enabled: expandedShowId !== null && !!expandedSession,
    staleTime: 120_000,
  });

  // Report the expanded session's parts (or the single session itself when no
  // parts) back to the parent so it can compute the next part for auto-play.
  useEffect(() => {
    if (!expandedShowId) return;
    onPartsChange?.(partsQuery.data ?? []);
  }, [expandedShowId, partsQuery.data, onPartsChange]);

  // Initial loading skeleton
  if (infinite.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="flex gap-3 rounded-md px-3 py-2">
            <div className="h-10 w-18  rounded-xs bg-muted animate-pulse shrink-0" />
            <div className="flex flex-col gap-2 flex-1 pt-1">
              <div className="h-3 w-48 rounded-xs bg-muted animate-pulse" />
              <div className="h-2 w-24 rounded-xs bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (infinite.isError) {
    const msg = infinite.error instanceof Error ? infinite.error.message : String(infinite.error);
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center text-muted-foreground">
        <PlayCircle size={32} strokeWidth={1.2} className="opacity-30" />
        <span className="text-xs text-foreground">无法加载回放</span>
        <span className="text-xs leading-relaxed">{msg}</span>
        <button
          type="button"
          onClick={() => void infinite.refetch()}
          className="mt-1 text-xs text-primary hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <PlayCircle size={32} strokeWidth={1.2} className="opacity-30" />
        <span className="text-xs">暂无回放录像</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {sessions.map((session) => {
        const isExpanded = expandedShowId === session.showId;
        return (
          <SessionRow
            key={session.id}
            session={session}
            expanded={isExpanded}
            parts={isExpanded ? partsQuery.data : undefined}
            partsLoading={isExpanded && partsQuery.isLoading}
            activeId={activeId}
            onToggle={() =>
              setExpandedShowId((prev) => (prev === session.showId ? null : session.showId))
            }
            onPlay={onPlay}
          />
        );
      })}

      {/* Sentinel + load-more indicator */}
      <div ref={loadMoreRef} className="py-2 flex justify-center">
        {infinite.isFetchingNextPage ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground animate-pulse">
            <div className="h-4 w-4 animate-spin rounded-full border border-disabled-foreground border-t-muted-foreground" />
            加载更多…
          </div>
        ) : infinite.hasNextPage ? (
          <button
            type="button"
            onClick={() => void infinite.fetchNextPage()}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            加载更多
          </button>
        ) : sessions.length > PAGE_SIZE ? (
          <span className="text-xs text-subtle-foreground">
            已加载全部 {sessions.length} 场录播
          </span>
        ) : null}
      </div>
    </div>
  );
}
