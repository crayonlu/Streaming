import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Compass,
  Heart,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GlobalSearch } from "@/features/global-search/ui/GlobalSearch";
import { OnboardingOverlay } from "@/features/onboarding/ui/OnboardingOverlay";
import { usePlatformStore } from "@/features/platform-switch/model/usePlatformStore";
import { type ThemeMode, useThemeStore } from "@/features/theme/model/useThemeStore";
import { cn } from "@/lib/utils";
import { loadPreferences, savePreferences } from "@/shared/api/commands";
import { isMac } from "@/shared/lib/os";
import type { PlatformId } from "@/shared/types/domain";
import appIcon from "../../../assets/app-icon.png";

// ── Window controls ───────────────────────────────────────────────────────────

function WindowControls() {
  const [fullscreen, setFullscreenState] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();

    void win
      .isFullscreen()
      .then(setFullscreenState)
      .catch(() => undefined);

    const listenPromise = win
      .listen("tauri://resize", async () => {
        const fs = await win.isFullscreen().catch(() => false);
        console.log("[win] resize event, isFullscreen =", fs);
        setFullscreenState(fs);
      })
      .catch(() => undefined);

    return () => {
      void listenPromise.then((fn) => fn?.());
    };
  }, []);

  const minimize = () =>
    void getCurrentWindow()
      .minimize()
      .catch(() => undefined);
  const toggleFullscreen = async () => {
    const win = getCurrentWindow();
    console.log("[win] toggleFullscreen clicked, fullscreen =", fullscreen);
    try {
      await win.setFullscreen(!fullscreen);
    } catch (e) {
      console.warn("[win] setFullscreen failed", e);
    }
  };
  const close = () =>
    void getCurrentWindow()
      .close()
      .catch(() => undefined);

  return (
    // Windows-style control buttons at the far right of the title bar.
    // Note: no stopPropagation needed; interactive elements inside
    // data-tauri-drag-region are still clickable by default.
    // 圆角为 0：Fluent 2 规则「贴屏幕边缘的组件不做圆角」，
    // 也与 Windows 11 标题栏按钮的原生观感一致。
    <div className="ml-3 flex h-full items-stretch">
      {/* Minimize */}
      <button
        type="button"
        onClick={minimize}
        aria-label="最小化"
        className="flex border-0 h-full w-11 items-center p-2 rounded-none justify-center text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground active:bg-surface-active"
      >
        <Minus size={12} strokeWidth={1.8} />
      </button>

      {/* Fullscreen toggle — native OS fullscreen (new Space on macOS) */}
      <button
        type="button"
        onClick={toggleFullscreen}
        aria-label={fullscreen ? "退出全屏" : "全屏"}
        className="flex border-0 h-full w-11 items-center p-2 rounded-none justify-center text-muted-foreground transition-colors duration-150 hover:bg-surface-hover hover:text-foreground active:bg-surface-active"
      >
        {fullscreen ? (
          <Minimize2 size={12} strokeWidth={1.8} />
        ) : (
          <Maximize2 size={12} strokeWidth={1.8} />
        )}
      </button>

      {/* Close — red hover, Windows 11 convention */}
      <button
        type="button"
        onClick={close}
        aria-label="关闭"
        className={cn(
          "flex h-full border-0 w-11 items-center p-2 rounded-none justify-center transition-colors duration-150",
          "text-muted-foreground",
          "hover:bg-close-hover hover:text-close-foreground",
          "active:bg-close-active active:text-close-foreground",
        )}
      >
        <X size={12} strokeWidth={1.8} />
      </button>
    </div>
  );
}

// ── Nav ───────────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { to: "/", label: "发现", icon: Compass, end: true },
  { to: "/search", label: "搜索", icon: Search, end: false },
  { to: "/follows", label: "关注", icon: Heart, end: false },
];

function NavItem({ to, label, icon: Icon, end }: (typeof NAV_ITEMS)[0]) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <NavLink to={to} end={end} className="block">
          {({ isActive }) => (
            <span
              className={cn(
                // 侧栏底色是 --background(97% 亮 / 15% 暗)，两档都不够深，
                // 所以 hover 走 surface-hover 而不是 muted（muted 在亮色下
                // 对 97% 只有 1.15:1，等于没有反馈）。
                // active 用实色 primary —— 与分类 chip 的 active 语言一致，
                // 也避开了「hover 比 active 还深」的层级倒挂。
                "flex h-9 w-9 items-center justify-center rounded-xs cursor-pointer",
                "transition-colors duration-150",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
              )}
            >
              <Icon size={16} strokeWidth={isActive ? 2.2 : 1.8} />
            </span>
          )}
        </NavLink>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ── AppShell ─────────────────────────────────────────────────────────────────

// ── ThemeToggle ───────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { theme, toggle } = useThemeStore();
  const isDark = theme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={toggle}
          aria-label={isDark ? "切换为亮色模式" : "切换为暗色模式"}
          className={cn(
            "relative flex h-7 w-7 items-center justify-center rounded-xs",
            "text-muted-foreground transition-colors duration-150",
            "hover:bg-surface-hover hover:text-foreground",
          )}
        >
          {/* Sun — visible in dark mode */}
          <Sun
            size={14}
            strokeWidth={1.9}
            className={cn(
              "absolute transition-all duration-250",
              isDark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-75",
            )}
          />
          {/* Moon — visible in light mode */}
          <Moon
            size={14}
            strokeWidth={1.9}
            className={cn(
              "absolute transition-all duration-250",
              isDark ? "opacity-0 rotate-90 scale-75" : "opacity-100 rotate-0 scale-100",
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isDark ? "亮色模式" : "暗色模式"}
      </TooltipContent>
    </Tooltip>
  );
}

