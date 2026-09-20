import { MessageSquareOff } from "lucide-react";
import { useEffect, useId } from "react";
import { cn } from "@/lib/utils";
import { useDanmakuStore } from "../model/useDanmakuStore";

/**
 * One button carries both danmaku jobs — on/off and coverage ratio — by
 * cycling through them:
 *
 *   1/2 → 3/4 → full → 1/4 → off → 1/2
 *
 * (The glyphs on the button are the UI copy for those steps.)
 * The icon is itself the coverage indicator, so the control stays the same
 * size as the other player buttons: a screen outline with its top portion
 * filled (danmaku occupy the top `area` of the stage, per DanmakuOverlay).
 * Switched off, it shows the muted danmaku icon.
 */

interface AreaStep {
  area: number;
  /** Fallback text for tooltips / screen readers. */
  label: string;
}

const AREA_STEPS: AreaStep[] = [
  { area: 0.5, label: "1/2 屏" },
  { area: 0.75, label: "3/4 屏" },
  { area: 1, label: "全屏" },
  { area: 0.25, label: "1/4 屏" },
];

/** Position after the last ratio: danmaku switched off. */
const OFF_INDEX = AREA_STEPS.length;

/** A screen with its top `fraction` filled — how much of the stage danmaku cover. */
function AreaIcon({ fraction }: { fraction: number }) {
  const rawId = useId();
  const clipId = `danmaku-area-${rawId.replace(/[^a-zA-Z0-9-]/g, "")}`;
  const filled = Math.max(3, Math.round(13 * fraction));
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true" role="img">
      <clipPath id={clipId}>
        <rect x={1.5} y={1.5} width={13} height={13} rx={2.6} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <rect x={1.5} y={1.5} width={13} height={filled} fill="currentColor" />
      </g>
      <rect
        x={1.5}
        y={1.5}
        width={13}
        height={13}
        rx={2.6}
        stroke="currentColor"
        strokeWidth={1.4}
      />
    </svg>
  );
}

export function DanmakuControls() {
  const enabled = useDanmakuStore((s) => s.enabled);
  const connectionState = useDanmakuStore((s) => s.connectionState);
  const area = useDanmakuStore((s) => s.area);
  const setEnabled = useDanmakuStore((s) => s.setEnabled);
  const setArea = useDanmakuStore((s) => s.setArea);

  const reconnecting = enabled && connectionState === "reconnecting";
  const unavailable = enabled && connectionState === "closed";

  const currentIndex = enabled
    ? Math.max(
        0,
        AREA_STEPS.findIndex((step) => step.area === area),
      )
    : OFF_INDEX;
  const nextIndex = (currentIndex + 1) % (OFF_INDEX + 1);
  const current = AREA_STEPS[currentIndex];
  const next = AREA_STEPS[nextIndex];

  const label = enabled
    ? `弹幕覆盖 ${current?.label ?? "1/2 屏"}，点击${next ? `切到 ${next.label}` : "关闭弹幕"}`
    : `弹幕已关闭，点击开启（覆盖 ${AREA_STEPS[0]?.label ?? "1/2 屏"}）`;

  useEffect(() => {
    const toggle = () => {
      const state = useDanmakuStore.getState();
      state.setEnabled(!state.enabled);
    };
    window.addEventListener("streaming:toggle-danmaku", toggle);
    return () => window.removeEventListener("streaming:toggle-danmaku", toggle);
  }, []);

  const advance = () => {
    if (nextIndex === OFF_INDEX) {
      setEnabled(false);
      return;
    }
    const step = AREA_STEPS[nextIndex];
    if (!step) return;
    if (!enabled) setEnabled(true);
    setArea(step.area);
  };

  return (
    <button
      type="button"
      onClick={advance}
      className={cn(
        "ctrl-btn relative",
        !enabled && "opacity-40",
        unavailable && "text-stage-warning",
      )}
      aria-label={label}
      title={`${label}（D 键开关）`}
    >
      {enabled ? (
        <AreaIcon fraction={current?.area ?? 0.5} />
      ) : (
        <MessageSquareOff size={16} strokeWidth={1.9} />
      )}
      {enabled && connectionState !== "connected" && (
        <span
          className={cn(
            "absolute right-1 top-1 h-2 w-2 rounded-full",
            reconnecting ? "bg-stage-warning animate-pulse" : "bg-stage-danger",
          )}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
