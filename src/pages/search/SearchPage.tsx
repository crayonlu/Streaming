import { useQuery } from "@tanstack/react-query";
import { SearchX } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RoomCard } from "@/features/room-card/ui/RoomCard";
import { searchRooms } from "@/shared/api/commands";
import type { PlatformId } from "@/shared/types/domain";
import { EmptyState } from "@/shared/ui/EmptyState";
import { StatusView } from "@/shared/ui/StatusView";

type SearchScope = "all" | PlatformId;

const SCOPE_OPTIONS: { value: SearchScope; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "bilibili", label: "B站" },
  { value: "douyu", label: "斗鱼" },
];

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

export function SearchPage() {
  const [params] = useSearchParams();
  const keyword = params.get("q")?.trim() ?? "";
  const scope = (params.get("scope") as SearchScope | null) ?? "all";
  const scopedPlatform = scope === "all" ? undefined : scope;

  const query = useQuery({
    queryKey: ["search", keyword, scopedPlatform],
    queryFn: () => searchRooms(keyword, scopedPlatform),
    enabled: keyword.length > 0,
  });

  return (
    <section className="page-stack">
      {/* Header — only shown when there's a keyword */}
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
      ) : query.isLoading ? (
        <div className="cards-grid">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static-length skeleton placeholder
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <StatusView title="搜索失败" tone="error" />
      ) : !query.data?.items.length ? (
        <EmptyState title={`"${keyword}" 无结果`} description="换个关键词试试" icon={SearchX} />
      ) : (
        <div className="cards-grid">
          {query.data.items.map((room) => (
            <RoomCard key={room.id} room={room} />
          ))}
        </div>
      )}
    </section>
  );
}
