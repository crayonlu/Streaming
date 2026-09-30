import { Heart, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFollowStore } from "@/features/follows/model/useFollowStore";
import { RoomCard } from "@/features/room-card/ui/RoomCard";
import { useStrings } from "@/shared/i18n";
import { CardSkeleton } from "@/shared/ui/CardSkeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { StatusView } from "@/shared/ui/StatusView";

const FOLLOW_SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `follow-skeleton-${i}`);

export function FollowsPage() {
  const s = useStrings();
  const follows = useFollowStore((s) => s.follows);
  const liveStatusMap = useFollowStore((s) => s.liveStatusMap);
  const isLoading = useFollowStore((s) => s.isLoading);
  const isRefreshingStatus = useFollowStore((s) => s.isRefreshingStatus);
  const error = useFollowStore((s) => s.error);
  const sortByLive = useFollowStore((s) => s.sortByLive);
  const loadFollows = useFollowStore((s) => s.loadFollows);
  const refreshLiveStatus = useFollowStore((s) => s.refreshLiveStatus);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      loadFollows();
    }
  }, [loadFollows]);

  const sorted = [...follows].sort((a, b) => {
    if (sortByLive) {
      const aLive = liveStatusMap[a.roomId] ?? false;
      const bLive = liveStatusMap[b.roomId] ?? false;
      if (aLive !== bLive) return aLive ? -1 : 1;
    }
    return a.followedAt < b.followedAt ? 1 : -1;
  });

  return (
    <section className="page-stack">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Heart size={16} strokeWidth={1.8} className="text-muted-foreground" />
          <h1 className="text-base font-semibold tracking-tight">{s.follows.title}</h1>
        </div>
        {follows.length > 0 && (
          <button
            type="button"
            onClick={() => void refreshLiveStatus()}
            disabled={isRefreshingStatus}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
            aria-label={s.common.refreshLiveStatus}
            title={s.common.refreshLiveStatus}
          >
            <RefreshCw size={14} className={isRefreshingStatus ? "animate-spin" : undefined} />
          </button>
        )}
      </div>

      {!follows.length && isLoading ? (
        <div className="cards-grid">
          {FOLLOW_SKELETON_KEYS.map((key) => (
            <CardSkeleton key={key} />
          ))}
        </div>
      ) : error && !follows.length ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
          <StatusView title={s.common.loadFailed} tone="error" />
          <button
            type="button"
            onClick={() => loadFollows()}
            className="text-xs text-primary hover:underline cursor-pointer"
          >
            {s.common.clickToRetry}
          </button>
        </div>
      ) : !follows.length ? (
        <EmptyState
          title={s.follows.emptyTitle}
          description={s.follows.emptyDescription}
          icon={Heart}
        />
      ) : (
        <ul className="cards-grid">
          {sorted.map((follow) => (
            <RoomCard
              key={follow.id}
              room={{
                id: follow.id,
                platform: follow.platform,
                roomId: follow.roomId,
                title: follow.title,
                streamerName: follow.streamerName,
                coverUrl: follow.coverUrl,
                isLive: liveStatusMap[follow.roomId] ?? false,
                followed: true,
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
