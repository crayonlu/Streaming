import { listen } from "@tauri-apps/api/event";
import DanmuJs from "danmu.js";
import { useEffect, useRef } from "react";
import { startDanmaku, stopDanmaku } from "@/shared/api/commands";
import { danmakuEventSchema } from "@/shared/types/contracts";
import type { PlatformId } from "@/shared/types/domain";
import {
  areaLinesFor,
  channelSizeFor,
  FONT_SIZE_MAP,
  maxBulletsFor,
} from "../model/danmakuGeometry";
import { useDanmakuStore } from "../model/useDanmakuStore";

interface DanmakuOverlayProps {
  platform: PlatformId;
  roomId: string;
}

/**
 * Danmaku overlay rendered inside the player stage (must be inside the
 * fullscreen target element). Owns: backend WS listener lifecycle, danmu.js
 * instance, event subscription, settings application, density throttle,
 * background gating.
 *
 * Rendered with opacity/display toggling (not unmount) when disabled so the
 * instance keeps its state — same rationale as simple_live's Offstage.
 */
export function DanmakuOverlay({ platform, roomId }: DanmakuOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const danmuRef = useRef<DanmuJs | null>(null);
  const enabled = useDanmakuStore((s) => s.enabled);
  const opacity = useDanmakuStore((s) => s.opacity);
  const area = useDanmakuStore((s) => s.area);
  const fontSize = useDanmakuStore((s) => s.fontSize);

  // ── Backend WS listener lifecycle (per room) ─────────────────────────────
  useEffect(() => {
    startDanmaku(platform, roomId).catch(() => undefined);
    return () => {
      stopDanmaku(platform, roomId).catch(() => undefined);
    };
  }, [platform, roomId]);

  // ── danmu.js instance + event subscription (per room) ────────────────────
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // New room — clear the previous room's online count.
    useDanmakuStore.getState().setOnlineCount(null);

    const s = useDanmakuStore.getState();
    const fontPx = FONT_SIZE_MAP[s.fontSize];
    const danmu = new DanmuJs({
      container: host,
      containerStyle: { zIndex: 5 },
      comments: [],
      area: {
        start: 0,
        end: s.area,
        lines: areaLinesFor(host.offsetHeight, s.area, fontPx),
      },
      channelSize: channelSizeFor(fontPx),
      mouseControl: false,
      mouseControlPause: false,
      bOffset: 800,
      chaseEffect: true,
      // Lazy start: saves CPU/GPU until the first comment arrives.
      defaultOff: true,
    });
    danmuRef.current = danmu;
    let started = false;
    const ensureStarted = () => {
      if (started) return;
      try {
        danmu.start();
        started = true;
      } catch {
        // ignore
      }
    };

    const listenPromise = listen<unknown>("danmaku-event", (event) => {
      const parsed = danmakuEventSchema.safeParse(event.payload);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.platform !== platform || msg.roomId !== roomId) return;

      // Online-count events feed the room info bar, not the overlay.
      if (msg.kind === "online") {
        if (typeof msg.count === "number") {
          useDanmakuStore.getState().setOnlineCount(msg.count);
        }
        return;
      }
      if (msg.kind === "status") {
        if (msg.state) useDanmakuStore.getState().setConnectionState(msg.state);
        return;
      }
      if (msg.kind !== "chat") return;

      const state = useDanmakuStore.getState();
      if (!state.enabled || document.hidden) return;

      ensureStarted();

      // Density throttle: drop new danmaku rather than overlap/stutter.
      try {
        const bullets = danmu.state?.bullets;
        const count = Array.isArray(bullets) ? bullets.length : 0;
        if (count > maxBulletsFor(host.offsetHeight, state.area, FONT_SIZE_MAP[state.fontSize])) {
          return;
        }
      } catch {
        // ignore density check failures
      }

      danmu.sendComment({
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        txt: msg.content ?? "",
        duration: 12000,
        mode: "scroll",
        style: {
          fontSize: `${FONT_SIZE_MAP[state.fontSize]}px`,
          color: msg.color ?? "#ffffff",
        },
      });
    });

    // Background gating: pause + clear while hidden so returning to the
    // window doesn't flush a backlog of stale danmaku (simple_live pattern).
    const onVisibility = () => {
      if (document.hidden) {
        try {
          danmu.pause();
          danmu.clear();
        } catch {
          // ignore
        }
      } else if (useDanmakuStore.getState().enabled) {
        ensureStarted();
        try {
          danmu.play();
        } catch {
          // ignore
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void listenPromise.then((fn) => fn());
      try {
        danmu.destroy();
      } catch {
        // ignore
      }
      danmuRef.current = null;
    };
  }, [platform, roomId]);

  // ── Apply settings live (no rebuild) ─────────────────────────────────────
  useEffect(() => {
    const danmu = danmuRef.current;
    const host = hostRef.current;
    if (!danmu || !host) return;
    const fontPx = FONT_SIZE_MAP[fontSize];
    const targetOpacity = enabled ? opacity : 0;
    try {
      danmu.setFontSize(fontPx, channelSizeFor(fontPx));
      danmu.setArea({
        start: 0,
        end: area,
        lines: areaLinesFor(host.offsetHeight, area, fontPx),
      });
      danmu.setOpacity(targetOpacity);
      if (enabled) {
        danmu.play();
        danmu.show("scroll");
      } else {
        danmu.pause();
      }
    } catch {
      // Non-critical — settings apply on next comment at worst.
    }
  }, [enabled, opacity, area, fontSize]);

  return (
    <div
      ref={hostRef}
      aria-hidden={!enabled}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 5, opacity: enabled ? 1 : 0 }}
    />
  );
}
