/**
 * ReplayPanel
 *
 * Shown inside PlayerPage when a room is offline.
 * Displays a list of live-recording sessions; each session can be expanded to
 * reveal individual parts (P1 / P2 / P3 …).
 */

import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Clock, Eye, Film, PlayCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { getReplayList, getReplayParts } from "@/shared/api/commands";
import { fmtDate, fmtDuration } from "@/shared/lib/dom";
import type { PlatformId, ReplayItem } from "@/shared/types/domain";

// ── sub-components ────────────────────────────────────────────────────────────

interface PartRowProps {
  part: ReplayItem;
  active: boolean;
  onPlay: (item: ReplayItem) => void;
}

function PartRow({ part, active, onPlay }: PartRowProps) {
  return (
    <button
      type="button"
      onClick={() => onPlay(part)}
      className={cn(
        "flex w-full items-center gap-3 rounded-sm px-3 py-2 text-left",
        "transition-colors duration-100",
        active
          ? "bg-accent text-accent-foreground"
          : "hover:bg-accent-hover text-foreground hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "shrink-0 text-xs font-semibold min-w-6 text-center",
          active ? "text-accent-foreground" : "text-muted-foreground",
        )}
      >
        P{part.partNum}
      </span>
      <span className="flex-1 truncate text-xs">{part.showRemark || part.title}</span>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {fmtDuration(part.durationStr)}
      </span>
    </button>
  );
}

interface SessionRowProps {
  session: ReplayItem;
  expanded: boolean;
  parts: ReplayItem[] | undefined;
  partsLoading: boolean;
  activeId: string | null;
  onToggle: () => void;
  onPlay: (item: ReplayItem) => void;
}

function SessionRow({
  session,
  expanded,
  parts,
  partsLoading,
  activeId,
  onToggle,
  onPlay,
}: SessionRowProps) {
  const date = fmtDate(session.recordedAt);
  const hasParts = session.totalParts > 1;

  return (
    <div>
      {/* Session header */}
      <button
        type="button"
        onClick={hasParts ? onToggle : () => onPlay(session)}
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left",
          "transition-colors duration-100 group",
          !hasParts && activeId === session.id
            ? "bg-accent text-accent-foreground"
            : "hover:bg-accent-hover",
        )}
      >
        {/* Cover thumbnail */}
        {session.coverUrl ? (
          <img
            src={session.coverUrl}
            alt=""
            className="h-9 w-16 shrink-0 rounded-xs object-cover bg-muted"
            loading="lazy"
          />
        ) : (
          <div className="h-9 w-16 shrink-0 rounded-xs bg-muted flex items-center justify-center">
            <Film size={14} className="text-disabled-foreground" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-xs font-medium leading-tight">{session.title}</span>
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {date && <span className="shrink-0">{date}</span>}
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
          </div>
        </div>

        {/* Right side */}
        <div className="shrink-0 flex items-center gap-2">
          {hasParts && (
            <span className="inline-flex h-5 shrink-0 items-center rounded-xs bg-muted px-2 text-xs tabular-nums text-muted-foreground">
              {session.totalParts}P
            </span>
          )}
          <ChevronRight
            size={12}
            className={cn(
              "text-subtle-foreground transition-transform duration-150",
              expanded ? "rotate-90" : "",
            )}
          />
        </div>
      </button>

      {/* Expanded parts */}
      {hasParts && expanded && (
        <div className="ml-2 mt-1 mb-1 border-l border-border-faint pl-2">
          {partsLoading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground animate-pulse">
              <Film size={12} />
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

// ── main component ────────────────────────────────────────────────────────────

interface ReplayPanelProps {
  platform: PlatformId;
  roomId: string;
  onPlay: (item: ReplayItem) => void;
  activeReplayId: string | null;
}

export function ReplayPanel({ platform, roomId, onPlay, activeReplayId }: ReplayPanelProps) {
  const [expandedShowId, setExpandedShowId] = useState<number | null>(null);

  const listQuery = useQuery({
    queryKey: ["replay-list", platform, roomId],
    queryFn: () => getReplayList(platform, roomId),
    staleTime: 60_000,
  });

  // For the currently expanded session we load the parts
  const expandedSession = listQuery.data?.find((s) => s.showId === expandedShowId);

  const partsQuery = useQuery({
    queryKey: ["replay-parts", platform, roomId, expandedShowId],
    queryFn: () =>
      expandedSession
        ? getReplayParts(platform, roomId, expandedSession.id, expandedSession.upId)
        : Promise.resolve([]),
    enabled: expandedShowId !== null && expandedSession !== undefined,
    staleTime: 120_000,
  });

  const handleToggle = useCallback((session: ReplayItem) => {
    if (!session.totalParts || session.totalParts <= 1) return;
    setExpandedShowId((prev) => (prev === session.showId ? null : session.showId));
  }, []);

  const sessions = listQuery.data ?? [];

  if (listQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        {Array.from({ length: 4 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="flex gap-2 rounded-sm px-3 py-2">
            <div className="h-9 w-16 rounded-xs bg-muted animate-pulse shrink-0" />
            <div className="flex flex-col gap-2 flex-1">
              <div className="h-3 w-48 rounded-xs bg-muted animate-pulse" />
              <div className="h-2 w-24 rounded-xs bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (listQuery.isError || sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground">
        <PlayCircle size={28} strokeWidth={1.4} className="opacity-30" />
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
            activeId={activeReplayId}
            onToggle={() => handleToggle(session)}
            onPlay={onPlay}
          />
        );
      })}
    </div>
  );
}
