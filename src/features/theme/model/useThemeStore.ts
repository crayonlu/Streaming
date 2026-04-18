/**
 * Theme store — applies the `.dark` class to <html> based on the user's
 * appearance preference.  Uses the View Transitions API when available so
 * the switch crossfades smoothly; falls back to an instant CSS-transition
 * approach via `data-theme-transitioning` otherwise.
 *
 * The single source of truth for appearance is `AppPreferences.appearance`
 * (persisted via tauri-plugin-store).  This store holds the resolved
 * `theme` ("light" | "dark") and exposes `syncFromPreference` so the
 * Settings page can push changes without duplicate storage.
 *
 * - `theme`              — resolved value applied to DOM: "light" | "dark"
 * - `syncFromPreference` — call after loading/saving AppPreferences
 * - `toggle`             — quick toggle in sidebar (light ↔ dark)
 */
import { create } from "zustand";

export type Theme = "light" | "dark";
export type ThemeMode = "system" | "light" | "dark";

const TRANSITION_MS = 280;

/** Resolve OS color-scheme preference. */
function osPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Resolve a ThemeMode to an actual Theme. */
function resolve(mode: ThemeMode): Theme {
  if (mode === "system") return osPrefersDark() ? "dark" : "light";
  return mode;
}

/** Apply resolved theme to DOM and cache mode for FOUC guard. */
function applyTheme(theme: Theme, mode?: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  // Non-authoritative cache for the inline FOUC script in index.html.
  // Source of truth is AppPreferences.appearance in tauri-plugin-store.
  try {
    localStorage.setItem("streaming_theme_cache", mode ?? theme);
  } catch {}
}

interface ThemeState {
  /** Resolved theme applied to DOM. */
  theme: Theme;
  /** Quick toggle — always switches between light ↔ dark. */
  toggle: () => void;
  /** Sync from AppPreferences.appearance. Call on startup and settings save. */
  syncFromPreference: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",

  syncFromPreference(mode) {
    const theme = resolve(mode);
    applyTheme(theme, mode);
    set({ theme });
  },

  toggle() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    switchTheme(next, () => {
      applyTheme(next, next);
      set({ theme: next });
    });
  },
}));

// ── Smooth switch helper ──────────────────────────────────────────────────────

function switchTheme(_next: Theme, apply: () => void) {
  // Prefer View Transitions API — gives a crossfade without touching CSS
  if (typeof document.startViewTransition === "function") {
    void document.startViewTransition(() => apply());
    return;
  }

  // Fallback: enable CSS transitions briefly, apply, then remove
  const html = document.documentElement;
  html.setAttribute("data-theme-transitioning", "");
  apply();
  // Remove the attribute after transitions complete
  setTimeout(() => html.removeAttribute("data-theme-transitioning"), TRANSITION_MS + 50);
}