// ── AppShell ─────────────────────────────────────────────────────────────────

/**
 * 页面宽度分档 —— 与 globals.css 的 --container-* 一一对应。
 * 居中与上限统一由 <main> 里那一层承担，页面自身不再各写一套 max-w。
 *   设置       → narrow  720   单列表单，收窄到阅读宽度
 *   播放 / 回放 → stage  1800  视频优先，放宽但仍设上限
 *   其余        → grid   1440  卡片网格（发现 / 搜索 / 关注）
 */
const WIDTH_TIERS: ReadonlyArray<readonly [prefix: string, className: string]> = [
  ["/settings", "max-w-narrow"],
  ["/player/", "max-w-stage"],
  ["/replay", "max-w-stage"],
];

function resolveWidthTier(pathname: string): string {
  return WIDTH_TIERS.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "max-w-grid";
}

export function AppShell() {
  const location = useLocation();
  const hydratePlatform = usePlatformStore((s) => s.hydratePlatform);
  const syncTheme = useThemeStore((s) => s.syncFromPreference);
  const widthTier = resolveWidthTier(location.pathname);
  // null = not yet determined (loading); false = show onboarding; true = done
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);

  // Hydrate platform + theme from saved preferences, and check onboarding state
  useEffect(() => {
    let ok = true;
    void loadPreferences()
      .then((p) => {
        if (!ok) return;
        hydratePlatform(p.defaultPlatform);
        syncTheme(p.appearance as ThemeMode);
        setOnboardingDone(p.onboardingDone === true);
      })
      .catch(() => {
        if (!ok) return;
        // Treat preference load failure as onboarding not done — show overlay.
        setOnboardingDone(false);
      });
    return () => {
      ok = false;
    };
  }, [hydratePlatform, syncTheme]);

  const handleOnboardingDone = useCallback(
    (platform: PlatformId) => {
      hydratePlatform(platform);
      setOnboardingDone(true);
    },
    [hydratePlatform],
  );

  // Persist appearance mode back to AppPreferences whenever it changes
  // (header toggle or Settings selector). Persists `mode`, not the resolved
  // theme, so "system" is preserved.
  useEffect(() => {
    return useThemeStore.subscribe((state, prevState) => {
      if (state.mode !== prevState.mode) {
        void loadPreferences()
          .then((p) => savePreferences({ ...p, appearance: state.mode }))
          .catch(() => undefined);
      }
    });
  }, []);

  return (
    <TooltipProvider delayDuration={500}>
      {/* First-run onboarding: shown once, overlaid on top of the shell */}
      {onboardingDone === false && <OnboardingOverlay onDone={handleOnboardingDone} />}
      <div className="flex h-screen flex-col overflow-hidden">
        {/* ─── Top bar (full width) ───────────────────────────────
            Spans the whole window so macOS traffic lights sit in its left
            gutter and no sidebar/header border crosses under them.
            骨架层用 --background(15%)，比内容区 --card(20%) 深一档：
            亮度差本身就是分界，不再需要分隔边框（Linear 的做法）。 */}
        <header
          className={cn(
            "flex h-14 shrink-0 items-center bg-background select-none",
            // macOS: reserve the traffic-light gutter on the left; Windows
            // keeps controls on the right with a small right pad.
            // 80px 而非 78px：对齐 4px 网格。
            isMac ? "pl-20 pr-4" : "pr-1",
          )}
        >
          {/* Draggable strip (keeps drag reliable on Windows) */}
          <div data-tauri-drag-region className="flex min-w-0 flex-1 h-full"></div>

          {/* Interactive area — not a drag region */}
          <div className="flex items-center gap-2 pr-1">
            <ThemeToggle />
            <GlobalSearch />
            {/* Windows/Linux show custom window controls; macOS uses native traffic lights */}
            {!isMac && <WindowControls />}
          </div>
        </header>

        {/* ─── Sidebar + content row ───────────────────────────── */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ─── Sidebar ───────────────────────────────────────────── */}
          <aside className="flex w-14 shrink-0 flex-col items-center gap-1 bg-background py-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-xs bg-accent text-accent-foreground cursor-default select-none">
                  <img
                    src={appIcon}
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full rounded-xs object-cover"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Streaming
              </TooltipContent>
            </Tooltip>

            <nav className="flex flex-1 flex-col items-center gap-1" aria-label="主导航">
              {NAV_ITEMS.map((item) => (
                <NavItem key={item.to} {...item} />
              ))}
            </nav>

            <div className="w-6 border-t border-border mb-1" />

            <Tooltip>
              <TooltipTrigger asChild>
                <NavLink to="/settings" end className="block">
                  {({ isActive }) => (
                    <span
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xs cursor-pointer",
                        "transition-colors duration-150",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                      )}
                    >
                      <Settings size={16} strokeWidth={1.8} />
                    </span>
                  )}
                </NavLink>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                设置
              </TooltipContent>
            </Tooltip>
          </aside>

          {/* ─── Content ──────────────────────────────────────────── */}
          {/* 左上角是内容面板唯一的内角：另外三个角都贴在窗口边缘，由窗口自身的
              圆角负责。面板比骨架层（--background）亮一档，两者相接处需要一个圆角
              才不会读成「忘记切的方块」。 */}
          <main className="min-h-0 flex-1 overflow-y-auto bg-card rounded-tl-md">
            {/* 内容居中：宽度上限统一由这里承担，页面自身不再各写一套。
                  h-full 是为了让 .page-stack 的 height:100% 有确定的解析基准。
                  ⚠️ 这一层是透明的（没有 bg），所以圆角必须加在 main 上；
                  给这层加 rounded 不会有任何视觉效果。 */}
            <div className={cn("mx-auto h-full w-full px-8 py-6", widthTier)}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
