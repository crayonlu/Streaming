/**
 * Theme store — single source of truth for appearance.
 *
 * Tracks both `mode` ("system" | "light" | "dark", what the user chose) and
 * `theme` (resolved "light" | "dark" applied to DOM). AppPreferences.appearance
 * mirrors `mode`; SettingsPage and the header toggle both read/write the store
 * so they stay in sync without duplicated storage.
 */
import { create } from "zustand";

export type Theme = "light" | "dark";
export type ThemeMode = "system" | "light" | "dark";

const TRANSITION_MS = 280;

function osPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(mode: ThemeMode): Theme {
  if (mode === "system") return osPrefersDark() ? "dark" : "light";
  return mode;
}

function applyTheme(theme: Theme, mode?: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Non-authoritative cache for the inline FOUC script in index.html.
  try {
    localStorage.setItem("streaming_theme_cache", mode ?? theme);
  } catch {
    // localStorage may throw in private mode — non-critical
  }
}

interface ThemeState {
  /** What the user chose. */
  mode: ThemeMode;
  /** Resolved theme applied to DOM. */
  theme: Theme;
  /** Quick toggle — flips light ↔ dark and pins mode to the result. */
  toggle: () => void;
  /** Set mode (from Settings selector or loaded preferences). */
  setMode: (mode: ThemeMode) => void;
  /** Legacy alias kept for AppShell startup hydration. */
  syncFromPreference: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  theme: "light",

  setMode(mode) {
    const theme = resolve(mode);
    applyTheme(theme, mode);
    set({ mode, theme });
  },

  // biome-ignore lint/suspicious/noConsole: debug
  syncFromPreference(mode) {
    get().setMode(mode);
  },

  toggle() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    switchTheme(() => {
      // An explicit toggle pins the mode (no longer "system").
      applyTheme(next, next);
      set({ mode: next, theme: next });
    });
  },
}));

function switchTheme(apply: () => void) {
  if (typeof document.startViewTransition === "function") {
    void document.startViewTransition(() => apply());
    return;
  }
  const html = document.documentElement;
  html.setAttribute("data-theme-transitioning", "");
  apply();
  setTimeout(() => html.removeAttribute("data-theme-transitioning"), TRANSITION_MS + 50);
}
