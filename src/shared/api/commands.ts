import { invoke } from "@tauri-apps/api/core";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  appPreferencesSchema,
  categorySchema,
  followRecordSchema,
  replayItemSchema,
  replayQualitySchema,
  roomCardSchema,
  roomDetailSchema,
  searchResultSchema,
  streamSourceSchema,
} from "../types/contracts";
import type {
  AppPreferences,
  Category,
  FollowRecord,
  PlatformId,
  ReplayItem,
  ReplayQuality,
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

export async function getFeatured(platform: PlatformId, page = 1): Promise<RoomCard[]> {
  // Fire both requests concurrently: the Tauri IPC call and the local store read
  // are independent, so there is no reason to sequence them. Running them in
  // parallel also closes the race window that existed when the platform could
  // change between the two sequential awaits.
  const [result, follows] = await Promise.all([
    safeInvoke<unknown[]>("get_featured", { platform, page }),
    getFollowRecordsFromStore(),
  ]);
  const cards = roomCardSchema.array().parse(result);
  return patchFollowed(cards, follows);
}

export async function getCategories(platform: PlatformId): Promise<Category[]> {
  const result = await safeInvoke<unknown[]>("get_categories", { platform });
  return categorySchema.array().parse(result);
}

export async function getRoomsByCategory(
  platform: PlatformId,
  categoryId: string,
  page = 1,
  parentId?: string,
  shortName?: string,
): Promise<RoomCard[]> {
  const [result, follows] = await Promise.all([
    safeInvoke<unknown[]>("get_rooms_by_category", {
      platform,
      categoryId,
      parentId: parentId ?? null,
      shortName: shortName ?? null,
      page,
    }),
    getFollowRecordsFromStore(),
  ]);
  const cards = roomCardSchema.array().parse(result);
  return patchFollowed(cards, follows);
}

export async function searchRooms(
  keyword: string,
  platform?: PlatformId,
  page = 1,
): Promise<SearchResult> {
  const [result, follows] = await Promise.all([
    safeInvoke<unknown>("search_rooms", { keyword, platform, page }),
    getFollowRecordsFromStore(),
  ]);
  const parsed = searchResultSchema.parse(result);
  return {
    ...parsed,
    items: patchFollowed(parsed.items, follows),
  };
}

export async function getRoomDetail(platform: PlatformId, roomId: string): Promise<RoomDetail> {
  const [result, follows] = await Promise.all([
    safeInvoke<unknown>("get_room_detail", { platform, roomId }),
    getFollowRecordsFromStore(),
  ]);
  const parsed = roomDetailSchema.parse(result);
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

export async function getReplayList(
  platform: PlatformId,
  roomId: string,
  page = 1,
): Promise<ReplayItem[]> {
  const result = await safeInvoke<unknown[]>("get_replay_list", { platform, roomId, page });
  return replayItemSchema.array().parse(result);
}

export async function getReplayParts(
  platform: PlatformId,
  roomId: string,
  hashId: string,
  upId: string,
): Promise<ReplayItem[]> {
  const result = await safeInvoke<unknown[]>("get_replay_parts", {
    platform,
    roomId,
    hashId,
    upId,
  });
  return replayItemSchema.array().parse(result);
}

export async function getReplayQualities(
  platform: PlatformId,
  replayId: string,
): Promise<ReplayQuality[]> {
  const result = await safeInvoke<unknown[]>("get_replay_qualities", { platform, replayId });
  return replayQualitySchema.array().parse(result);
}

export async function setBilibiliSessdata(sessdata: string): Promise<void> {
  await safeInvoke("set_bilibili_sessdata", { sessdata });
}

export async function getBilibiliCookie(): Promise<{
  cookie: string | null;
  hasSessdata: boolean;
  hasBiliJct: boolean;
}> {
  return safeInvoke("get_bilibili_cookie");
}

export async function openBilibiliLoginWindow(): Promise<string> {
  return safeInvoke<string>("open_bilibili_login_window");
}

export async function closeBilibiliLoginWindow(): Promise<void> {
  return safeInvoke("close_bilibili_login_window");
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

export async function checkRoomsLiveStatus(
  rooms: { platform: PlatformId; roomId: string }[],
): Promise<Record<string, boolean>> {
  if (rooms.length === 0) return {};
  return safeInvoke<Record<string, boolean>>("check_rooms_live_status", { rooms });
}
