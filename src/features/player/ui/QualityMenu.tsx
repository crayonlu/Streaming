import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef } from "react";
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
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const selected = items.find((i) => i.id === selectedId);

  // ── Close on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onOpenChange]);

  // ── Focus management on open/close ────────────────────────────────────────
  // When the menu opens, focus the currently selected item (or the first
  // non-disabled item). When it closes, return focus to the trigger.
  useEffect(() => {
    if (open) {
      // rAF so the DOM is painted before we query buttons
      requestAnimationFrame(() => {
        const menu = menuRef.current;
        if (!menu) return;
        const buttons = Array.from(
          menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        );
        const activeIndex = items.findIndex((i) => i.id === selectedId);
        const target =
          buttons[activeIndex] ?? buttons.find((_, i) => !items[i]?.failed) ?? buttons[0];
        target?.focus();
      });
    } else {
      // Restore focus to the trigger when menu closes via keyboard
      triggerRef.current?.focus();
    }
  }, [open, items, selectedId]);

  // ── Keyboard navigation inside the menu ───────────────────────────────────
  const handleMenuKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const menu = menuRef.current;
      if (!menu) return;

      const buttons = Array.from(menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
      const focused = document.activeElement as HTMLButtonElement | null;
      const currentIndex = buttons.indexOf(focused as HTMLButtonElement);

      switch (e.key) {
        case "ArrowDown": {
          e.preventDefault();
          const next = buttons[(currentIndex + 1) % buttons.length];
          next?.focus();
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const prev = buttons[(currentIndex - 1 + buttons.length) % buttons.length];
          prev?.focus();
          break;
        }
        case "Home": {
          e.preventDefault();
          buttons[0]?.focus();
          break;
        }
        case "End": {
          e.preventDefault();
          buttons[buttons.length - 1]?.focus();
          break;
        }
        case "Escape": {
          e.preventDefault();
          e.stopPropagation(); // don't let Esc bubble to the player container
          onOpenChange(false);
          break;
        }
        case "Tab": {
          // Trap Tab inside the menu to prevent focus escaping the player
          e.preventDefault();
          if (e.shiftKey) {
            const prev = buttons[(currentIndex - 1 + buttons.length) % buttons.length];
            prev?.focus();
          } else {
            const next = buttons[(currentIndex + 1) % buttons.length];
            next?.focus();
          }
          break;
        }
      }
    },
    [onOpenChange],
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="ctrl-btn ctrl-btn-label"
        aria-label="切换画质"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
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
          ref={menuRef}
          id={menuId}
          className="player-quality-popup"
          role="menu"
          aria-label="画质选择"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
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
