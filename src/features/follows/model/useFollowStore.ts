import { create } from "zustand";
import {
  checkRoomsLiveStatus,
  getRoomDetail,
  listFollows,
  patchFollowSnapshot,
} from "@/shared/api/commands";
import type { FollowRecord } from "@/shared/types/domain";
import { runPool } from "./runPool";

interface FollowState {
  follows: FollowRecord[];
  liveStatusMap: Record<string, boolean>;
  isLoading: boolean;
  isRefreshingStatus: boolean;
  error: boolean;
  sortByLive: boolean;

  loadFollows: () => Promise<void>;
  refreshLiveStatus: () => Promise<void>;
  /** Silently refresh room metadata (title, streamerName, coverUrl) in the background. */
  refreshFollowDetails: () => Promise<void>;
  removeFollow: (platform: string, roomId: string) => void;
}

export const useFollowStore = create<FollowState>((set, get) => ({
  follows: [],
  liveStatusMap: {},
  isLoading: false,
  isRefreshingStatus: false,
  error: false,
  sortByLive: true,

  loadFollows: async () => {
    set({ isLoading: true, error: false });
    try {
      const data = await listFollows();
      set({ follows: data, isLoading: false });
      // Two-level refresh (dart_simple_live pattern): the lightweight live-
      // status batch runs first; only rooms that are actually live get the
      // heavy getRoomDetail call. Offline rooms' metadata rarely changes, so
      // we skip them unless their local snapshot is incomplete.
      await get().refreshLiveStatus();
      void get().refreshFollowDetails();
    } catch {
      set({ isLoading: false, error: true });
    }
  },

  refreshLiveStatus: async () => {
    const { follows } = get();
    if (follows.length === 0) return;
    set({ isRefreshingStatus: true });
    try {
      const statusMap = await checkRoomsLiveStatus(
        follows.map((f) => ({ platform: f.platform, roomId: f.roomId })),
      );
      set({ liveStatusMap: statusMap, isRefreshingStatus: false });
    } catch {
      set({ isRefreshingStatus: false });
    }
  },

  refreshFollowDetails: async () => {
    const { follows, liveStatusMap } = get();
    if (follows.length === 0) return;

    // liveStatusMap is keyed by roomId (matches check_rooms_live_status and
    // FollowsPage's lookups), not FollowRecord.id ("platform-roomId").
    const targets = follows.filter(
      (f) => liveStatusMap[f.roomId] === true || !f.coverUrl || !f.title,
    );
    if (targets.length === 0) return;

    // Bounded pool (not Promise.all over everything) — hammering one
    // platform with dozens of concurrent detail requests trips rate limits.
    await runPool(targets, 3, async (f) => {
      const detail = await getRoomDetail(f.platform, f.roomId);
      const patch = {
        title: detail.title || f.title,
        streamerName: detail.streamerName || f.streamerName,
        coverUrl: detail.coverUrl || f.coverUrl,
      };
      if (
        patch.title !== f.title ||
        patch.streamerName !== f.streamerName ||
        patch.coverUrl !== f.coverUrl
      ) {
        await patchFollowSnapshot(f.platform, f.roomId, patch);
        set((state) => ({
          follows: state.follows.map((r) =>
            r.platform === f.platform && r.roomId === f.roomId ? { ...r, ...patch } : r,
          ),
        }));
      }
    });
  },

  removeFollow: (platform, roomId) => {
    set((state) => ({
      follows: state.follows.filter((f) => !(f.platform === platform && f.roomId === roomId)),
    }));
  },
}));
