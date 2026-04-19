/**
 * ReplayList
 *
 * Infinite-scrolling sidebar list of replay sessions and their parts.
 * Extracted from ReplayPage.tsx to reduce file size.
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Eye, Film, PlayCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  return (
    <button
      type="button"
      onClick={() => onPlay(part)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors",
        active
          ? "bg-primary/12 text-primary"
          : "hover:bg-accent/70 text-foreground/75 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "shrink-0 w-5 text-center text-[10px] font-semibold",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        P{part.partNum}
      </span>
      <span className="flex-1 truncate text-xs">{part.showRemark || part.title}</span>
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
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

  return (
    <div>
      <button
        type="button"
        onClick={hasParts ? onToggle : () => onPlay(session)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors group",
          !hasParts && activeId === session.id ? "bg-primary/12" : "hover:bg-accent/60",
        )}
      >
        {/* Cover */}
        {session.coverUrl ? (
          <img
            src={session.coverUrl}
            alt=""
            className="h-10 w-18 shrink-0 rounded object-cover bg-muted"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-18 shrink-0 rounded bg-muted flex items-center justify-center">
            <Film size={14} className="text-muted-foreground/30" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12px] font-medium leading-tight">{session.title}</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {session.recordedAt > 0 && <span>{fmtDate(session.recordedAt)}</span>}
            {session.durationStr && (
              <span className="flex items-center gap-0.5">
                <Clock size={9} />
                {fmtDuration(session.durationStr)}
              </span>
            )}
            {session.viewCountText && (
              <span className="flex items-center gap-0.5">
                <Eye size={9} />
                {session.viewCountText}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          {hasParts && (
            <span className="text-[9px] tabular-nums text-muted-foreground bg-muted rounded px-1 py-0.5">
              {session.totalParts}P
            </span>
          )}
          <ChevronRight
            size={12}
            className={cn(
              "text-muted-foreground/40 transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </div>
      </button>

      {/* Expanded parts */}
      {hasParts && expanded && (
        <div className="ml-2 mt-0.5 mb-1 border-l border-border/40 pl-2">
          {partsLoading ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground animate-pulse">
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
}: {
  platform: PlatformId;
  roomId: string;
  activeId: string | null;
  onPlay: (item: ReplayItem) => void;
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

  // Initial loading skeleton
  if (infinite.isLoading) {
    return (
      <div className="flex flex-col gap-1.5 p-2">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="flex gap-2.5 rounded-lg px-2.5 py-2">
            <div className="h-10 w-18  rounded bg-muted animate-pulse shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1 pt-0.5">
              <div className="h-3 w-4/5 rounded bg-muted animate-pulse" />
              <div className="h-2 w-2/5 rounded bg-muted animate-pulse" />
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
        <PlayCircle size={32} strokeWidth={1.2} className="opacity-25" />
        <span className="text-xs text-foreground/80">无法加载回放</span>
        <span className="text-[11px] leading-relaxed">{msg}</span>
        <button
          type="button"
          onClick={() => void infinite.refetch()}
          className="mt-1 text-[11px] text-primary hover:underline"
        >
          重试
        </button>
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <PlayCircle size={32} strokeWidth={1.2} className="opacity-25" />
        <span className="text-xs">暂无回放录像</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-2">
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
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground animate-pulse">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground/70" />
            加载更多…
          </div>
        ) : infinite.hasNextPage ? (
          <button
            type="button"
            onClick={() => void infinite.fetchNextPage()}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            加载更多
          </button>
        ) : sessions.length > PAGE_SIZE ? (
          <span className="text-[10px] text-muted-foreground/50">
            已加载全部 {sessions.length} 场录播
          </span>
        ) : null}
      </div>
    </div>
  );
}
