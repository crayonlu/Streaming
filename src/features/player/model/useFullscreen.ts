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
 * The guard has to outlive the *animation*, not the command: on macOS
 * `setFullscreen()` resolves as soon as the transition starts, while
 * `tauri://resize` keeps firing for the whole ~0.5s Space animation and
 * isFullscreen() still reports the old value. Clearing the guard on the
 * promise's resolution (the previous behaviour) let the external sync observe
 * a stale `false` and strip the overlay off mid-animation — the video dropped
 * back into the document flow and its compositing layer was rebuilt, which
 * shows up as a black flash. `settle()` now polls until the platform agrees
 * with the intent, with a timeout so a failed transition can never wedge the
 * guard on forever.
 *
 * Notch: handled in player.css via env(safe-area-inset-*) on the overlay, so
 * the video top never sits under the camera.
 *
 * Debug logs prefixed `[fs]`.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

const FS_CLASS = "player-stage--fullscreen";

/** Upper bound on how long the external sync stays disabled after a request. */
const SETTLE_TIMEOUT_MS = 1200;
/** Poll interval while waiting for the native transition to land. */
const SETTLE_POLL_MS = 60;

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

  /**
   * Holds pendingRef until the window actually reports `expect`, so resize
   * events emitted during the native animation cannot be mistaken for an
   * external fullscreen change.
   */
  const settle = useCallback(async (expect: boolean) => {
    const win = getCurrentWindow();
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        const actual = await win.isFullscreen().catch(() => expect);
        if (actual === expect) return;
        await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
      }
      console.warn("[fs] settle timed out waiting for isFullscreen =", expect);
    } finally {
      pendingRef.current = false;
    }
  }, []);

  const enter = useCallback(async () => {
    console.log("[fs] enter");
    applyOverlay(true);
    setIsFs(true);
    pendingRef.current = true;
    const win = getCurrentWindow();
    wasWindowFsRef.current = await win.isFullscreen().catch(() => false);
    console.log("[fs] enter, wasWindowFs =", wasWindowFsRef.current);
    if (wasWindowFsRef.current) {
      pendingRef.current = false;
      return;
    }
    try {
      await win.setFullscreen(true);
    } catch (e) {
      console.warn("[fs] setFullscreen(true) failed", e);
      pendingRef.current = false;
      return;
    }
    await settle(true);
  }, [applyOverlay, settle]);

  const exit = useCallback(async () => {
    console.log("[fs] exit, wasWindowFs =", wasWindowFsRef.current);
    applyOverlay(false);
    setIsFs(false);
    pendingRef.current = true;
    // Only exit window fullscreen if the player was responsible for entering
    // it. If the window was already fullscreen before, leave it alone.
    if (wasWindowFsRef.current) {
      pendingRef.current = false;
      return;
    }
    const win = getCurrentWindow();
    try {
      await win.setFullscreen(false);
    } catch (e) {
      console.warn("[fs] setFullscreen(false) failed", e);
      pendingRef.current = false;
      return;
    }
    await settle(false);
  }, [applyOverlay, settle]);

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
