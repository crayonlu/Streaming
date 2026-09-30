/**
 * Which language the UI starts in.
 *
 * The AppImageHub catalog only lists applications that come up in English when
 * the system language is English or unset, so Chinese is used only when the
 * system explicitly asks for it and everything else falls back to English.
 *
 * `navigator.language` is the signal: WebKitGTK and WebView2 both derive it
 * from the process locale, i.e. from `LANG` / `LC_ALL` / `LC_MESSAGES`, and it
 * is available synchronously. `@tauri-apps/plugin-os`'s `locale()` returns the
 * same value but only asynchronously, which would mean painting the window in
 * one language and switching it to the other.
 */

import type { Language, LanguagePreference } from "../types/domain";

export type { Language, LanguagePreference };

const CHINESE = /^zh\b|^zh[-_]/i;

function systemLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  return [navigator.language, ...(navigator.languages ?? [])].filter(
    (tag): tag is string => typeof tag === "string" && tag.length > 0,
  );
}

/**
 * Resolve the language to use. An explicit `zh` / `en` choice always wins;
 * "system" looks for a Chinese tag anywhere in the preference list and
 * otherwise returns English, which also covers the `C` locale and an empty
 * preference list.
 */
export function resolveLanguage(preference: LanguagePreference = "system"): Language {
  if (preference === "zh" || preference === "en") return preference;
  return systemLanguages().some((tag) => CHINESE.test(tag)) ? "zh" : "en";
}
