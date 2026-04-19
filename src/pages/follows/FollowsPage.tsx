import { Heart, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFollowStore } from "@/features/follows/model/useFollowStore";
import { RoomCard } from "@/features/room-card/ui/RoomCard";
import { CardSkeleton } from "@/shared/ui/CardSkeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { StatusView } from "@/shared/ui/StatusView";

const FOLLOW_SKELETON_KEYS = Array.from({ length: 8 }, (_, i) => `follow-skeleton-${i}`);

export function FollowsPage() {
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
          <Heart size={16} strokeWidth={1.8} className="text-muted-foreground/70" />
          <h1 className="text-base font-semibold tracking-tight">关注</h1>
        </div>
        {follows.length > 0 && (
          <button
            type="button"
            onClick={() => void refreshLiveStatus()}
            disabled={isRefreshingStatus}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            aria-label="刷新直播状态"
            title="刷新直播状态"
          >
            <RefreshCw size={13} className={isRefreshingStatus ? "animate-spin" : undefined} />
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
          <StatusView title="加载失败" tone="error" />
          <button
            type="button"
            onClick={() => loadFollows()}
            className="text-xs text-primary hover:underline cursor-pointer"
          >
            点击重试
          </button>
        </div>
      ) : !follows.length ? (
        <EmptyState title="暂无关注" description="在发现或搜索页点击 ♥" icon={Heart} />
      ) : (
        <div className="cards-grid">
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
        </div>
      )}
    </section>
  );
}
