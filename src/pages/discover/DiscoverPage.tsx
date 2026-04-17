import { Flame, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { useDiscoverStore } from "@/features/discover/model/useDiscoverStore";
import { usePlatformStore } from "@/features/platform-switch/model/usePlatformStore";
import { PlatformSwitch } from "@/features/platform-switch/ui/PlatformSwitch";
import { RoomCard } from "@/features/room-card/ui/RoomCard";
import { loadPreferences } from "@/shared/api/commands";
import type { AppPreferences } from "@/shared/types/domain";
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

function LoadingIndicator() {
  return (
    <div className="flex items-center justify-center py-4 gap-2 text-muted-foreground">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      <span className="text-xs">加载更多...</span>
    </div>
  );
}

function findScrollParent(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start?.parentElement ?? null;
  while (el && el !== document.body) {
    const { overflowY } = window.getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(overflowY)) return el;
    el = el.parentElement;
  }
  return null;
}

export function DiscoverPage() {
  const currentPlatform = usePlatformStore((s) => s.currentPlatform);
  const rooms = useDiscoverStore((s) => s.rooms);
  const isLoading = useDiscoverStore((s) => s.isLoading);
  const error = useDiscoverStore((s) => s.error);
  const hasNextPage = useDiscoverStore((s) => s.hasNextPage);
  const fetchFirstPage = useDiscoverStore((s) => s.fetchFirstPage);
  const fetchNextPage = useDiscoverStore((s) => s.fetchNextPage);
  const [resumeEntry, setResumeEntry] = useState<AppPreferences["lastVisited"] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchFirstPage(currentPlatform);
    const section = sectionRef.current;
    const scrollRoot = findScrollParent(section);
    (scrollRoot ?? document.documentElement).scrollTo({ top: 0, behavior: "smooth" });
  }, [currentPlatform, fetchFirstPage]);

  useEffect(() => {
    if (isLoading || !rooms.length) return;
    const sentinel = sentinelRef.current;
    const section = sectionRef.current;
    if (!sentinel || !section) return;
    const scrollRoot = findScrollParent(section);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) fetchNextPage(currentPlatform);
      },
      { root: scrollRoot, rootMargin: "320px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLoading, rooms.length, hasNextPage, currentPlatform, fetchNextPage]);

  useEffect(() => {
    let mounted = true;
    loadPreferences().then((pref) => {
      if (!mounted) return;
      if (pref.resumeLastSession && pref.lastVisited?.type === "room") {
        setResumeEntry(pref.lastVisited);
      }
    });
    return () => { mounted = false; };
  }, []);

  const hasData = rooms.length > 0;
  const isEmpty = !isLoading && !hasData && !error;

  return (
    <section ref={sectionRef} className="page-stack">
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

      {!hasData && isLoading ? (
        <div className="cards-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <StatusView title="加载失败" tone="error" hint="请稍后重试" />
      ) : isEmpty ? (
        <EmptyState title="暂无内容" description="可切换平台或稍后刷新" icon={Flame} />
      ) : (
        <>
          <div className="cards-grid">
            {rooms.map((room) => (
              <RoomCard key={room.id} room={room} />
            ))}
          </div>
          <div ref={sentinelRef} className="h-1 w-full shrink-0" aria-hidden />
          {hasData && isLoading && <LoadingIndicator />}
          {!hasNextPage && hasData && !isLoading && (
            <p className="text-center text-xs text-muted-foreground py-4">已加载全部内容</p>
          )}
        </>
      )}
    </section>
  );
}
