export type PlatformId = "bilibili" | "douyu";

export interface RoomCard {
  id: string;
  platform: PlatformId;
  roomId: string;
  title: string;
  streamerName: string;
  coverUrl: string;
  areaName?: string;
  viewerCountText?: string;
  isLive: boolean;
  followed: boolean;
}

export interface RoomDetail {
  id: string;
  platform: PlatformId;
  roomId: string;
  title: string;
  streamerName: string;
  avatarUrl?: string;
  coverUrl?: string;
  areaName?: string;
  description?: string;
  isLive: boolean;
  followed: boolean;
}

export interface SearchResult {
  keyword: string;
  items: RoomCard[];
  total?: number;
}

export interface StreamSource {
  id: string;
  platform: PlatformId;
  roomId: string;
  qualityKey: string;
  qualityLabel: string;
  streamUrl: string;
  format: "hls" | "flv";
  isDefault?: boolean;
}

export interface ReplayQuality {
  name: string;
  url: string;
  bitRate: number;
  level: number;
}

export interface ReplayItem {
  id: string;
  platform: PlatformId;
  roomId: string;
  title: string;
  coverUrl?: string;
  durationStr?: string;
  durationSecs?: number;
  recordedAt: number;
  viewCountText?: string;
  partNum: number;
  totalParts: number;
  showId: number;
  showRemark?: string;
  upId: string;
}

export interface FollowRecord {
  id: string;
  platform: PlatformId;
  roomId: string;
  title: string;
  streamerName: string;
  coverUrl: string;
  followedAt: string;
}

export type ProxyMode = "none" | "system";

export interface AppPreferences {
  defaultPlatform: PlatformId;
  resumeLastSession: boolean;
  appearance: "system" | "light";
  /** "none" = disable all proxy (safe default); "system" = use OS/env proxy */
  proxy: ProxyMode;
  lastVisited?: {
    type: "discover" | "search" | "room";
    platform?: PlatformId;
    roomId?: string;
    keyword?: string;
  };
}
