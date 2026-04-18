import { create } from "zustand";
import { checkRoomsLiveStatus, listFollows } from "@/shared/api/commands";
import type { FollowRecord } from "@/shared/types/domain";

interface FollowState {
  follows: FollowRecord[];
  liveStatusMap: Record<string, boolean>;
  isLoading: boolean;
  error: boolean;
  sortByLive: boolean;

  loadFollows: () => Promise<void>;
  refreshLiveStatus: () => Promise<void>;
  removeFollow: (platform: string, roomId: string) => void;
}

export const useFollowStore = create<FollowState>((set, get) => ({
  follows: [],
  liveStatusMap: {},
  isLoading: false,
  error: false,
  sortByLive: true,

  loadFollows: async () => {
    set({ isLoading: true, error: false });
    try {
      const data = await listFollows();
      set({ follows: data, isLoading: false });
      // After loading follows, refresh live status
      await get().refreshLiveStatus();
    } catch {
      set({ isLoading: false, error: true });
    }
  },

  refreshLiveStatus: async () => {
    const { follows } = get();
    if (follows.length === 0) return;
    try {
      const statusMap = await checkRoomsLiveStatus(
        follows.map((f) => ({ platform: f.platform, roomId: f.roomId })),
      );
      set({ liveStatusMap: statusMap });
    } catch {
      // silently ignore
    }
  },

  removeFollow: (platform, roomId) => {
    set((state) => ({
      follows: state.follows.filter((f) => !(f.platform === platform && f.roomId === roomId)),
    }));
  },
}));
