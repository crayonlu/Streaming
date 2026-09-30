import { strings } from "@/shared/i18n";
import type { PlatformId } from "@/shared/types/domain";

export function supportsReplay(platform: PlatformId | string | undefined): platform is "douyu" {
  return platform === "douyu";
}

export function replayUnsupportedMessage(platform: PlatformId | string | undefined) {
  const { unavailable } = strings().replay;
  if (platform === "bilibili") return unavailable.bilibili;
  if (platform === "huya") return unavailable.huya;
  return unavailable.other;
}
