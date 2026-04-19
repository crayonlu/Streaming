import type { PlatformId } from "@/shared/types/domain";

export function supportsReplay(platform: PlatformId | string | undefined): platform is "douyu" {
  return platform === "douyu";
}

export function replayUnsupportedMessage(platform: PlatformId | string | undefined) {
  if (platform === "bilibili") return "B站回放不面向普通观众开放";
  if (platform === "huya") return "虎牙暂不提供完整直播回放";
  return "当前平台暂不支持回放";
}
