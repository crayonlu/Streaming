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
import { type Dict, type LanguagePreference, useI18nStore, useStrings } from "@/shared/i18n";
import { platformLabel } from "@/shared/lib/platform";
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
  icon: React.ElementType;
}[] = [
  {
    value: "none",
    icon: Network,
  },
  {
    value: "system",
    icon: Globe,
  },
];

function proxyCopy(s: Dict, value: ProxyMode) {
  return value === "none"
    ? { label: s.settings.proxyNone, description: s.settings.proxyNoneHint }
    : { label: s.settings.proxySystem, description: s.settings.proxySystemHint };
}

function ProxySelector({
  value,
  onChange,
}: {
  value: ProxyMode;
  onChange: (v: ProxyMode) => void;
}) {
  const s = useStrings();
  return (
    <div className="grid grid-cols-2 gap-2 p-1">
      {PROXY_OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const active = value === opt.value;
        const { label, description } = proxyCopy(s, opt.value);
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
              {label}
            </p>
            <p className="text-xs leading-snug text-subtle-foreground">{description}</p>
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
  icon: React.ElementType;
}[] = [
  { value: "system", icon: Monitor },
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
];

function appearanceLabel(s: Dict, value: ThemeMode): string {
  if (value === "system") return s.theme.system;
  if (value === "light") return s.theme.lightOption;
  return s.theme.darkOption;
}

function AppearanceSelector({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (v: ThemeMode) => void;
}) {
  const s = useStrings();
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
              {appearanceLabel(s, opt.value)}
            </p>
          </button>
        );
      })}
    </div>
  );
}

const LANGUAGE_OPTIONS: LanguagePreference[] = ["system", "zh", "en"];

function languageLabel(s: Dict, value: LanguagePreference): string {
  if (value === "system") return s.language.system;
  if (value === "zh") return s.language.zh;
  return s.language.en;
}

function LanguageSelector({
  value,
  onChange,
}: {
  value: LanguagePreference;
  onChange: (v: LanguagePreference) => void;
}) {
  const s = useStrings();
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        if (v === "system" || v === "zh" || v === "en") onChange(v);
      }}
    >
      {LANGUAGE_OPTIONS.map((option) => (
        <ToggleGroupItem key={option} value={option} className="text-xs h-7 px-3">
          {languageLabel(s, option)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ── SettingsPage ─────────────────────────────────────────────────────────────

export function SettingsPage() {
  const s = useStrings();
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

  if (loading) return <StatusView title={s.common.loading} tone="loading" />;
  if (error) return <StatusView title={s.common.readFailed} tone="error" />;

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
            <h1 className="text-base font-semibold tracking-tight">{s.settings.title}</h1>
          </div>

          {/* Save action — top right */}
          <div className="flex items-center gap-2">
            {saved && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground animate-in fade-in-0 duration-150">
                <Check size={12} strokeWidth={2.4} />
                {s.common.saved}
              </span>
            )}
            {saveError && <span className="text-xs text-destructive">{s.common.saveFailed}</span>}
            <Button onClick={onSave} disabled={saving} size="sm" className="h-7 text-xs px-3">
              {saving ? s.common.saving : s.common.save}
            </Button>
          </div>
        </div>

        <div>
          <SectionLabel icon={MessageSquare} label={s.danmaku.section} />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <Row
              label={s.danmaku.opacity}
              description={`${Math.round(danmakuOpacity * 100)}%`}
            >
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.05}
                value={danmakuOpacity}
                onChange={(e) => setDanmakuOpacity(Number(e.target.value))}
                aria-label={s.danmaku.opacityLabel}
                className="w-32"
              />
            </Row>
            <Row label={s.danmaku.fontSize} last>
              <ToggleGroup
                type="single"
                value={danmakuFontSize}
                onValueChange={(v) => {
                  if (v === "small" || v === "medium" || v === "large") setDanmakuFontSize(v);
                }}
              >
                <ToggleGroupItem value="small">{s.danmaku.sizeSmall}</ToggleGroupItem>
                <ToggleGroupItem value="medium">{s.danmaku.sizeMedium}</ToggleGroupItem>
                <ToggleGroupItem value="large">{s.danmaku.sizeLarge}</ToggleGroupItem>
              </ToggleGroup>
            </Row>
          </div>
        </div>

        <div>
          <SectionLabel icon={Tv2} label={s.settings.viewing} />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <Row label={s.settings.defaultPlatform} description={s.settings.defaultPlatformHint}>
              <ToggleGroup
                type="single"
                value={prefs.defaultPlatform}
                onValueChange={(v) => {
                  if (v) setPrefs((p) => ({ ...p, defaultPlatform: v as PlatformId }));
                }}
              >
                <ToggleGroupItem value="bilibili" className="text-xs h-7 px-3">
                  {platformLabel("bilibili")}
                </ToggleGroupItem>
                <ToggleGroupItem value="douyu" className="text-xs h-7 px-3">
                  {platformLabel("douyu")}
                </ToggleGroupItem>
                <ToggleGroupItem value="huya" className="text-xs h-7 px-3">
                  {platformLabel("huya")}
                </ToggleGroupItem>
              </ToggleGroup>
            </Row>

            <Row
              label={s.settings.resumeLastSession}
              description={s.settings.resumeLastSessionHint}
            >
              <Switch
                checked={prefs.resumeLastSession}
                onToggle={() =>
                  setPrefs((p) => ({ ...p, resumeLastSession: !p.resumeLastSession }))
                }
              />
            </Row>

            <Row
              label={s.settings.autoPlayNextReplay}
              description={s.settings.autoPlayNextReplayHint}
              last
            >
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
          <SectionLabel icon={Paintbrush} label={s.settings.appearance} />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 pt-4 pb-1">
              <p className="text-sm font-medium leading-none">{s.theme.mode}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">{s.theme.modeHint}</p>
            </div>
            <AppearanceSelector
              value={prefs.appearance as ThemeMode}
              onChange={(v: ThemeMode) => {
                setPrefs((p) => ({ ...p, appearance: v }));
                // Live-apply so the header toggle reflects immediately.
                useThemeStore.getState().setMode(v);
              }}
            />
            <Row label={s.language.label} description={s.language.hint} last>
              <LanguageSelector
                value={prefs.language ?? "system"}
                onChange={(v) => {
                  setPrefs((p) => ({ ...p, language: v }));
                  // Live-apply, like the theme selector above.
                  useI18nStore.getState().setPreference(v);
                }}
              />
            </Row>
          </div>
        </div>

        <div>
          <SectionLabel icon={Monitor} label={s.settings.network} />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 pt-4 pb-1">
              <p className="text-sm font-medium leading-none">{s.settings.proxy}</p>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">
                {s.settings.proxyHint}
              </p>
            </div>
            <ProxySelector
              value={prefs.proxy}
              onChange={(v) => setPrefs((p) => ({ ...p, proxy: v }))}
            />
          </div>
        </div>

        <div>
          <SectionLabel icon={Film} label={s.settings.capabilities} />
          <div className="rounded-md bg-card ring-1 ring-border overflow-hidden">
            <div className="px-4 py-4">
              <p className="text-sm font-medium leading-none">{s.settings.replayCapability}</p>
              <p className="mt-2 text-xs text-muted-foreground leading-snug">
                {s.settings.replayCapabilityHint}
              </p>
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex items-center justify-between text-xs text-subtle-foreground">
          <div className="space-y-1">
            <p>Streaming · v{__APP_VERSION__}</p>
            <p>{s.settings.supported}</p>
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
