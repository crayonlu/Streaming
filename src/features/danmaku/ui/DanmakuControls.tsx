import { MessageSquare, MessageSquareOff } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { useDanmakuStore } from "../model/useDanmakuStore";

/** One-click danmaku control. Connection health is conveyed by the icon itself. */
export function DanmakuControls() {
  const enabled = useDanmakuStore((s) => s.enabled);
  const connectionState = useDanmakuStore((s) => s.connectionState);
  const setEnabled = useDanmakuStore((s) => s.setEnabled);
  const reconnecting = enabled && connectionState === "reconnecting";
  const unavailable = enabled && connectionState === "closed";
  const label = !enabled
    ? "开启弹幕"
    : reconnecting
      ? "弹幕重连中"
      : unavailable
        ? "弹幕连接已断开"
        : "关闭弹幕";

  useEffect(() => {
    const toggle = () => {
      const state = useDanmakuStore.getState();
      state.setEnabled(!state.enabled);
    };
    window.addEventListener("streaming:toggle-danmaku", toggle);
    return () => window.removeEventListener("streaming:toggle-danmaku", toggle);
  }, []);

  return (
    <button
      type="button"
      onClick={() => setEnabled(!enabled)}
      className={cn(
        "ctrl-btn relative",
        !enabled && "opacity-60",
        unavailable && "text-amber-300/80",
      )}
      aria-label={label}
      aria-pressed={enabled}
      title={`${label}（D）`}
    >
      {enabled ? (
        <MessageSquare
          size={15}
          strokeWidth={1.9}
          className={cn(reconnecting && "animate-pulse")}
        />
      ) : (
        <MessageSquareOff size={15} strokeWidth={1.9} />
      )}
      {enabled && connectionState !== "connected" && (
        <span
          className={cn(
            "absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
            reconnecting ? "bg-amber-300 animate-pulse" : "bg-red-400",
          )}
          aria-hidden="true"
        />
      )}
    </button>
  );
}
