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

  setCategorySelection: (selection) => {
    const { platform, categorySelection } = get();

    if (platform === null) return;

    if (categorySelection?.categoryId === selection?.categoryId) return;

    set({ categorySelection: selection, isLoading: true, rooms: [], page: 0, hasNextPage: true });

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
        set({ rooms: data, isLoading: false, page: 1, hasNextPage: data.length > 0 });
      } catch (e) {
        set({ isLoading: false, error: String(e) });
      }
    };

    doFetch();
  },

  fetchFirstPage: async (platform) => {
    const { platform: currentPlatform, categorySelection } = get();

    const needsReset = currentPlatform !== null && currentPlatform !== platform;
    const newCategorySelection = needsReset ? null : categorySelection;

    set({
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
      set({ rooms: data, isLoading: false, page: 1, hasNextPage: data.length > 0 });
    } catch (e) {
      set({ isLoading: false, error: String(e) });
    }
  },

  fetchNextPage: async (platform) => {
    const { isLoading, hasNextPage, page, platform: currentPlatform, categorySelection } = get();
    if (isLoading || !hasNextPage || currentPlatform !== platform) return;
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
