import { z } from "zod";

export const platformSchema = z.enum(["bilibili", "douyu"]);

export const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().optional(),
  iconUrl: z.string().optional(),
  shortName: z.string().optional(),
});

export const roomCardSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  roomId: z.string(),
  title: z.string(),
  streamerName: z.string(),
  coverUrl: z.string(),
  areaName: z.string().optional(),
  viewerCountText: z.string().optional(),
  isLive: z.boolean(),
  followed: z.boolean(),
});

export const roomDetailSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  roomId: z.string(),
  title: z.string(),
  streamerName: z.string(),
  avatarUrl: z.string().optional(),
  coverUrl: z.string().optional(),
  areaName: z.string().optional(),
  description: z.string().optional(),
  isLive: z.boolean(),
  followed: z.boolean(),
});

export const searchResultSchema = z.object({
  keyword: z.string(),
  items: z.array(roomCardSchema),
  total: z.number().optional(),
});

export const streamSourceSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  roomId: z.string(),
  qualityKey: z.string(),
  qualityLabel: z.string(),
  streamUrl: z.string(),
  format: z.enum(["hls", "flv"]),
  isDefault: z.boolean().optional(),
  cdn: z.string().optional(),
});

export const replayQualitySchema = z.object({
  name: z.string(),
  url: z.string(),
  bitRate: z.number(),
  level: z.number(),
});

export const replayItemSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  roomId: z.string(),
  title: z.string(),
  coverUrl: z.string().optional(),
  durationStr: z.string().optional(),
  durationSecs: z.number().optional(),
  recordedAt: z.number(),
  viewCountText: z.string().optional(),
  partNum: z.number(),
  totalParts: z.number(),
  showId: z.number(),
  showRemark: z.string().optional(),
  upId: z.string(),
});

export const followRecordSchema = z.object({
  id: z.string(),
  platform: platformSchema,
  roomId: z.string(),
  title: z.string(),
  streamerName: z.string(),
  coverUrl: z.string(),
  followedAt: z.string(),
});

export const appPreferencesSchema = z.object({
  defaultPlatform: platformSchema,
  resumeLastSession: z.boolean(),
  appearance: z.enum(["system", "light", "dark"]),
  proxy: z.enum(["none", "system"]).default("none"),
  lastVisited: z
    .object({
      type: z.enum(["discover", "search", "room"]),
      platform: platformSchema.optional(),
      roomId: z.string().optional(),
      keyword: z.string().optional(),
    })
    .optional(),
});
