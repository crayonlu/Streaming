/**
 * useVisibilityResume — recovers the live pipeline after the window has been
 * out of sight.
 *
 * macOS/WebKit treats a window on another Space (Ctrl+←/→), a minimised window
 * and a hidden app all as *not visible*: the compositor stops repainting and
 * the MSE pipeline is parked. Coming back therefore needs an explicit nudge —
 * without one, the stage keeps showing its black background until a new
 * segment happens to arrive on its own.
 *
 * Only acts when playback was actually running at the moment the window went
 * away, so a stream the user deliberately paused is never started again.
 *
 * Note this is a mitigation, not the root fix: the root fix is
 * `backgroundThrottling: "disabled"` (tauri.macos.conf.json), which stops
 * WebKit from parking the page in the first place.
 */

import { useEffect, useRef } from "react";

type ResumableEngine = {
  /** hls.js: resume loading after a stall or an explicit stopLoad(). */
  startLoad?: (position?: number) => void;
};

export function useVisibilityResume(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  engine: unknown,
) {
  // Playback intent captured before the platform parks the pipeline.
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const resume = () => {
      if (!wasPlayingRef.current) return;
      wasPlayingRef.current = false;
      // hls.js parks its loader while the page is hidden; mpegts.js keeps its
      // connection, so `startLoad` is simply absent there.
      (engine as ResumableEngine | null)?.startLoad?.();
      if (video.paused) void video.play().catch(() => undefined);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        wasPlayingRef.current = !video.paused;
        return;
      }
      resume();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    // The window can regain focus without a visibilitychange in some Space
    // transitions; `resume()` is a no-op unless playback was interrupted.
    window.addEventListener("focus", resume);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", resume);
    };
  }, [videoRef, engine]);
}
