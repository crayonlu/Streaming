import { Radio } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

function fmtTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const s = Math.floor(secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface PlayerProgressProps {
  // biome-ignore lint/suspicious/noExplicitAny: xgplayer has no public TS types
  playerRef: React.MutableRefObject<any>;
  isLive: boolean;
  playerReady: boolean;
}

export function PlayerProgress({ playerRef, isLive, playerReady }: PlayerProgressProps) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [liveLatency, setLiveLatency] = useState(0);
  const seeking = useRef(false);

  useEffect(() => {
    if (!isLive || !playerReady) return;
    const timer = window.setInterval(() => {
      setLiveLatency(playerRef.current?.liveLatency ?? 0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isLive, playerReady, playerRef]);

  useEffect(() => {
    if (isLive || !playerReady) return;
    const p = playerRef.current;
    if (!p) return;

    const onDurationChange = () => setDuration(p.duration ?? 0);
    p.on?.("durationchange", onDurationChange);
    p.on?.("loadedmetadata", onDurationChange);
    onDurationChange();

    return () => {
      p.off?.("durationchange", onDurationChange);
      p.off?.("loadedmetadata", onDurationChange);
    };
  }, [playerRef, isLive, playerReady]);

  useEffect(() => {
    if (isLive || !playerReady) return;
    const p = playerRef.current;
    if (!p) return;
    let timerId = 0;

    // Player chrome does not need a display-rate update loop. Four updates a
    // second remain visually smooth while avoiding a React render per frame.
    const tick = () => {
      if (!seeking.current) {
        const t = (p.video ?? p.media)?.currentTime ?? p.currentTime ?? 0;
        setCurrentTime(t);
      }
    };
    tick();
    timerId = window.setInterval(tick, 250);
    return () => {
      window.clearInterval(timerId);
    };
  }, [playerRef, isLive, playerReady]);

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = Number(e.target.value);
      setCurrentTime(t);
      const p = playerRef.current;
      if (p?.seek) p.seek(t);
      else if (p) p.currentTime = t;
    },
    [playerRef],
  );

  if (isLive) {
    // Only count as "off the live edge" once we are >3s behind. The threshold
    // is more than a copy switch: seekToLiveEdge() sets currentTime to
    // buffered.end(last), i.e. the very end of the buffer. Jumping there when
    // we are only half a second behind means playing flush against the buffer
    // edge, which rebuffers immediately. So the click is only enabled when we
    // are genuinely behind.
    const behindLive = liveLatency > 3;
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => playerRef.current?.seekToLiveEdge?.()}
          disabled={!behindLive}
          // The label stays "Live" — it does not swap to "back to live" when
          // behind. This chip is a status indicator, and a label that grows and
          // shrinks would shove the adjacent progress bar around. Being behind
          // is conveyed through three channels that do not affect layout: the
          // disabled state, the cursor, and aria-label / title (screen readers
          // and hover still announce "behind by Ns").
          //
          // ⚠️ cursor-pointer is not decoration: Tailwind v4's preflight sets
          // `cursor: default` on button, so the disabled:cursor-default below
          // would otherwise be a no-op. With cursor-pointer added, "clickable
          // or not" finally reads as different.
          //
          // Fixed 20px height: this is a status chip, not a control — it
          // follows the progress row's type scale rather than the 36px control
          // row. leading-none keeps the box height driven by h-5 alone instead
          // of text-xs's 18px line box.
          // ⚠️ h-5 must be explicit: globals.css once carried an unlayered
          // `button, input { font: inherit }` that collapsed text-xs to the
          // inherited 14px, growing the badge to 29px. Removed since, and
          // guarded by check:tokens' UNLAYERED_FORM_FONT.
          className="shrink-0 inline-flex h-5 items-center gap-1 rounded-xs bg-live px-2 text-xs leading-none font-semibold tracking-caps text-live-foreground uppercase cursor-pointer disabled:cursor-default"
          aria-label={
            behindLive ? `落后直播约 ${Math.round(liveLatency)} 秒，点击回到直播` : "直播中"
          }
          title={behindLive ? "回到直播" : "直播中"}
        >
          <Radio size={12} strokeWidth={2.5} />
          Live
        </button>
        <div className="flex-1 h-1 rounded-full overflow-hidden bg-stage-surface">
          <div
            className="h-full rounded-full bg-stage-fg-2 transition-[width] duration-250"
            style={{ width: behindLive ? "82%" : "100%" }}
          />
        </div>
      </div>
    );
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 tabular-nums text-xs text-stage-fg-3">{fmtTime(currentTime)}</span>
      <input
        type="range"
        min={0}
        max={duration || 100}
        step={1}
        value={currentTime}
        onPointerDown={(event) => {
          seeking.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          seeking.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={() => {
          seeking.current = false;
        }}
        onChange={handleSeek}
        aria-label="播放进度"
        className="vol-slider flex-1"
        style={{
          background: `linear-gradient(90deg, oklch(96% 0.004 250 / 0.75) ${progress}%, oklch(96% 0.004 250 / 0.15) ${progress}%)`,
        }}
      />
      <span className="shrink-0 tabular-nums text-xs text-stage-fg-4">{fmtTime(duration)}</span>
    </div>
  );
}
