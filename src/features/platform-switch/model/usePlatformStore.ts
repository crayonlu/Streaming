import { create } from "zustand";
import type { PlatformId } from "../../../shared/types/domain";

interface PlatformState {
  currentPlatform: PlatformId;
  setCurrentPlatform: (platform: PlatformId) => void;
  hydrated: boolean;
  hydratePlatform: (platform: PlatformId) => void;
}

export const usePlatformStore = create<PlatformState>((set) => ({
  currentPlatform: "bilibili",
  hydrated: false,
  setCurrentPlatform: (platform) => set({ currentPlatform: platform }),
  hydratePlatform: (platform) => set({ currentPlatform: platform, hydrated: true }),
}));
