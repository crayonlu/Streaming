import { create } from "zustand";

export type DanmakuFontSize = "small" | "medium" | "large";

interface DanmakuSettings {
  enabled: boolean;
  /** 0..1 */
  opacity: number;
  /** fraction of stage height used by danmaku: 0.25 | 0.5 | 0.75 | 1 */
  area: number;
  fontSize: DanmakuFontSize;

  setEnabled: (v: boolean) => void;
  setOpacity: (v: number) => void;
  setArea: (v: number) => void;
  setFontSize: (v: DanmakuFontSize) => void;

  /** Runtime state (NOT persisted): current room's online viewer count,
   *  fed by danmaku "online" events. Null when unknown / no room. */
  onlineCount: number | null;
  setOnlineCount: (v: number | null) => void;
}

const LS_KEY = "streaming_danmaku_settings";

interface PersistedShape {
  enabled: boolean;
  opacity: number;
  area: number;
  fontSize: DanmakuFontSize;
}

const DEFAULTS: PersistedShape = { enabled: true, opacity: 1, area: 0.5, fontSize: "medium" };

function readPersisted(): PersistedShape {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULTS.enabled,
      opacity:
        typeof parsed.opacity === "number" && parsed.opacity >= 0 && parsed.opacity <= 1
          ? parsed.opacity
          : DEFAULTS.opacity,
      area:
        typeof parsed.area === "number" && parsed.area > 0 && parsed.area <= 1
          ? parsed.area
          : DEFAULTS.area,
      fontSize:
        parsed.fontSize === "small" || parsed.fontSize === "medium" || parsed.fontSize === "large"
          ? parsed.fontSize
          : DEFAULTS.fontSize,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: PersistedShape) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // private mode — non-critical
  }
}

export const useDanmakuStore = create<DanmakuSettings>((set, get) => ({
  ...readPersisted(),
  setEnabled: (v) => {
    set({ enabled: v });
    const { enabled, opacity, area, fontSize } = get();
    persist({ enabled, opacity, area, fontSize });
  },
  setOpacity: (v) => {
    set({ opacity: v });
    const { enabled, opacity, area, fontSize } = get();
    persist({ enabled, opacity, area, fontSize });
  },
  setArea: (v) => {
    set({ area: v });
    const { enabled, opacity, area, fontSize } = get();
    persist({ enabled, opacity, area, fontSize });
  },
  setFontSize: (v) => {
    set({ fontSize: v });
    const { enabled, opacity, area, fontSize } = get();
    persist({ enabled, opacity, area, fontSize });
  },
  onlineCount: null,
  setOnlineCount: (v) => set({ onlineCount: v }),
}));
