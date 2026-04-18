import { Heart } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { FollowButton } from "@/features/follow-button/ui/FollowButton";
import { useFollowStore } from "@/features/follows/model/useFollowStore";
import { EmptyState } from "@/shared/ui/EmptyState";

const PLATFORM_LABEL: Record<string, string> = {
  bilibili: "B站",
  douyu: "斗鱼",
};

function CardSkeleton() {
  return (
    <div className="rounded-lg overflow-hidden bg-card ring-1 ring-transparent">
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="px-3 pb-2.5 pt-2 flex flex-col gap-1.5">
        <Skeleton className="h-3.5 w-4/5" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
    </div>
  );
}

export function FollowsPage() {
  const follows = useFollowStore((s) => s.follows);
  const liveStatusMap = useFollowStore((s) => s.liveStatusMap);
  const isLoading = useFollowStore((s) => s.isLoading);
  const sortByLive = useFollowStore((s) => s.sortByLive);
  const loadFollows = useFollowStore((s) => s.loadFollows);
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
      <div className="flex items-center gap-2">
        <Heart size={16} strokeWidth={1.8} className="text-muted-foreground/70" />
        <h1 className="text-base font-semibold tracking-tight">关注</h1>
      </div>

      {!follows.length && isLoading ? (
        <div className="cards-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : !follows.length ? (
        <EmptyState title="暂无关注" description="在发现或搜索页点击 ♥" icon={Heart} />
      ) : (
        <div className="cards-grid">
          {sorted.map((follow) => {
            const isLive = liveStatusMap[follow.roomId] ?? false;
            return (
              <div
                key={follow.id}
                className="group relative rounded-lg bg-card overflow-hidden cursor-pointer ring-1 ring-transparent transition-all duration-150 ease-out hover:ring-border hover:shadow-sm"
              >
                <Link to={`/player/${follow.platform}/${follow.roomId}`} className="block">
                  <div className="card-cover">
                    {follow.coverUrl ? (
                      <img
                        src={follow.coverUrl}
                        alt={follow.title}
                        className={`h-full w-full object-cover transition-transform duration-300 ${!isLive ? "opacity-60" : ""}`}
                        loading="lazy"
                      />
                    ) : (
                      <div className="h-full w-full bg-muted" />
                    )}

                    {isLive && (
                      <div className="absolute top-2 left-2 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                        <span className="text-[10px] text-white font-medium">直播中</span>
                      </div>
                    )}

                    <FollowButton
                      room={{
                        platform: follow.platform,
                        roomId: follow.roomId,
                        followed: true,
                        title: follow.title,
                        streamerName: follow.streamerName,
                        coverUrl: follow.coverUrl,
                      }}
                      compact
                    />
                  </div>
                </Link>

                <div className="px-3 pb-2.5 pt-2 flex flex-col gap-1">
                  <Link to={`/player/${follow.platform}/${follow.roomId}`}>
                    <p className="clamp-2 text-[13px] font-medium leading-snug text-foreground transition-colors duration-150 group-hover:text-primary">
                      {follow.title}
                    </p>
                  </Link>
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="clamp-1 text-[11px] text-muted-foreground">
                      {follow.streamerName}
                    </span>
                    <span className="shrink-0 text-border select-none">·</span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {PLATFORM_LABEL[follow.platform] ?? follow.platform}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
