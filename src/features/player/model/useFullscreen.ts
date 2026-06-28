/**
 * useFullscreen — player fullscreen = native OS fullscreen + CSS overlay.
 *
 * enter(): win.setFullscreen(true) → macOS native fullscreen (new Space,
 *          dock/menubar auto-hide). overlay lifts the video out of layout to
 *          cover the whole window so sidebar/topbar are hidden underneath.
 * exit():  win.setFullscreen(false) + remove overlay.
 *
 * State is driven by intent (not isFullscreen() polling), because the native
 * transition fires resize events mid-animation and isFullscreen() can briefly
 * read false. pendingRef skips the external sync during our own transition.
 *
 * Notch: handled in player.css via env(safe-area-inset-*) on the overlay, so
 * the video top never sits under the camera.
 *
 * Debug logs prefixed `[fs]`.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

const FS_CLASS = "player-stage--fullscreen";

export function useFullscreen(stageRef: React.RefObject<HTMLElement | null>) {
  const [isFs, setIsFs] = useState(false);
  const pendingRef = useRef(false);
  // Remembers whether the window was already fullscreen when the player
  // entered fullscreen. If so, exit() must NOT exit the window fullscreen —
  // only the overlay is removed, preserving the user's window state.
  const wasWindowFsRef = useRef(false);

  const applyOverlay = useCallback(
    (on: boolean) => {
      stageRef.current?.classList.toggle(FS_CLASS, on);
    },
    [stageRef],
  );

  const enter = useCallback(async () => {
    console.log("[fs] enter");
    applyOverlay(true);
    setIsFs(true);
    pendingRef.current = true;
    const win = getCurrentWindow();
    wasWindowFsRef.current = await win.isFullscreen().catch(() => false);
    console.log("[fs] enter, wasWindowFs =", wasWindowFsRef.current);
    if (!wasWindowFsRef.current) {
      try {
        await win.setFullscreen(true);
      } catch (e) {
        console.warn("[fs] setFullscreen(true) failed", e);
      }
    }
    pendingRef.current = false;
  }, [applyOverlay]);

  const exit = useCallback(async () => {
    console.log("[fs] exit, wasWindowFs =", wasWindowFsRef.current);
    applyOverlay(false);
    setIsFs(false);
    pendingRef.current = true;
    const win = getCurrentWindow();
    // Only exit window fullscreen if the player was responsible for entering
    // it. If the window was already fullscreen before, leave it alone.
    if (!wasWindowFsRef.current) {
      try {
        await win.setFullscreen(false);
      } catch (e) {
        console.warn("[fs] setFullscreen(false) failed", e);
      }
    }
    pendingRef.current = false;
  }, [applyOverlay]);

  const toggle = useCallback(() => {
    console.log("[fs] toggle, current isFs =", isFs);
    void (isFs ? exit() : enter());
  }, [isFs, enter, exit]);

  // External sync: macOS green button / Esc flip native fullscreen. Mirror the
  // overlay so state stays consistent. Skipped during our own transition.
  useEffect(() => {
    const win = getCurrentWindow();
    let cancelled = false;
    const sync = async () => {
      if (cancelled || pendingRef.current) return;
      const tauriFs = await win.isFullscreen().catch(() => false);
      if (cancelled || pendingRef.current) return;
      console.log("[fs] external sync, isFullscreen =", tauriFs, "(current isFs =", isFs, ")");
      if (tauriFs !== isFs) {
        applyOverlay(tauriFs);
        setIsFs(tauriFs);
      }
    };
    const unlisten = win.onResized(() => void sync());
    return () => {
      cancelled = true;
      void unlisten.then((fn) => fn?.());
    };
  }, [applyOverlay, isFs]);

  // Cleanup on unmount: remove the overlay class only. Do NOT touch window
  // fullscreen — that is an independent user action (e.g. macOS lights) and
  // exiting it here would shrink the window when navigating between pages.
  useEffect(() => {
    return () => {
      stageRef.current?.classList.remove(FS_CLASS);
    };
  }, [stageRef]);

  return { isFs, enter, exit, toggle };
}
