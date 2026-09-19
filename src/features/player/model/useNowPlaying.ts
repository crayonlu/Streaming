/**
 * useNowPlaying — mirrors the current stream into the OS tray.
 *
 * On macOS the tray is the menu-bar status item. It stays **icon-only**: the
 * playback line (play/pause glyph, streamer, title) is the first row of the
 * tray menu, so it only shows up once the user clicks the icon. Putting it in
 * the menu bar itself made the title permanently visible and far too long.
 * The tooltip carries the streamer name for a hover peek.
 *
 * Transport controls run the other way: the Rust tray menu emits events and
 * this hook applies them to the media element, because the `<video>` element —
 * and therefore play/pause/mute — only exists in the webview.
 *
 * The hook is a no-op when there is no title, so callers can pass `null` while
 * the room metadata is still loading.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { clearNowPlaying, setNowPlaying } from "@/shared/api/commands";

/** Emitted by the Rust tray menu when 播放/暂停 is picked. */
export const TRAY_TOGGLE_PLAY_EVENT = "tray://toggle-play";
/** Emitted by the Rust tray menu when 静音/取消静音 is picked. */
export const TRAY_TOGGLE_MUTE_EVENT = "tray://toggle-mute";

export interface NowPlayingInfo {
  /** Live stream or replay title — shown in the tray menu's header row. */
  title: string;
  /** Streamer name — tooltip only. */
  streamer?: string;
}

/** Video events that can change what the tray should display. */
const STATE_EVENTS = ["play", "playing", "pause", "waiting", "volumechange", "ended"] as const;

export function useNowPlaying(
  info: NowPlayingInfo | null | undefined,
  videoRef: React.RefObject<HTMLVideoElement | null>,
) {
  const title = info?.title?.trim() ?? "";
  const streamer = info?.streamer?.trim() ?? "";

  // The tray is an IPC round-trip away, and `volumechange` alone can fire
  // dozens of times while a slider is dragged — only push real changes.
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !title) return;

    let disposed = false;
    const push = () => {
      if (disposed) return;
      const key = `${title}\u0000${streamer}\u0000${video.paused}\u0000${video.muted}`;
      if (key === lastSentRef.current) return;
      lastSentRef.current = key;
      void setNowPlaying({
        title,
        streamer: streamer || undefined,
        playing: !video.paused,
        muted: video.muted,
      }).catch(() => undefined);
    };

    push();
    for (const name of STATE_EVENTS) video.addEventListener(name, push);
    return () => {
      disposed = true;
      for (const name of STATE_EVENTS) video.removeEventListener(name, push);
    };
  }, [title, streamer, videoRef]);

  // Drop the tray info when the player goes away (back navigation, route
  // change) so the tray never advertises a stream that is no longer open.
  useEffect(() => {
    return () => {
      lastSentRef.current = null;
      void clearNowPlaying().catch(() => undefined);
    };
  }, []);

  // Tray menu transport controls act on the media element.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const pending: Promise<UnlistenFn>[] = [
      listen(TRAY_TOGGLE_PLAY_EVENT, () => {
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      }),
      listen(TRAY_TOGGLE_MUTE_EVENT, () => {
        video.muted = !video.muted;
      }),
    ];

    return () => {
      for (const p of pending) {
        void p.then((fn) => fn()).catch(() => undefined);
      }
    };
  }, [videoRef]);
}
