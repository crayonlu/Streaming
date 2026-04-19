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
  const seeking = useRef(false);

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
    let rafId = 0;
    const tick = () => {
      if (!seeking.current) {
        const t = (p.video ?? p.media)?.currentTime ?? p.currentTime ?? 0;
        setCurrentTime(t);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
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
    return (
      <div className="flex items-center gap-2">
        <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-live px-1.5 py-0.5 text-[9px] font-semibold tracking-widest text-white uppercase">
          <Radio size={7} strokeWidth={2.5} />
          Live
        </span>
        <div className="flex-1 h-0.75 rounded-full overflow-hidden bg-white/15">
          <div className="h-full w-full rounded-full bg-white/55" />
        </div>
      </div>
    );
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 tabular-nums text-[10px] text-white/55">
        {fmtTime(currentTime)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 100}
        step={1}
        value={currentTime}
        onMouseDown={() => {
          seeking.current = true;
        }}
        onMouseUp={() => {
          seeking.current = false;
        }}
        onChange={handleSeek}
        aria-label="播放进度"
        className="vol-slider flex-1"
        style={{
          background: `linear-gradient(90deg, rgba(255,255,255,0.75) ${progress}%, rgba(255,255,255,0.15) ${progress}%)`,
        }}
      />
      <span className="shrink-0 tabular-nums text-[10px] text-white/40">{fmtTime(duration)}</span>
    </div>
  );
}
