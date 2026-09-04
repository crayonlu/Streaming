import { create } from "zustand";
import { getFeatured, getRoomsByCategory } from "@/shared/api/commands";
import type { PlatformId, RoomCard } from "@/shared/types/domain";

interface CategorySelection {
  categoryId: string;
  parentId: string | null;
  shortName: string | null;
}

interface DiscoverState {
  rooms: RoomCard[];
  isLoading: boolean;
  error: string | null;
  page: number;
  hasNextPage: boolean;
  platform: PlatformId | null;
  categorySelection: CategorySelection | null;
  requestEpoch: number;
  setCategorySelection: (selection: CategorySelection | null) => void;
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
  categorySelection: null,
  requestEpoch: 0,

  setCategorySelection: (selection) => {
    const { platform, categorySelection } = get();

    if (platform === null) return;

    if (categorySelection?.categoryId === selection?.categoryId) return;

    const requestEpoch = get().requestEpoch + 1;
    set({
      categorySelection: selection,
      requestEpoch,
      isLoading: true,
      error: null,
      rooms: [],
      page: 0,
      hasNextPage: true,
    });

    const doFetch = async () => {
      try {
        const data = selection
          ? await getRoomsByCategory(
              platform,
              selection.categoryId,
              1,
              selection.parentId ?? undefined,
              selection.shortName ?? undefined,
            )
          : await getFeatured(platform, 1);
        if (get().requestEpoch !== requestEpoch) return;
        set({ rooms: data, isLoading: false, page: 1, hasNextPage: data.length > 0 });
      } catch (e) {
        if (get().requestEpoch !== requestEpoch) return;
        set({ isLoading: false, error: String(e) });
      }
    };

    void doFetch();
  },

  fetchFirstPage: async (platform) => {
    const { platform: currentPlatform, categorySelection } = get();

    const needsReset = currentPlatform !== null && currentPlatform !== platform;
    const newCategorySelection = needsReset ? null : categorySelection;
    const requestEpoch = get().requestEpoch + 1;

    set({
      requestEpoch,
      isLoading: true,
      error: null,
      rooms: [],
      page: 0,
      hasNextPage: true,
      platform,
      categorySelection: newCategorySelection,
    });

    try {
      const data = newCategorySelection
        ? await getRoomsByCategory(
            platform,
            newCategorySelection.categoryId,
            1,
            newCategorySelection.parentId ?? undefined,
            newCategorySelection.shortName ?? undefined,
          )
        : await getFeatured(platform, 1);
      if (get().requestEpoch !== requestEpoch) return;
      set({ rooms: data, isLoading: false, page: 1, hasNextPage: data.length > 0 });
    } catch (e) {
      if (get().requestEpoch !== requestEpoch) return;
      set({ isLoading: false, error: String(e) });
    }
  },

  fetchNextPage: async (platform) => {
    const { isLoading, hasNextPage, page, platform: currentPlatform, categorySelection } = get();
    if (isLoading || !hasNextPage || currentPlatform !== platform) return;
    const requestEpoch = get().requestEpoch;
    set({ isLoading: true });
    try {
      const nextPage = page + 1;
      const data = categorySelection
        ? await getRoomsByCategory(
            platform,
            categorySelection.categoryId,
            nextPage,
            categorySelection.parentId ?? undefined,
            categorySelection.shortName ?? undefined,
          )
        : await getFeatured(platform, nextPage);
      if (get().requestEpoch !== requestEpoch) return;
      set((state) => {
        // De-duplicate across pages: B站 may return the same room_id on
        // consecutive pages (page boundary overlap or cross-section repeats).
        const existingIds = new Set(state.rooms.map((r) => r.id));
        const fresh = data.filter((r) => !existingIds.has(r.id));
        return {
          rooms: [...state.rooms, ...fresh],
          isLoading: false,
          page: nextPage,
          hasNextPage: data.length > 0,
        };
      });
    } catch (e) {
      if (get().requestEpoch !== requestEpoch) return;
      set({ isLoading: false, error: String(e) });
    }
  },
}));
