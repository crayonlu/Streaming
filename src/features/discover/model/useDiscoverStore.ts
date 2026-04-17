import { create } from "zustand";
import type { PlatformId, RoomCard } from "@/shared/types/domain";
import { getFeatured } from "@/shared/api/commands";

interface DiscoverState {
  rooms: RoomCard[];
  isLoading: boolean;
  error: string | null;
  page: number;
  hasNextPage: boolean;
  platform: PlatformId | null;
  fetchFirstPage: (platform: PlatformId) => Promise<void>;
  fetchNextPage: (platform: PlatformId) => Promise<void>;
}

export const useDiscoverStore = create<DiscoverState>((set, get) => ({
  rooms: [],
  isLoading: false,
  error: null,
  page: 0,
  hasNextPage: true,
  platform: null,

  fetchFirstPage: async (platform) => {
    set({ isLoading: true, error: null, rooms: [], page: 0, hasNextPage: true, platform });
    try {
      const data = await getFeatured(platform, 1);
      set({ rooms: data, isLoading: false, page: 1, hasNextPage: data.length > 0 });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  fetchNextPage: async (platform) => {
    const { isLoading, hasNextPage, page, platform: currentPlatform } = get();
    if (isLoading || !hasNextPage || currentPlatform !== platform) return;
    set({ isLoading: true });
    try {
      const nextPage = page + 1;
      const data = await getFeatured(platform, nextPage);
      set((state) => ({
        rooms: [...state.rooms, ...data],
        isLoading: false,
        page: nextPage,
        hasNextPage: data.length > 0,
      }));
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },
}));
