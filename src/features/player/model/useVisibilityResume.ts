/**
 * useVisibilityResume — recovers the live pipeline after the window has been
 * out of sight.
 *
 * This is a *safety net*, not the primary fix. The primary fix is
 * `disable_window_occlusion_detection` on the Rust side (`src-tauri/src/
 * occlusion.rs`), which stops WebKit from clearing `ActivityState::IsVisible`
 * when the window moves to another Space — the actual cause of the black
 * stage on Ctrl+←/→.
 *
 * It still matters for the cases that flag cannot cover, because WebKit also
 * bails out of `isViewVisible()` when the window itself is not visible:
 * minimising, or hiding the app (which is what our close-to-tray path does).
 * Those leave the MSE pipeline parked, so coming back needs a nudge.
 *
 * Only acts when playback was actually running at the moment the window went
 * away, so a stream the user deliberately paused is never started again.
 */

import { useEffect, useRef } from "react";

type ResumableEngine = {
  /** hls.js: resume loading after a stall or an explicit stopLoad(). */
  startLoad?: (position?: number) => void;
};

/** Tolerance when testing whether the buffer still covers the playhead. */
const BUFFER_EPSILON_S = 0.5;

export function useVisibilityResume(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  engine: unknown,
) {
  // Playback intent captured before the platform parks the pipeline.
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const bufferedAtPlayhead = () => {
      const t = video.currentTime;
      for (let i = 0; i < video.buffered.length; i += 1) {
        if (t >= video.buffered.start(i) - BUFFER_EPSILON_S && t <= video.buffered.end(i)) {
          return true;
        }
      }
      return false;
    };

    const resume = () => {
      if (!wasPlayingRef.current) return;
      wasPlayingRef.current = false;

      if (video.paused) void video.play().catch(() => undefined);

      // Only nudge the loader when the buffer genuinely ran dry. Calling
      // startLoad() on a healthy buffer throws away perfectly good data and
      // forces a re-fetch, which shows up as the very black frame we are
      // trying to avoid.
      if (!bufferedAtPlayhead()) {
        (engine as ResumableEngine | null)?.startLoad?.();
      }
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
