/**
 * Theme store — persists dark / light preference in localStorage and applies
 * the `.dark` class to <html>.  Uses the View Transitions API when available
 * so the switch crossfades smoothly; falls back to an instant CSS-transition
 * approach via `data-theme-transitioning` otherwise.
 */
import { create } from "zustand";

export type Theme = "light" | "dark";

const STORAGE_KEY = "streaming_theme";
const TRANSITION_MS = 280;

function readStored(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch {
    // ignore
  }
  // Default: respect OS preference
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyClass(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
}

interface ThemeState {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
  init: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: "light",

  init() {
    const stored = readStored();
    applyClass(stored);
    set({ theme: stored });
  },

  setTheme(next) {
    switchTheme(next, () => {
      applyClass(next);
      set({ theme: next });
    });
  },

  toggle() {
    const next: Theme = get().theme === "dark" ? "light" : "dark";
    get().setTheme(next);
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
