import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { getCategories } from "@/shared/api/commands";
import type { Category, PlatformId } from "@/shared/types/domain";

const SUB_COLLAPSED_COUNT = 8;
const SKELETON_KEYS = [
  "cat-skeleton-1",
  "cat-skeleton-2",
  "cat-skeleton-3",
  "cat-skeleton-4",
  "cat-skeleton-5",
  "cat-skeleton-6",
];

export interface CategorySelection {
  categoryId: string;
  parentId: string | null;
  shortName: string | null;
}

interface CategoryFilterProps {
  platform: PlatformId;
  selection: CategorySelection | null;
  onSelect: (selection: CategorySelection | null) => void;
}

export function CategoryFilter({ platform, selection, onSelect }: CategoryFilterProps) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [subExpanded, setSubExpanded] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setCategories([]);
    setSubExpanded(false);
    onSelectRef.current(null);
    getCategories(platform)
      .then((cats) => {
        if (active) setCategories(cats);
      })
      .catch(() => {
        if (active) setCategories([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [platform]);

  const parents = categories.filter((c) => !c.parentId);
  const selectedId = selection?.categoryId ?? null;
  const selectedParentId = selection ? (selection.parentId ?? selection.categoryId) : null;
  const subCategories = selectedParentId
    ? categories.filter((c) => c.parentId === selectedParentId)
    : [];

  const sortedParents = useMemo(() => {
    const active = parents.find((c) => selectedParentId === c.id);
    const rest = parents.filter((c) => selectedParentId !== c.id);
    return active ? [active, ...rest] : rest;
  }, [parents, selectedParentId]);

  const sortedSubs = useMemo(() => {
    const active = subCategories.find((c) => selectedId === c.id);
    const rest = subCategories.filter((c) => selectedId !== c.id);
    return active ? [active, ...rest] : rest;
  }, [subCategories, selectedId]);

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
        {SKELETON_KEYS.map((key) => (
          <div key={key} className="h-7 w-16 rounded-full bg-muted animate-pulse shrink-0" />
        ))}
      </div>
    );
  }

  if (!parents.length) return null;

  const visibleSubs = subExpanded ? sortedSubs : sortedSubs.slice(0, SUB_COLLAPSED_COUNT);
  const hasMoreSubs = sortedSubs.length > SUB_COLLAPSED_COUNT;

  return (
    <div className="shrink-0 space-y-1.5">
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
          aria-pressed={!selectedId}
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
            aria-pressed={selectedParentId === cat.id}
          >
            {cat.name}
          </button>
        ))}
      </div>

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
                aria-pressed={selectedId === cat.id}
              >
                {cat.name}
              </button>
            ))}
            {hasMoreSubs && (
              <button
                type="button"
                onClick={() => setSubExpanded((v) => !v)}
                className="cat-chip cat-chip--expand cursor-pointer flex items-center gap-0.5"
                aria-expanded={subExpanded}
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
