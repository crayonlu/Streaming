import { useQuery } from "@tanstack/react-query";
import { Flame, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { usePlatformStore } from "@/features/platform-switch/model/usePlatformStore";
import { PlatformSwitch } from "@/features/platform-switch/ui/PlatformSwitch";
import { RoomCard } from "@/features/room-card/ui/RoomCard";
import { getFeatured, loadPreferences } from "@/shared/api/commands";
import type { AppPreferences, PlatformId } from "@/shared/types/domain";
import { EmptyState } from "@/shared/ui/EmptyState";
import { StatusView } from "@/shared/ui/StatusView";

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

function ResumeBanner({
  lastVisited,
  onDismiss,
}: {
  lastVisited: NonNullable<AppPreferences["lastVisited"]>;
  onDismiss: () => void;
}) {
  if (lastVisited.type !== "room" || !lastVisited.platform || !lastVisited.roomId) return null;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-accent/30 px-3.5 py-2">
      <div className="flex items-center gap-2 min-w-0">
        <Play size={12} className="shrink-0 text-primary" strokeWidth={2.2} />
        <p className="text-xs text-foreground truncate">上次观看</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={`/player/${lastVisited.platform}/${lastVisited.roomId}`}
          className="text-xs font-medium text-primary hover:underline underline-offset-2"
        >
          继续
        </Link>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          aria-label="关闭"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

export function DiscoverPage() {
  const currentPlatform = usePlatformStore((s) => s.currentPlatform);
  const [resumeEntry, setResumeEntry] = useState<AppPreferences["lastVisited"] | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const query = useQuery({
    queryKey: ["featured", currentPlatform],
    // Use the key directly instead of the closure-captured currentPlatform to
    // avoid a stale-closure race where the value changes between schedule and
    // execution of this function.
    queryFn: ({ queryKey }) => getFeatured(queryKey[1] as PlatformId),
    staleTime: 30_000, // keep data fresh for 30 s — no flicker on back-nav
    gcTime: 2 * 60_000, // discard cache after 2 min of inactivity
    refetchOnWindowFocus: false, // avoid spurious refetch when user alt-tabs
  });

  useEffect(() => {
    let mounted = true;
    void loadPreferences().then((pref) => {
      if (!mounted) return;
      if (pref.resumeLastSession && pref.lastVisited?.type === "room") {
        setResumeEntry(pref.lastVisited);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="page-stack">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Flame size={16} strokeWidth={1.8} className="text-muted-foreground/70" />
          <h1 className="text-base font-semibold tracking-tight">发现</h1>
        </div>
        <PlatformSwitch />
      </div>

      {resumeEntry && !dismissed && (
        <ResumeBanner lastVisited={resumeEntry} onDismiss={() => setDismissed(true)} />
      )}

      {query.isLoading ? (
        <div className="cards-grid">
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static-length skeleton placeholder
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <StatusView title="加载失败" tone="error" hint="请稍后重试" />
      ) : !query.data?.length ? (
        <EmptyState title="暂无内容" description="可切换平台或稍后刷新" icon={Flame} />
      ) : (
        <div
          className="cards-grid transition-opacity duration-150"
          style={{ opacity: query.isFetching ? 0.5 : 1 }}
        >
          {query.data.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </section>
  );
}
