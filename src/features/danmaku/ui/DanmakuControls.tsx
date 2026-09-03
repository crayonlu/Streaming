import { MessageSquare, MessageSquareOff, Settings2 } from "lucide-react";
import { useEffect, useReducer } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useDanmakuStore } from "../model/useDanmakuStore";

const AREA_OPTIONS = [
  { value: "0.25", label: "1/4" },
  { value: "0.5", label: "半屏" },
  { value: "0.75", label: "3/4" },
  { value: "1", label: "全屏" },
] as const;

const FONT_OPTIONS = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
] as const;

/** Danmaku on/off toggle + settings dropdown for the player controls bar. */
export function DanmakuControls() {
  const enabled = useDanmakuStore((s) => s.enabled);
  const opacity = useDanmakuStore((s) => s.opacity);
  const area = useDanmakuStore((s) => s.area);
  const fontSize = useDanmakuStore((s) => s.fontSize);
  const setEnabled = useDanmakuStore((s) => s.setEnabled);
  const setOpacity = useDanmakuStore((s) => s.setOpacity);
  const setArea = useDanmakuStore((s) => s.setArea);
  const setFontSize = useDanmakuStore((s) => s.setFontSize);

  // Re-render on fullscreen changes so the dropdown's portal container
  // (document.fullscreenElement) is fresh when the menu next opens.
  const [, forceRender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const onFsChange = () => forceRender();
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={() => setEnabled(!enabled)}
        className={cn("ctrl-btn", !enabled && "opacity-60")}
        aria-label={enabled ? "关闭弹幕" : "开启弹幕"}
      >
        {enabled ? (
          <MessageSquare size={15} strokeWidth={1.9} />
        ) : (
          <MessageSquareOff size={15} strokeWidth={1.9} />
        )}
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="ctrl-btn" aria-label="弹幕设置">
            <Settings2 size={15} strokeWidth={1.9} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-56 p-3"
          // Portal into the fullscreen element when the player is fullscreen —
          // body-portaled content is invisible there. Evaluated at open time.
          container={(document.fullscreenElement as HTMLElement | null) ?? undefined}
        >
          <DropdownMenuLabel className="px-0 pb-2 text-xs">弹幕设置</DropdownMenuLabel>

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted-foreground">不透明度</span>
            <input
              type="range"
              min={0.2}
              max={1}
              step={0.05}
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              aria-label="弹幕不透明度"
              className="vol-slider w-full"
              style={{
                background: `linear-gradient(90deg, oklch(96% 0.004 250 / 0.78) ${opacity * 100}%, oklch(96% 0.004 250 / 0.18) ${opacity * 100}%)`,
              }}
            />
          </div>

          <DropdownMenuSeparator className="my-2.5" />

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted-foreground">显示区域</span>
            <ToggleGroup
              type="single"
              value={String(area)}
              onValueChange={(v) => {
                if (v) setArea(Number(v));
              }}
              className="justify-start"
            >
              {AREA_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value} className="text-[11px] px-2 h-6">
                  {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          <DropdownMenuSeparator className="my-2.5" />

          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] text-muted-foreground">字号</span>
            <ToggleGroup
              type="single"
              value={fontSize}
              onValueChange={(v) => {
                if (v === "small" || v === "medium" || v === "large") setFontSize(v);
              }}
              className="justify-start"
            >
              {FONT_OPTIONS.map((o) => (
                <ToggleGroupItem key={o.value} value={o.value} className="text-[11px] px-2 h-6">
                  {o.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
