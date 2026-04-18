import { SearchX } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { RoomCard } from "@/features/room-card/ui/RoomCard";
import { useSearchStore } from "@/features/search/model/useSearchStore";
import { findScrollParent } from "@/shared/lib/dom";
import type { PlatformId } from "@/shared/types/domain";
import { CardSkeleton } from "@/shared/ui/CardSkeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { LoadingIndicator } from "@/shared/ui/LoadingIndicator";
import { StatusView } from "@/shared/ui/StatusView";

type SearchScope = "all" | PlatformId;

const SCOPE_OPTIONS: { value: SearchScope; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "bilibili", label: "Bilibili" },
  { value: "douyu", label: "斗鱼" },
];

export function SearchPage() {
  const [params] = useSearchParams();
  const keyword = params.get("q")?.trim() ?? "";
  const scope = (params.get("scope") as SearchScope | null) ?? "all";
  const scopedPlatform = scope === "all" ? undefined : scope;

  const rooms = useSearchStore((s) => s.rooms);
  const isLoading = useSearchStore((s) => s.isLoading);
  const error = useSearchStore((s) => s.error);
  const hasNextPage = useSearchStore((s) => s.hasNextPage);
  const searchFirstPage = useSearchStore((s) => s.searchFirstPage);
  const searchNextPage = useSearchStore((s) => s.searchNextPage);

  const sectionRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Debounced search — 300 ms delay after last keystroke
  useEffect(() => {
    if (!keyword) return;
    const id = setTimeout(() => searchFirstPage(keyword, scopedPlatform), 300);
    return () => clearTimeout(id);
  }, [keyword, scopedPlatform, searchFirstPage]);

  useEffect(() => {
    if (isLoading || !rooms.length) return;
    const sentinel = sentinelRef.current;
    const section = sectionRef.current;
    if (!sentinel || !section) return;
    const scrollRoot = findScrollParent(section);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) searchNextPage();
      },
      { root: scrollRoot, rootMargin: "320px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isLoading, rooms.length, searchNextPage]);

  const hasData = rooms.length > 0;
  const isEmpty = !isLoading && !hasData && !error;

  return (
    <section ref={sectionRef} className="page-stack">
      {keyword && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted-foreground truncate max-w-xs">
            <span className="text-foreground font-medium">"{keyword}"</span>
          </p>
          <div className="flex items-center gap-1">
            {SCOPE_OPTIONS.map((opt) => (
              <Link
                key={opt.value}
                to={`/search?q=${encodeURIComponent(keyword)}&scope=${opt.value}`}
              >
                <Button
                  variant={scope === opt.value ? "muted" : "ghost"}
                  size="sm"
                  className="text-xs h-7 px-2.5"
                >
                  {opt.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!keyword ? (
        <EmptyState title="输入关键词开始搜索" icon={SearchX} />
      ) : !hasData && isLoading ? (
        <div className="cards-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <StatusView title="搜索失败" tone="error" />
      ) : isEmpty ? (
        <EmptyState title={`"${keyword}" 无结果`} description="换个关键词试试" icon={SearchX} />
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
            <p className="text-center text-xs text-muted-foreground py-4">已加载全部结果</p>
          )}
        </>
      )}
    </section>
  );
}
