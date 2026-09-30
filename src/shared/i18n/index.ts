/**
 * Language state.
 *
 * The initial language comes from the system locale (see `locale.ts`); once
 * saved preferences have loaded, `hydrate()` applies an explicit choice made in
 * Settings. Both paths go through `resolveLanguage()`, so the UI is in exactly
 * one language at a time and switching re-renders every subscribed component.
 */

import { create } from "zustand";
import { type Dict, dictionaries } from "./dictionary";
import { type Language, type LanguagePreference, resolveLanguage } from "./locale";

export type { Dict, Language, LanguagePreference };
export { resolveLanguage };

interface I18nState {
  preference: LanguagePreference;
  language: Language;
  /** Apply the persisted preference, once preferences have been loaded. */
  hydrate: (preference: LanguagePreference | undefined) => void;
  /** Explicit choice from Settings. */
  setPreference: (preference: LanguagePreference) => void;
}

export const useI18nStore = create<I18nState>((set) => ({
  preference: "system",
  language: resolveLanguage("system"),
  hydrate: (preference) => {
    const next = preference ?? "system";
    set({ preference: next, language: resolveLanguage(next) });
  },
  setPreference: (preference) => set({ preference, language: resolveLanguage(preference) }),
}));

/** UI copy for the active language. Subscribes, so components re-render. */
export function useStrings(): Dict {
  return useI18nStore((s) => dictionaries[s.language]);
}

/** The active language, for the few places that format numbers per language. */
export function useLanguage(): Language {
  return useI18nStore((s) => s.language);
}

/** UI copy for the active language, for code outside the React tree. */
export function strings(): Dict {
  return dictionaries[useI18nStore.getState().language];
}

/** Fill the `{name}` placeholders of a template. */
export function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}
