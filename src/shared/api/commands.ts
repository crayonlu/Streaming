import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  appPreferencesSchema,
  followRecordSchema,
  roomCardSchema,
  roomDetailSchema,
  searchResultSchema,
  streamSourceSchema,
} from "../types/contracts";
import type {
  AppPreferences,
  FollowRecord,
  PlatformId,
  RoomCard,
  RoomDetail,
  SearchResult,
  StreamSource,
} from "../types/domain";

const appStore = new LazyStore("app-state.json", {
  autoSave: 150,
  defaults: {
    defaultPlatform: "bilibili",
    resumeLastSession: true,
    appearance: "system",
    proxy: "none",
    follows: [],
  },
});
const FOLLOW_KEY = "follows";

async function safeInvoke<T>(command: string, payload?: Record<string, unknown>) {
  return invoke<T>(command, payload ?? {});
}

function nowIso() {
  return new Date().toISOString();
}

async function getFollowRecordsFromStore(): Promise<FollowRecord[]> {
  await appStore.init();
  const raw = (await appStore.get<unknown>(FOLLOW_KEY)) ?? [];
  return followRecordSchema.array().parse(raw);
}

async function writeFollowRecords(records: FollowRecord[]) {
  await appStore.init();
  await appStore.set(FOLLOW_KEY, records);
  await appStore.save();
}

function isFollowed(records: FollowRecord[], platform: PlatformId, roomId: string) {
  return records.some((item) => item.platform === platform && item.roomId === roomId);
}

function patchFollowed(cards: RoomCard[], records: FollowRecord[]) {
  return cards.map((card) => ({
    ...card,
    followed: isFollowed(records, card.platform, card.roomId),
  }));
}

export async function getFeatured(platform: PlatformId): Promise<RoomCard[]> {
  const result = await safeInvoke<unknown[]>("get_featured", { platform });
  const cards = roomCardSchema.array().parse(result);
  const follows = await getFollowRecordsFromStore();
  return patchFollowed(cards, follows);
}

export async function searchRooms(keyword: string, platform?: PlatformId): Promise<SearchResult> {
  const result = await safeInvoke<unknown>("search_rooms", { keyword, platform });
  const parsed = searchResultSchema.parse(result);
  const follows = await getFollowRecordsFromStore();
  return {
    ...parsed,
    items: patchFollowed(parsed.items, follows),
  };
}

export async function getRoomDetail(platform: PlatformId, roomId: string): Promise<RoomDetail> {
  const result = await safeInvoke<unknown>("get_room_detail", { platform, roomId });
  const parsed = roomDetailSchema.parse(result);
  const follows = await getFollowRecordsFromStore();
  return {
    ...parsed,
    followed: isFollowed(follows, parsed.platform, parsed.roomId),
  };
}

export async function getStreamSources(
  platform: PlatformId,
  roomId: string,
): Promise<StreamSource[]> {
  const result = await safeInvoke<unknown[]>("get_stream_sources", { platform, roomId });
  return streamSourceSchema.array().parse(result);
}

export async function listFollows(): Promise<FollowRecord[]> {
  const records = await getFollowRecordsFromStore();
  return [...records].sort((a, b) => (a.followedAt < b.followedAt ? 1 : -1));
}

interface ToggleFollowInput {
  platform: PlatformId;
  roomId: string;
  follow: boolean;
  title: string;
  streamerName: string;
  coverUrl: string;
}

export async function toggleFollow(input: ToggleFollowInput): Promise<FollowRecord[]> {
  const records = await getFollowRecordsFromStore();
  const next = records.filter(
    (item) => !(item.platform === input.platform && item.roomId === input.roomId),
  );

  if (input.follow) {
    next.unshift({
      id: `${input.platform}-${input.roomId}`,
      platform: input.platform,
      roomId: input.roomId,
      title: input.title,
      streamerName: input.streamerName,
      coverUrl: input.coverUrl,
      followedAt: nowIso(),
    });
  }

  await writeFollowRecords(next);
  return next;
}

export async function loadPreferences(): Promise<AppPreferences> {
  let prefs: AppPreferences;
  try {
    await appStore.init();
    const fromStore = Object.fromEntries(await appStore.entries<unknown>());
    prefs = appPreferencesSchema.parse(fromStore);
  } catch {
    const result = await safeInvoke<unknown>("load_preferences");
    prefs = appPreferencesSchema.parse(result);
  }
  // Apply proxy mode to the Rust HTTP layer so fresh requests use the saved setting.
  void safeInvoke("apply_proxy_mode", { system: prefs.proxy === "system" }).catch(() => undefined);
  return prefs;
}

export async function savePreferences(next: AppPreferences): Promise<AppPreferences> {
  const parsed = appPreferencesSchema.parse(next);
  await appStore.init();
  await Promise.all(
    Object.entries(parsed).map(async ([key, value]) => {
      await appStore.set(key, value);
    }),
  );
  await appStore.save();
  // Sync to Rust so the HTTP layer applies proxy changes immediately.
  void safeInvoke("save_preferences", { preferences: parsed }).catch(() => undefined);
  return parsed;
}

export async function recordLastVisited(
  entry: NonNullable<AppPreferences["lastVisited"]>,
): Promise<void> {
  try {
    const pref = await loadPreferences();
    if (!pref.resumeLastSession) return;
    await savePreferences({ ...pref, lastVisited: entry });
  } catch {
    // non-critical — silently ignore
  }
}

export function buildRoomWebUrl(platform: PlatformId, roomId: string) {
  if (platform === "bilibili") return `https://live.bilibili.com/${roomId}`;
  return `https://www.douyu.com/${roomId}`;
}
