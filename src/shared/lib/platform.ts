import type { PlatformId } from "@/shared/types/domain";

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  bilibili: "Bilibili",
  douyu: "斗鱼",
};

export function isPlatform(v: string | undefined): v is PlatformId {
  return v === "bilibili" || v === "douyu";
}
