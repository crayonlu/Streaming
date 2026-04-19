import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { PlayerQualityItem } from "./VideoPlayer";

interface QualityMenuProps {
  items: PlayerQualityItem[];
  selectedId: string | null | undefined;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (id: string) => void;
}

export function QualityMenu({ items, selectedId, open, onOpenChange, onSelect }: QualityMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = items.find((i) => i.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="ctrl-btn ctrl-btn-label"
        aria-label="切换画质"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        {selected?.label ?? "画质"}
        <ChevronDown
          size={10}
          strokeWidth={2.2}
          className="shrink-0 opacity-55"
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
          }}
        />
      </button>

      {open && (
        <div
          className="player-quality-popup"
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Escape") onOpenChange(false);
          }}
        >
          {items.map((item) => {
            const isActive = item.id === selectedId;
            return (
              <button
                type="button"
                key={item.id}
                role="menuitemradio"
                aria-checked={isActive}
                disabled={item.failed}
                className={cn(
                  "player-quality-item",
                  isActive && "is-active",
                  item.failed && "is-failed",
                )}
                onClick={() => {
                  if (!item.failed) {
                    onSelect(item.id);
                    onOpenChange(false);
                  }
                }}
              >
                <Check
                  size={11}
                  strokeWidth={2.2}
                  className={isActive ? "opacity-100 shrink-0" : "opacity-0 shrink-0"}
                />
                {item.label}
                {item.cdn && <span className="text-muted-foreground ml-1">{item.cdn}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
