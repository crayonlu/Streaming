import { Radio } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { loadPreferences, savePreferences } from "@/shared/api/commands";
import { PLATFORM_LABEL } from "@/shared/lib/platform";
import type { PlatformId } from "@/shared/types/domain";

interface OnboardingOverlayProps {
  onDone: (platform: PlatformId) => void;
}

const PLATFORMS: PlatformId[] = ["bilibili", "douyu", "huya"];

const PLATFORM_DESC: Record<PlatformId, string> = {
  bilibili: "游戏 · 虚拟 · 综合",
  douyu: "游戏 · 体育 · 综艺",
  huya: "游戏 · 电竞 · 娱乐",
};

export function OnboardingOverlay({ onDone }: OnboardingOverlayProps) {
  const [selected, setSelected] = useState<PlatformId>("bilibili");
  const [saving, setSaving] = useState(false);

  const handleStart = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    try {
      const prefs = await loadPreferences();
      await savePreferences({
        ...prefs,
        defaultPlatform: selected,
        onboardingDone: true,
      });
      onDone(selected);
    } catch {
      // Non-critical — let the user in regardless
      onDone(selected);
    }
  }, [selected, saving, onDone]);

  return (
    // Full-screen backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      aria-modal="true"
      role="dialog"
      aria-label="欢迎使用 Streaming"
    >
      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-border/60 bg-card shadow-lg shadow-black/8 px-8 py-8 flex flex-col gap-6">
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Radio size={20} strokeWidth={1.9} />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">
              欢迎使用 Streaming
            </h1>
            <p className="mt-1 text-[12.5px] text-muted-foreground leading-relaxed">
              一个入口，同时浏览三个平台的直播。
            </p>
          </div>
        </div>

        {/* Platform picker */}
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
            选择你常看的平台
          </p>
          <div className="flex flex-col gap-1.5">
            {PLATFORMS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSelected(p)}
                aria-pressed={selected === p}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3.5 py-2.5 text-left",
                  "transition-all duration-150 cursor-pointer",
                  selected === p
                    ? "border-primary/40 bg-primary/6 text-foreground"
                    : "border-border/50 bg-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground hover:border-border",
                )}
              >
                <span className="text-[13px] font-medium">{PLATFORM_LABEL[p]}</span>
                <span
                  className={cn(
                    "text-[11px]",
                    selected === p ? "text-muted-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {PLATFORM_DESC[p]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <Button
          onClick={() => void handleStart()}
          disabled={saving}
          className="w-full h-9 text-[13px]"
        >
          {saving ? "保存中…" : "开始使用"}
        </Button>

        {/* Fine print */}
        <p className="text-center text-[10.5px] text-muted-foreground/50 leading-relaxed -mt-2">
          支持 Bilibili · 斗鱼 · 虎牙 · 随时可在设置中更改
        </p>
      </div>
    </div>
  );
}
