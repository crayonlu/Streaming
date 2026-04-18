import { ChevronDown, ChevronUp, Flame, Play, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useDiscoverStore } from "@/features/discover/model/useDiscoverStore";
import { usePlatformStore } from "@/features/platform-switch/model/usePlatformStore";
import { PlatformSwitch } from "@/features/platform-switch/ui/PlatformSwitch";
import { RoomCard } from "@/features/room-card/ui/RoomCard";
import { cn } from "@/lib/utils";
import { getCategories, loadPreferences } from "@/shared/api/commands";
import { findScrollParent } from "@/shared/lib/dom";
import type { AppPreferences, Category, PlatformId } from "@/shared/types/domain";
import { CardSkeleton } from "@/shared/ui/CardSkeleton";
import { EmptyState } from "@/shared/ui/EmptyState";
import { LoadingIndicator } from "@/shared/ui/LoadingIndicator";
import { StatusView } from "@/shared/ui/StatusView";

// ── Category filter bar ───────────────────────────────────────────────────────
// Two rows:
//   Row 1: "推荐" + parent categories (horizontal scroll chips)
//   Row 2: sub-categories of the selected parent (collapsible, default collapsed to 1 row)
//
// When a parent category is selected:
//   Bilibili: queries with area_id=0 (all sub-areas) + parent_area_id
//   Douyu: queries with parent's shortName (if available)
// When a sub-category is selected:
//   Bilibili: queries with area_id (sub) + parent_area_id (parent)
//   Douyu: queries with sub-category's shortName

const SUB_COLLAPSED_COUNT = 8; // chips visible when collapsed

interface CategorySelection {
  categoryId: string;
  parentId: string | null;
  shortName: string | null;
}

function CategoryFilter({
  platform,
  selection,
  onSelect,
}: {
  platform: PlatformId;
  selection: CategorySelection | null;
  onSelect: (selection: CategorySelection | null) => void;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [subExpanded, setSubExpanded] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    setLoading(true);
    setSubExpanded(false);
    onSelectRef.current(null);
    getCategories(platform)
      .then((cats) => setCategories(cats))
      .catch(() => setCategories([]))
      .finally(() => setLoading(false));
  }, [platform]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive parent & sub lists
  const parents = categories.filter((c) => !c.parentId);
  const selectedId = selection?.categoryId ?? null;
  const selectedParentId = selection ? (selection.parentId ?? selection.categoryId) : null;
  const subCategories = selectedParentId
    ? categories.filter((c) => c.parentId === selectedParentId)
    : [];

  // Sort: active parent moves to front (after "推荐")
  const sortedParents = useMemo(() => {
    const active = parents.find((c) => selectedParentId === c.id);
    const rest = parents.filter((c) => selectedParentId !== c.id);
    return active ? [active, ...rest] : rest;
  }, [parents, selectedParentId]);

  // Sort: active sub moves to front
  const sortedSubs = useMemo(() => {
    const active = subCategories.find((c) => selectedId === c.id);
    const rest = subCategories.filter((c) => selectedId !== c.id);
    return active ? [active, ...rest] : rest;
  }, [subCategories, selectedId]);

  // When a parent chip is clicked
  const handleParentSelect = (cat: Category) => {
    setSubExpanded(false);
    if (platform === "douyu") {
      const firstSub = categories.find((c) => c.parentId === cat.id && c.shortName);
      if (firstSub) {
        onSelectRef.current({
          categoryId: firstSub.id,
          parentId: cat.id,
          shortName: firstSub.shortName ?? null,
        });
        return;
      }
    }
    onSelectRef.current({
      categoryId: cat.id,
      parentId: null,
      shortName: cat.shortName ?? null,
    });
  };

  // When a sub-category chip is clicked
  const handleSubSelect = (cat: Category) => {
    onSelectRef.current({
      categoryId: cat.id,
      parentId: cat.parentId ?? null,
      shortName: cat.shortName ?? null,
    });
  };

  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1.5 scrollbar-none shrink-0">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-7 w-16 rounded-full bg-muted animate-pulse shrink-0" />
        ))}
      </div>
    );
  }

  if (!parents.length) return null;

  const visibleSubs = subExpanded ? sortedSubs : sortedSubs.slice(0, SUB_COLLAPSED_COUNT);
  const hasMoreSubs = sortedSubs.length > SUB_COLLAPSED_COUNT;

  return (
    <div className="shrink-0 space-y-1.5">
      {/* Row 1: parent categories — prominent pill style */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
        <button
          type="button"
          onClick={() => {
            setSubExpanded(false);
            onSelectRef.current(null);
          }}
          className={cn(
            "cat-chip cat-chip--parent cursor-pointer",
            !selectedId && "cat-chip--active",
          )}
        >
          推荐
        </button>
        {sortedParents.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => handleParentSelect(cat)}
            className={cn(
              "cat-chip cat-chip--parent cursor-pointer",
              selectedParentId === cat.id && "cat-chip--active",
            )}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Row 2: sub-categories — lighter, smaller pills with expand/collapse */}
      {subCategories.length > 0 && (
        <div className="cat-subs-container">
          <div className="flex flex-wrap gap-1">
            {visibleSubs.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleSubSelect(cat)}
                className={cn(
                  "cat-chip cat-chip--sub cursor-pointer",
                  selectedId === cat.id && "cat-chip--active",
                )}
              >
                {cat.name}
              </button>
            ))}
            {hasMoreSubs && (
              <button
                type="button"
                onClick={() => setSubExpanded((v) => !v)}
                className="cat-chip cat-chip--expand cursor-pointer flex items-center gap-0.5"
              >
                {subExpanded ? (
                  <>
                    收起 <ChevronUp size={10} />
                  </>
                ) : (
                  <>
                    更多 <ChevronDown size={10} />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
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
  const rooms = useDiscoverStore((s) => s.rooms);
  const isLoading = useDiscoverStore((s) => s.isLoading);
  const error = useDiscoverStore((s) => s.error);
  const hasNextPage = useDiscoverStore((s) => s.hasNextPage);
  const categorySelection = useDiscoverStore((s) => s.categorySelection);
  const setCategorySelection = useDiscoverStore((s) => s.setCategorySelection);
  const fetchFirstPage = useDiscoverStore((s) => s.fetchFirstPage);
  const fetchNextPage = useDiscoverStore((s) => s.fetchNextPage);
  const [resumeEntry, setResumeEntry] = useState<AppPreferences["lastVisited"] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Fetch first page when platform changes - Store 内部处理 categorySelection 重置
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
  }, [isLoading, rooms.length, currentPlatform, fetchNextPage]);

  useEffect(() => {
    let mounted = true;
    loadPreferences().then((pref) => {
      if (!mounted) return;
      if (pref.resumeLastSession && pref.lastVisited?.type === "room") {
        setResumeEntry(pref.lastVisited);
      }
    });
    return () => {
      mounted = false;
    };
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

      <CategoryFilter
        platform={currentPlatform}
        selection={categorySelection}
        onSelect={setCategorySelection}
      />

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
