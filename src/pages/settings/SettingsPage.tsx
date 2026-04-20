import {
  Check,
  Film,
  Globe,
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
import { type ThemeMode, useThemeStore } from "@/features/theme/model/useThemeStore";
import { cn } from "@/lib/utils";
import { loadPreferences, savePreferences } from "@/shared/api/commands";
import type { AppPreferences, PlatformId, ProxyMode } from "@/shared/types/domain";
import { StatusView } from "@/shared/ui/StatusView";

// ── Tiny sub-components ──────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <div className="flex items-center gap-1.5 mb-1.5">
      <Icon size={12} strokeWidth={1.8} className="text-muted-foreground/60" />
      <p className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">
        {label}
      </p>
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
        "flex items-center justify-between gap-6 px-4 py-3.5",
        !last && "border-b border-border/60",
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium leading-none">{label}</p>
        {description && (
          <p className="mt-1 text-[11px] text-muted-foreground leading-snug">{description}</p>
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
        "transition-colors duration-200",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm",
          "transition-transform duration-200",
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
              "flex flex-col gap-1.5 rounded-md p-3 text-left transition-all duration-150 cursor-pointer",
              "border",
              active
                ? "border-primary/40 bg-accent/60 text-accent-foreground"
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <div className="flex items-center justify-between gap-1">
              <Icon
                size={13}
                strokeWidth={1.8}
                className={active ? "text-primary" : "text-muted-foreground/70"}
              />
              {active && <Check size={11} strokeWidth={2.4} className="text-primary" />}
            </div>
            <p className={cn("text-[12px] font-medium leading-none", active && "text-foreground")}>
              {opt.label}
            </p>
            <p className="text-[10.5px] leading-snug opacity-70">{opt.description}</p>
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
              "flex flex-col items-center gap-1.5 rounded-md p-3 transition-all duration-150 cursor-pointer",
              "border",
              active
                ? "border-primary/40 bg-accent/60 text-accent-foreground"
                : "border-border/60 bg-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <Icon
              size={16}
              strokeWidth={1.8}
              className={active ? "text-primary" : "text-muted-foreground/70"}
            />
            <p className={cn("text-[11px] font-medium leading-none", active && "text-foreground")}>
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
    try {
      const result = await savePreferences(prefs);
      setPrefs(result);
      // Sync theme store with saved appearance
      useThemeStore.getState().syncFromPreference(result.appearance as ThemeMode);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full h-full flex justify-center">
      <section className="page-stack max-w-2xl">
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Settings2 size={16} strokeWidth={1.8} className="text-muted-foreground/70" />
            <h1 className="text-base font-semibold tracking-tight">设置</h1>
          </div>

          {/* Save action — top right */}
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground animate-in fade-in-0 duration-200">
                <Check size={11} strokeWidth={2.4} />
                已保存
              </span>
            )}
            <Button onClick={onSave} disabled={saving} size="sm" className="h-7 text-xs px-3">
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>

        <div>
          <SectionLabel icon={Tv2} label="观看偏好" />
          <div className="rounded-lg bg-card ring-1 ring-border/40 overflow-hidden">
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

            <Row label="恢复上次浏览" description="启动时显示继续上次观看的提示" last>
              <Switch
                checked={prefs.resumeLastSession}
                onToggle={() =>
                  setPrefs((p) => ({ ...p, resumeLastSession: !p.resumeLastSession }))
                }
              />
            </Row>
          </div>
        </div>

        <div>
          <SectionLabel icon={Paintbrush} label="外观" />
          <div className="rounded-lg bg-card ring-1 ring-border/40 overflow-hidden">
            <div className="px-4 pt-3.5 pb-1">
              <p className="text-sm font-medium leading-none">主题模式</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                选择亮色、暗色或跟随系统设置。保存后生效。
              </p>
            </div>
            <AppearanceSelector
              value={prefs.appearance as ThemeMode}
              onChange={(v: ThemeMode) => setPrefs((p) => ({ ...p, appearance: v }))}
            />
          </div>
        </div>

        <div>
          <SectionLabel icon={Monitor} label="网络" />
          <div className="rounded-lg bg-card ring-1 ring-border/40 overflow-hidden">
            <div className="px-4 pt-3.5 pb-1">
              <p className="text-sm font-medium leading-none">代理设置</p>
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
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
          <div className="rounded-lg bg-card ring-1 ring-border/40 overflow-hidden">
            <div className="px-4 py-3.5">
              <p className="text-sm font-medium leading-none">直播回放</p>
              <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug">
                斗鱼支持全量录像；Bilibili
                官方接口不面向普通观众，暂不支持；虎牙公开视频与直播回放不同，暂不支持。
              </p>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between text-[11px] text-muted-foreground/55">
          <div className="space-y-0.5">
            <p>Streaming · v{__APP_VERSION__}</p>
            <p>支持 Bilibili · 斗鱼 · 虎牙</p>
          </div>
          <div className="text-right space-y-0.5 text-[10px]">
            <p>Tauri 2 · React 19</p>
            <p>MIT License</p>
          </div>
        </div>
      </section>
    </div>
  );
}
