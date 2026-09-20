import {
  Check,
  Film,
  Globe,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  Paintbrush,
  Settings2,
  Sun,
  Tv2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useDanmakuStore } from "@/features/danmaku/model/useDanmakuStore";
import { type ThemeMode, useThemeStore } from "@/features/theme/model/useThemeStore";
import { cn } from "@/lib/utils";
import { loadPreferences, savePreferences } from "@/shared/api/commands";
import type { AppPreferences, PlatformId, ProxyMode } from "@/shared/types/domain";
import { StatusView } from "@/shared/ui/StatusView";

// ── Tiny sub-components ──────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={12} strokeWidth={1.8} className="text-muted-foreground" />
      <p className="text-xs font-medium text-subtle-foreground uppercase tracking-caps">{label}</p>
    </div>
  );
}

function Row({
  label,
  description,
  children,
  last = false,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-6 px-4 py-4",
        !last && "border-b border-border",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium leading-none">{label}</p>
        {description && (
          <p className="mt-1 text-xs text-muted-foreground leading-snug">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent",
        "transition-colors duration-150",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-primary-foreground shadow-e1",
          "transition-transform duration-150",
          checked ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

// ── Proxy selector ───────────────────────────────────────────────────────────

const PROXY_OPTIONS: {
  value: ProxyMode;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  {
    value: "none",
    label: "不代理",
    description: "直接连接，忽略系统代理设置",
    icon: Network,
  },
  {
    value: "system",
    label: "系统代理",
    description: "使用 OS 或环境变量中的代理配置",
    icon: Globe,
  },
];

function ProxySelector({
  value,
  onChange,
}: {
  value: ProxyMode;
  onChange: (v: ProxyMode) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 p-1">
      {PROXY_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col gap-2 rounded-sm p-3 text-left transition-all duration-150 cursor-pointer",
              "border",
              active
                ? "border-primary-border bg-accent text-accent-foreground"
                : "border-border bg-transparent text-muted-foreground hover:bg-secondary-hover hover:text-foreground",
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <Icon
                size={14}
                strokeWidth={1.8}
                className={active ? "text-accent-foreground" : "text-muted-foreground"}
              />
              {active && <Check size={12} strokeWidth={2.4} className="text-accent-foreground" />}
            </div>
            <p className={cn("text-xs font-medium leading-none", active && "text-foreground")}>
              {opt.label}
            </p>
            <p className="text-xs leading-snug text-subtle-foreground">{opt.description}</p>
          </button>
        );
      })}
    </div>
  );
}

// ── Default preferences ──────────────────────────────────────────────────────

function createDefault(): AppPreferences {
  return {
    defaultPlatform: "bilibili",
    resumeLastSession: true,
    appearance: "system",
    proxy: "none",
  };
}

// ── Appearance selector ──────────────────────────────────────────────────────

const APPEARANCE_OPTIONS: {
  value: ThemeMode;
  label: string;
  icon: React.ElementType;
}[] = [
  { value: "system", label: "跟随系统", icon: Monitor },
  { value: "light", label: "亮色", icon: Sun },
  { value: "dark", label: "暗色", icon: Moon },
];

function AppearanceSelector({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (v: ThemeMode) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 p-1">
      {APPEARANCE_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-sm p-3 transition-all duration-150 cursor-pointer",
              "border",
              active
                ? "border-primary-border bg-accent text-accent-foreground"
                : "border-border bg-transparent text-muted-foreground hover:bg-secondary-hover hover:text-foreground",
            )}
          >
            <Icon
              size={16}
              strokeWidth={1.8}
              className={active ? "text-accent-foreground" : "text-muted-foreground"}
            />
            <p className={cn("text-xs font-medium leading-none", active && "text-foreground")}>
              {opt.label}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ── SettingsPage ─────────────────────────────────────────────────────────────

export function SettingsPage() {
  const [prefs, setPrefs] = useState<AppPreferences>(createDefault);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const danmakuOpacity = useDanmakuStore((s) => s.opacity);
  const danmakuFontSize = useDanmakuStore((s) => s.fontSize);
  const setDanmakuOpacity = useDanmakuStore((s) => s.setOpacity);
  const setDanmakuFontSize = useDanmakuStore((s) => s.setFontSize);

  // Keep the appearance field in sync with the theme store so the header
  // toggle reflects here without a save.
  useEffect(() => {
    return useThemeStore.subscribe((state, prevState) => {
      if (state.mode !== prevState.mode) {
        setPrefs((p) => ({ ...p, appearance: state.mode }));
      }
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadPreferences()
      .then((v) => {
        if (mounted) setPrefs(v);
      })
      .catch(() => {
        if (mounted) setError(true);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) return <StatusView title="加载中" tone="loading" />;
  if (error) return <StatusView title="读取失败" tone="error" />;

  const onSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(false);
    try {
      const result = await savePreferences(prefs);
      setPrefs(result);
      // Sync theme store with saved appearance
      useThemeStore.getState().syncFromPreference(result.appearance as ThemeMode);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full h-full flex justify-center">
      <section className="page-stack">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Settings2 size={16} strokeWidth={1.8} className="text-muted-foreground" />
            <h1 className="text-base font-semibold tracking-tight">设置</h1>
          </div>

          {/* Save action — top right */}
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground animate-in fade-in-0 duration-150">
                <Check size={12} strokeWidth={2.4} />
                已保存
              </span>
            )}
            {saveError && <span className="text-xs text-destructive">保存失败，请重试</span>}
            <Button onClick={onSave} disabled={saving} size="sm" className="h-7 text-xs px-3">
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>

        <div>
          <SectionLabel icon={MessageSquare} label="弹幕" />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <Row label="不透明度" description={`${Math.round(danmakuOpacity * 100)}%`}>
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={danmakuOpacity}
                onChange={(e) => setDanmakuOpacity(Number(e.target.value))}
                aria-label="弹幕不透明度"
                className="w-32"
              />
            </Row>
            <Row label="字号" last>
              <ToggleGroup
                type="single"
                value={danmakuFontSize}
                onValueChange={(v) => {
                  if (v === "small" || v === "medium" || v === "large") setDanmakuFontSize(v);
                }}
              >
                <ToggleGroupItem value="small">小</ToggleGroupItem>
                <ToggleGroupItem value="medium">中</ToggleGroupItem>
                <ToggleGroupItem value="large">大</ToggleGroupItem>
              </ToggleGroup>
            </Row>
          </div>
        </div>

        <div>
          <SectionLabel icon={Tv2} label="观看偏好" />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <Row label="默认平台" description="启动时默认浏览的平台">
              <ToggleGroup
                type="single"
                value={prefs.defaultPlatform}
                onValueChange={(v) => {
                  if (v) setPrefs((p) => ({ ...p, defaultPlatform: v as PlatformId }));
                }}
              >
                <ToggleGroupItem value="bilibili" className="text-xs h-7 px-3">
                  Bilibili
                </ToggleGroupItem>
                <ToggleGroupItem value="douyu" className="text-xs h-7 px-3">
                  斗鱼
                </ToggleGroupItem>
                <ToggleGroupItem value="huya" className="text-xs h-7 px-3">
                  虎牙
                </ToggleGroupItem>
              </ToggleGroup>
            </Row>

            <Row label="恢复上次浏览" description="启动时显示继续上次观看的提示">
              <Switch
                checked={prefs.resumeLastSession}
                onToggle={() =>
                  setPrefs((p) => ({ ...p, resumeLastSession: !p.resumeLastSession }))
                }
              />
            </Row>

            <Row label="回放自动连播" description="一段录像结束后自动播放下一段" last>
              <Switch
                checked={prefs.autoPlayNextReplay ?? true}
                onToggle={() =>
                  setPrefs((p) => ({
                    ...p,
                    autoPlayNextReplay: !(p.autoPlayNextReplay ?? true),
                  }))
                }
              />
            </Row>
          </div>
        </div>

        <div>
          <SectionLabel icon={Paintbrush} label="外观" />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 pt-4 pb-1">
              <p className="text-sm font-medium leading-none">主题模式</p>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">
                选择亮色、暗色或跟随系统设置，立即生效。
              </p>
            </div>
            <AppearanceSelector
              value={prefs.appearance as ThemeMode}
              onChange={(v: ThemeMode) => {
                setPrefs((p) => ({ ...p, appearance: v }));
                // Live-apply so the header toggle reflects immediately.
                useThemeStore.getState().setMode(v);
              }}
            />
          </div>
        </div>

        <div>
          <SectionLabel icon={Monitor} label="网络" />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 pt-4 pb-1">
              <p className="text-sm font-medium leading-none">代理设置</p>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">
                影响直播封面、搜索等所有后台请求。切换后立即生效，无需重启。
              </p>
            </div>
            <ProxySelector
              value={prefs.proxy}
              onChange={(v) => setPrefs((p) => ({ ...p, proxy: v }))}
            />
          </div>
        </div>

        <div>
          <SectionLabel icon={Film} label="平台能力说明" />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 py-4">
              <p className="text-sm font-medium leading-none">直播回放</p>
              <p className="mt-2 text-xs text-muted-foreground leading-snug">
                斗鱼支持全量录像；Bilibili
                官方接口不面向普通观众，暂不支持；虎牙公开视频与直播回放不同，暂不支持。
              </p>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between text-xs text-subtle-foreground">
          <div className="space-y-1">
            <p>Streaming · v{__APP_VERSION__}</p>
            <p>支持 Bilibili · 斗鱼 · 虎牙</p>
          </div>
          <div className="text-right space-y-1 text-xs">
            <p>Tauri 2 · React 19</p>
            <p>MIT License</p>
          </div>
        </div>
      </section>
    </div>
  );
}
