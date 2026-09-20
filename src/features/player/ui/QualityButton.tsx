import { Repeat } from "lucide-react";
import type { PlayerQualityItem } from "./VideoPlayer";

interface QualityButtonProps {
  items: PlayerQualityItem[];
  selectedId: string | null | undefined;
  onSelect: (id: string) => void;
}

/**
 * Next selectable quality after `selectedId`, wrapping past the end.
 * Returns null when no other entry is selectable — the click is then a no-op.
 * An unknown `selectedId` (the label has already fallen back to the generic
 * quality placeholder) scans the whole
 * list, since there is no current entry to skip.
 */
function findNextQuality(items: PlayerQualityItem[], selectedId: string | null | undefined) {
  const start = items.findIndex((i) => i.id === selectedId);
  const steps = start === -1 ? items.length : items.length - 1;
  for (let step = 1; step <= steps; step += 1) {
    const next = items[(start + step + items.length) % items.length];
    if (next && !next.failed) return next;
  }
  return null;
}

export function QualityButton({ items, selectedId, onSelect }: QualityButtonProps) {
  const selected = items.find((i) => i.id === selectedId);
  const next = findNextQuality(items, selectedId);
  const label = selected?.label ?? "画质";
  const action = next
    ? `切换画质：当前 ${label}，下一档 ${next.label}`
    : `切换画质：当前 ${label}，暂无其他画质`;

  return (
    <button
      type="button"
      className="ctrl-btn ctrl-btn-label"
      aria-label={action}
      title={action}
      onClick={() => {
        if (next) onSelect(next.id);
      }}
    >
      {label}
      <Repeat size={12} strokeWidth={2.2} className="shrink-0 opacity-60" />
    </button>
  );
}
