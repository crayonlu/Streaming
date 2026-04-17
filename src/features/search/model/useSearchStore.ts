import { create } from "zustand";
import { searchRooms } from "@/shared/api/commands";
import type { PlatformId, RoomCard } from "@/shared/types/domain";

interface SearchState {
  keyword: string;
  platformFilter: PlatformId | undefined;
  rooms: RoomCard[];
  page: number;
  hasNextPage: boolean;
  isLoading: boolean;
  error: string | null;

  searchFirstPage: (keyword: string, platform?: PlatformId) => Promise<void>;
  searchNextPage: () => Promise<void>;
  clear: () => void;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  keyword: "",
  platformFilter: undefined,
  rooms: [],
  page: 0,
  hasNextPage: true,
  isLoading: false,
  error: null,

  searchFirstPage: async (keyword, platform) => {
    set({
      isLoading: true,
      error: null,
      rooms: [],
      page: 0,
      hasNextPage: true,
      keyword,
      platformFilter: platform,
    });
    try {
      const result = await searchRooms(keyword, platform, 1);
      set({
        rooms: result.items,
        isLoading: false,
        page: 1,
        hasNextPage: result.items.length > 0,
      });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  searchNextPage: async () => {
    const { isLoading, hasNextPage, page, keyword, platformFilter } = get();
    if (isLoading || !hasNextPage || !keyword) return;
    set({ isLoading: true });
    try {
      const nextPage = page + 1;
      const result = await searchRooms(keyword, platformFilter, nextPage);
      set((state) => ({
        rooms: [...state.rooms, ...result.items],
        isLoading: false,
        page: nextPage,
        hasNextPage: result.items.length > 0,
      }));
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  clear: () =>
    set({
      keyword: "",
      platformFilter: undefined,
      rooms: [],
      page: 0,
      hasNextPage: true,
      isLoading: false,
      error: null,
    }),
}));
