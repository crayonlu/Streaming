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
    // Radius is 0: Fluent 2's rule that a component flush against the screen
    // edge gets no corner radius, which also matches the native feel of
    // Windows 11 title-bar buttons.
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
                // The sidebar sits on --background (97% light / 15% dark) and
                // neither step is deep enough, so hover uses surface-hover
                // rather than muted (muted is only 1.15:1 against 97% in the
                // light theme — effectively no feedback).
                // Active uses solid primary, matching the active language of
                // the category chips and avoiding the inverted hierarchy where
                // hover reads darker than active.
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
 * Page width tiers — one-to-one with globals.css's --container-*.
 * Centering and the upper bound are both owned by the single layer inside
 * <main>, so pages no longer each declare their own max-w.
 *   settings      → narrow   720   single-column form, narrowed to reading width
 *   player/replay → stage   1800   video-first, wider but still capped
 *   everything else → grid  1440   card grid (discover / search / follows)
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
            // 80px rather than 78px: aligns to the 4px grid.
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
          {/* The top-left corner is the content panel's only inner corner: the
              other three sit flush against the window edge and are handled by
              the window's own radius. The panel is one step lighter than the
              skeleton layer (--background), so the seam needs a radius or it
              reads as an uncut square. */}
          <main className="min-h-0 flex-1 overflow-y-auto bg-card rounded-tl-md">
            {/* Content centering: the width cap is owned here, so pages no
                longer each declare their own.
                h-full gives .page-stack's height:100% a definite basis to
                resolve against.
                ⚠️ This layer is transparent (no bg), so the radius must live
                on <main>; putting rounded-* here has no visual effect. */}
            <div className={cn("mx-auto h-full w-full px-8 py-6", widthTier)}>
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
