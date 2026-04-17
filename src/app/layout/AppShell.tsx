import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Compass,
  Heart,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Radio,
  Search,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import streamingLogo from "@/assets/Streaming.svg";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { GlobalSearch } from "@/features/global-search/ui/GlobalSearch";
import { usePlatformStore } from "@/features/platform-switch/model/usePlatformStore";
import { useThemeStore } from "@/features/theme/model/useThemeStore";
import { cn } from "@/lib/utils";
import { loadPreferences } from "@/shared/api/commands";

// ── Window controls ───────────────────────────────────────────────────────────

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();

    // Read initial state
    void win
      .isMaximized()
      .then(setMaximized)
      .catch(() => undefined);

    // Keep in sync when the user resizes / maximises from OS keyboard shortcuts
    let unlisten: (() => void) | undefined;
    void win
      .listen("tauri://resize", async () => {
        setMaximized(await win.isMaximized().catch(() => false));
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => undefined);

    return () => {
      unlisten?.();
    };
  }, []);

  const minimize = () =>
    void getCurrentWindow()
      .minimize()
      .catch(() => undefined);
  const toggleMax = () =>
    void (maximized ? getCurrentWindow().unmaximize() : getCurrentWindow().maximize()).catch(
      () => undefined,
    );
  const close = () =>
    void getCurrentWindow()
      .close()
      .catch(() => undefined);

  return (
    // Windows-style control buttons at the far right of the title bar.
    // Note: no stopPropagation needed; interactive elements inside
    // data-tauri-drag-region are still clickable by default.
    <div className="ml-3 flex h-full items-stretch">
      {/* Minimize */}
      <button
        type="button"
        onClick={minimize}
        aria-label="最小化"
        className="flex border-0 h-full w-11 items-center p-2 rounded-sm justify-center text-muted-foreground/70 transition-colors hover:bg-foreground/8 hover:text-foreground active:bg-foreground/14"
      >
        <Minus size={12} strokeWidth={1.8} />
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        onClick={toggleMax}
        aria-label={maximized ? "还原" : "最大化"}
        className="flex border-0 h-full w-11 items-center p-2 rounded-sm justify-center text-muted-foreground/70 transition-colors hover:bg-foreground/8 hover:text-foreground active:bg-foreground/14"
      >
        {maximized ? (
          <Minimize2 size={11} strokeWidth={1.8} />
        ) : (
          <Maximize2 size={11} strokeWidth={1.8} />
        )}
      </button>

      {/* Close — red hover, Windows 11 convention */}
      <button
        type="button"
        onClick={close}
        aria-label="关闭"
        className={cn(
          "flex h-full border-0 w-11 items-center p-2 rounded-sm justify-center transition-colors",
          "text-muted-foreground/70",
          "hover:bg-[#c42b1c] hover:text-white",
          "active:bg-[#b0261a] active:text-white",
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
                "flex h-9 w-9 items-center justify-center rounded-lg cursor-pointer",
                "transition-colors duration-150",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-background hover:text-foreground",
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
            "relative flex h-7 w-7 items-center justify-center rounded-md",
            "text-muted-foreground/70 transition-colors duration-150",
            "hover:bg-foreground/8 hover:text-foreground",
          )}
        >
          {/* Sun — visible in dark mode */}
          <Sun
            size={14}
            strokeWidth={1.9}
            className={cn(
              "absolute transition-all duration-300",
              isDark ? "opacity-100 rotate-0 scale-100" : "opacity-0 -rotate-90 scale-75",
            )}
          />
          {/* Moon — visible in light mode */}
          <Moon
            size={13}
            strokeWidth={1.9}
            className={cn(
              "absolute transition-all duration-300",
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

export function AppShell() {
  const location = useLocation();
  const hydratePlatform = usePlatformStore((s) => s.hydratePlatform);
  const initTheme = useThemeStore((s) => s.init);
  const isPlayer = location.pathname.startsWith("/player/");

  // Init theme before first paint
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    let ok = true;
    void loadPreferences()
      .then((p) => {
        if (ok) hydratePlatform(p.defaultPlatform);
      })
      .catch(() => undefined);
    return () => {
      ok = false;
    };
  }, [hydratePlatform]);

  return (
    <TooltipProvider delayDuration={500}>
      <div className="flex h-screen overflow-hidden">
        {/* ─── Sidebar ───────────────────────────────────────────── */}
        <aside className="flex w-14 shrink-0 flex-col items-center gap-1 bg-card border-r border-border/70 py-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8 text-primary cursor-default select-none">
                <Radio size={14} strokeWidth={2} />
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

          <div className="w-6 border-t border-border/60 mb-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <NavLink to="/settings" end className="block">
                {({ isActive }) => (
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg cursor-pointer",
                      "transition-colors duration-150",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-background hover:text-foreground",
                    )}
                  >
                    <Settings size={15} strokeWidth={1.8} />
                  </span>
                )}
              </NavLink>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              设置
            </TooltipContent>
          </Tooltip>
        </aside>

        {/* ─── Right column ─────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* ─── Title bar / Topbar ─────────────────────────────────
              data-tauri-drag-region makes the whole bar draggable.
              Interactive children (search, window buttons) still work.
          ─────────────────────────────────────────────────────────── */}
          <header className="flex h-12 shrink-0 items-center bg-card border-b border-border/70 select-none">
            {/* Dedicated draggable strip: keeps drag behavior reliable on Windows */}
            <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center px-4">
              <img
                src={streamingLogo}
                alt="Streaming"
                className="h-3.5 w-auto select-none pointer-events-none"
                draggable={false}
              />
            </div>

            {/* Interactive area should not be a drag region */}
            <div className="flex items-center gap-2 pr-1">
              <ThemeToggle />
              <GlobalSearch />
              <WindowControls />
            </div>
          </header>

          {/* Content */}
          <main
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              isPlayer ? "bg-card px-8 py-6" : "bg-card px-8 py-5",
            )}
          >
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
