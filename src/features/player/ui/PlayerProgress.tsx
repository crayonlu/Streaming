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
    // 落后直播 3 秒以上才算「不在直播边缘」。
    // 这个阈值不只是文案开关 —— seekToLiveEdge() 会把 currentTime 设到
    // buffered.end(last)，也就是缓冲区最末端。只落后半秒时跳过去等于贴着
    // 缓冲边缘播，会立刻重新缓冲。所以只有真的落后了才允许点。
    const behindLive = liveLatency > 3;
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => playerRef.current?.seekToLiveEdge?.()}
          disabled={!behindLive}
          // 文案恒定 "Live"：落后时不再换成「回到直播」。理由是这个芯片的角色
          // 是「状态指示」，一旦会变长变短，旁边的进度条就跟着跳。
          // 落后与否改由三个不改变布局的通道表达：禁用态、光标、以及
          // aria-label / title（屏幕阅读器与悬停仍能读到「落后约 N 秒」）。
          //
          // ⚠️ cursor-pointer 不是装饰：Tailwind v4 的 preflight 把 button 定为
          // cursor: default，所以下面那个 disabled:cursor-default 原本是空操作。
          // 补上 cursor-pointer 之后，「可点 / 不可点」才真的有区别。
          //
          // 固定 20px 高：这是状态芯片，不是控件 —— 对齐进度行的字号节奏即可，
          // 别跟着控件行的 36px 走。leading-none 让盒高只由 h-5 决定，不再受
          // text-xs 的 18px 行盒影响。
          // ⚠️ 这里必须显式写 h-5：globals.css 曾有一条未分层的
          // `button, input { font: inherit }`，把 text-xs 压成了继承的 14px，
          // 徽章于是长到 29px。已删，并由 check:tokens 的 UNLAYERED_FORM_FONT 守着。
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
      <span className="shrink-0 tabular-nums text-xs text-stage-fg-3">
        {fmtTime(currentTime)}
      </span>
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
