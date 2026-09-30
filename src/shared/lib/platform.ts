import { strings } from "@/shared/i18n";
import type { PlatformId } from "@/shared/types/domain";

/**
 * Display name of a platform. Read from the active language on each call
 * rather than captured in a module-level map, so switching language in
 * Settings updates every place that shows it.
 */
export function platformLabel(platform: PlatformId): string {
  return strings().platform[platform];
}

export function isPlatform(v: string | undefined): v is PlatformId {
  return v === "bilibili" || v === "douyu" || v === "huya";
}
