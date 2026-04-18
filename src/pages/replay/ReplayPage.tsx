/**
 * ReplayPage  —  /replay/:platform/:roomId
 *
 * Full-screen replay viewer:
 *   Left  (flex-1): xgplayer VOD player
 *   Right (w-72):   scrollable session / part list
 */

import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Clock, Eye, Film, PlayCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { PlayerQualityItem } from "@/features/player/ui/VideoPlayer";
import { VideoPlayer } from "@/features/player/ui/VideoPlayer";
import { cn } from "@/lib/utils";
import {
  getBilibiliCookie,
  getReplayList,
  getReplayParts,
  getReplayQualities,
  getRoomDetail,
  setBilibiliSessdata,
} from "@/shared/api/commands";
import { fmtDate, fmtDuration } from "@/shared/lib/dom";
import { isPlatform } from "@/shared/lib/platform";
import type { PlatformId, ReplayItem, ReplayQuality } from "@/shared/types/domain";

// ── PartRow ───────────────────────────────────────────────────────────────────

function PartRow({
  part,
  active,
  onPlay,
}: {
  part: ReplayItem;
  active: boolean;
  onPlay: (item: ReplayItem) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPlay(part)}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors",
        active
          ? "bg-primary/12 text-primary"
          : "hover:bg-accent/70 text-foreground/75 hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "shrink-0 w-5 text-center text-[10px] font-semibold",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        P{part.partNum}
      </span>
      <span className="flex-1 truncate text-xs">{part.showRemark || part.title}</span>
      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
        {fmtDuration(part.durationStr)}
      </span>
    </button>
  );
}

// ── SessionRow ────────────────────────────────────────────────────────────────

function SessionRow({
  session,
  expanded,
  parts,
  partsLoading,
  activeId,
  onToggle,
  onPlay,
}: {
  session: ReplayItem;
  expanded: boolean;
  parts?: ReplayItem[];
  partsLoading: boolean;
  activeId: string | null;
  onToggle: () => void;
  onPlay: (item: ReplayItem) => void;
}) {
  const hasParts = session.totalParts > 1;

  return (
    <div>
      <button
        type="button"
        onClick={hasParts ? onToggle : () => onPlay(session)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors group",
          !hasParts && activeId === session.id ? "bg-primary/12" : "hover:bg-accent/60",
        )}
      >
        {/* Cover */}
        {session.coverUrl ? (
          <img
            src={session.coverUrl}
            alt=""
            className="h-10 w-18 shrink-0 rounded object-cover bg-muted"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-18 shrink-0 rounded bg-muted flex items-center justify-center">
            <Film size={14} className="text-muted-foreground/30" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[12px] font-medium leading-tight">{session.title}</span>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            {session.recordedAt > 0 && <span>{fmtDate(session.recordedAt)}</span>}
            {session.durationStr && (
              <span className="flex items-center gap-0.5">
                <Clock size={9} />
                {fmtDuration(session.durationStr)}
              </span>
            )}
            {session.viewCountText && (
              <span className="flex items-center gap-0.5">
                <Eye size={9} />
                {session.viewCountText}
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1">
          {hasParts && (
            <span className="text-[9px] tabular-nums text-muted-foreground bg-muted rounded px-1 py-0.5">
              {session.totalParts}P
            </span>
          )}
          <ChevronRight
            size={12}
            className={cn(
              "text-muted-foreground/40 transition-transform duration-150",
              expanded && "rotate-90",
            )}
          />
        </div>
      </button>

      {/* Expanded parts */}
      {hasParts && expanded && (
        <div className="ml-2 mt-0.5 mb-1 border-l border-border/40 pl-2">
          {partsLoading ? (
            <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground animate-pulse">
              加载中…
            </div>
          ) : (
            parts?.map((part) => (
              <PartRow key={part.id} part={part} active={activeId === part.id} onPlay={onPlay} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── ReplayList sidebar ────────────────────────────────────────────────────────

const PAGE_SIZE = 12;

function ReplayList({
  platform,
  roomId,
  activeId,
  onPlay,
  onAuthRequired,
}: {
  platform: PlatformId;
  roomId: string;
  activeId: string | null;
  onPlay: (item: ReplayItem) => void;
  onAuthRequired?: (message: string) => void;
}) {
  const [expandedShowId, setExpandedShowId] = useState<number | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Infinite query — each page returns up to PAGE_SIZE sessions
  const infinite = useInfiniteQuery({
    queryKey: ["replay-list-inf", platform, roomId],
    queryFn: async ({ pageParam }) => {
      try {
        return await getReplayList(platform, roomId, pageParam as number);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          platform === "bilibili" &&
          (msg.includes("请先") || msg.includes("登录") || msg.includes("授权"))
        ) {
          onAuthRequired?.(msg);
        }
        throw err;
      }
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === PAGE_SIZE ? allPages.length + 1 : undefined,
    staleTime: 60_000,
  });

  // Flatten all pages into a single session array
  const sessions = infinite.data?.pages.flat() ?? [];

  // IntersectionObserver: auto-fetch next page when sentinel enters viewport
  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && infinite.hasNextPage && !infinite.isFetchingNextPage) {
          void infinite.fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [infinite]);

  // Parts for the currently expanded session
  const expandedSession = sessions.find((s) => s.showId === expandedShowId);
  const partsQuery = useQuery({
    queryKey: ["replay-parts", platform, roomId, expandedShowId],
    queryFn: () =>
      expandedSession
        ? getReplayParts(platform, roomId, expandedSession.id, expandedSession.upId)
        : Promise.resolve([]),
    enabled: expandedShowId !== null && !!expandedSession,
    staleTime: 120_000,
  });

  // Initial loading skeleton
  if (infinite.isLoading) {
    return (
      <div className="flex flex-col gap-1.5 p-2">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
          <div key={i} className="flex gap-2.5 rounded-lg px-2.5 py-2">
            <div className="h-10 w-18  rounded bg-muted animate-pulse shrink-0" />
            <div className="flex flex-col gap-1.5 flex-1 pt-0.5">
              <div className="h-3 w-4/5 rounded bg-muted animate-pulse" />
              <div className="h-2 w-2/5 rounded bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!sessions.length) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
        <PlayCircle size={32} strokeWidth={1.2} className="opacity-25" />
        <span className="text-xs">暂无回放录像</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 p-2">
      {sessions.map((session) => {
        const isExpanded = expandedShowId === session.showId;
        return (
          <SessionRow
            key={session.id}
            session={session}
            expanded={isExpanded}
            parts={isExpanded ? partsQuery.data : undefined}
            partsLoading={isExpanded && partsQuery.isLoading}
            activeId={activeId}
            onToggle={() =>
              setExpandedShowId((prev) => (prev === session.showId ? null : session.showId))
            }
            onPlay={onPlay}
          />
        );
      })}

      {/* Sentinel + load-more indicator */}
      <div ref={loadMoreRef} className="py-2 flex justify-center">
        {infinite.isFetchingNextPage ? (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground animate-pulse">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground/70" />
            加载更多…
          </div>
        ) : infinite.hasNextPage ? (
          <button
            type="button"
            onClick={() => void infinite.fetchNextPage()}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            加载更多
          </button>
        ) : sessions.length > PAGE_SIZE ? (
          <span className="text-[10px] text-muted-foreground/50">
            已加载全部 {sessions.length} 场录播
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ── ReplayPage ────────────────────────────────────────────────────────────────

export function ReplayPage() {
  const params = useParams();
  const navigate = useNavigate();
  const platform = params.platform;
  const roomId = params.roomId;

  const [activeItem, setActiveItem] = useState<ReplayItem | null>(null);
  const [qualities, setQualities] = useState<ReplayQuality[]>([]);
  const [selectedQualityId, setSelectedQualityId] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [sessdataInput, setSessdataInput] = useState("");
  const [sessdataSubmitting, setSessdataSubmitting] = useState(false);
  const [autoExtracting, setAutoExtracting] = useState(false);

  const queryClient = useQueryClient();

  const handleSessdataSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const val = sessdataInput.trim();
      if (!val) return;
      setSessdataSubmitting(true);
      try {
        await setBilibiliSessdata(val);
        setAuthMessage(null);
        setSessdataInput("");
        await queryClient.invalidateQueries({ queryKey: ["replay-list-inf", platform, roomId] });
      } catch {
        setAuthMessage("保存失败，请检查 SESSDATA 是否正确");
      } finally {
        setSessdataSubmitting(false);
      }
    },
    [sessdataInput, platform, roomId, queryClient],
  );

  // Automatically extract cookies from the app's WebView (no manual copy-paste needed).
  const handleAutoExtract = useCallback(async () => {
    setAutoExtracting(true);
    try {
      const result = await getBilibiliCookie();
      if (result.cookie) {
        await setBilibiliSessdata(result.cookie);
        setAuthMessage(null);
        await queryClient.invalidateQueries({ queryKey: ["replay-list-inf", platform, roomId] });
      } else {
        setAuthMessage(
          result.hasSessdata
            ? "Cookie 提取成功，但未包含 SESSDATA，请确保已登录 bilibili.com"
            : "无法提取 Cookie，请确认已安装并启用 WebView2",
        );
      }
    } catch {
      setAuthMessage("提取失败，请尝试手动输入 SESSDATA");
    } finally {
      setAutoExtracting(false);
    }
  }, [platform, roomId, queryClient]);

  const roomQuery = useQuery({
    queryKey: ["room-detail", platform, roomId],
    queryFn: () => getRoomDetail(platform as PlatformId, roomId as string),
    enabled: isPlatform(platform) && !!roomId,
  });

  const room = roomQuery.data;

  // Fetch all quality options when user selects a segment
  const handlePlay = useCallback(async (item: ReplayItem) => {
    setActiveItem(item);
    setQualities([]);
    setSelectedQualityId(null);
    setUrlError(null);
    setUrlLoading(true);
    try {
      const qs = await getReplayQualities(item.platform, item.id);
      setQualities(qs);
      if (qs.length > 0) setSelectedQualityId(qs[0].name);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        item.platform === "bilibili" &&
        (msg.includes("请先") || msg.includes("登录") || msg.includes("授权"))
      ) {
        setAuthMessage(msg);
        setUrlError(null);
      } else {
        setUrlError(msg);
      }
    } finally {
      setUrlLoading(false);
    }
  }, []);

  // Map ReplayQuality[] → PlayerQualityItem[] for VideoPlayer
  const qualityItems: PlayerQualityItem[] = qualities.map((q) => ({
    id: q.name,
    label: q.name,
  }));
  const streamUrl = qualities.find((q) => q.name === selectedQualityId)?.url ?? null;

  if (!isPlatform(platform) || !roomId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        无效的回放链接
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-border/60 bg-card px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => navigate(-1)}
          className="-ml-1 shrink-0"
        >
          <ArrowLeft size={15} />
        </Button>

        <Film size={13} className="text-muted-foreground shrink-0" />

        <div className="min-w-0 flex-1">
          {roomQuery.isLoading ? (
            <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
          ) : (
            <span className="truncate text-sm font-medium">
              {room?.streamerName ?? roomId}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">的直播录像</span>
            </span>
          )}
        </div>

        {/* Currently playing */}
        {activeItem && (
          <span className="hidden sm:block truncate max-w-55 text-[11px] text-muted-foreground">
            {activeItem.showRemark || activeItem.title}
          </span>
        )}
      </div>

      {/* ── Main area ── */}
      <div className="flex min-h-0 flex-1">
        {/* ── Video player (left / center) ── */}
        <div className="flex flex-1 min-w-0 flex-col bg-black">
          {/*
           * Player area: always rendered as a "player-stage" block so the
           * height is consistent whether a stream is playing or not.
           * The placeholder states use the same min-height via the CSS class.
           */}
          <div className="relative flex-1 min-h-0 player-stage rounded-none">
            {streamUrl ? (
              <VideoPlayer
                streamUrl={streamUrl}
                isLive={false}
                qualities={qualityItems}
                selectedQualityId={selectedQualityId}
                onQualityChange={setSelectedQualityId}
              />
            ) : (
              /* Empty / loading / error — same container, no height jump */
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 transition-opacity duration-200">
                {urlLoading ? (
                  <>
                    <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />
                    <span className="text-xs text-white/50">加载回放地址…</span>
                  </>
                ) : urlError ? (
                  <>
                    <span className="text-sm text-red-400">{urlError}</span>
                    {activeItem && (
                      <button
                        type="button"
                        onClick={() => handlePlay(activeItem)}
                        className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/60 hover:text-white transition-colors"
                      >
                        重试
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <Film size={48} strokeWidth={1.2} className="text-white/20" />
                    <p className="text-sm text-white/35">从右侧选择一段录播开始播放</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Now-playing info bar */}
          {activeItem && (
            <div className="shrink-0 border-t border-white/8 bg-[#0a0c0e] px-4 py-2 flex items-center gap-3">
              <span className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[10px] font-semibold text-white/55 tabular-nums">
                P{activeItem.partNum}
                {activeItem.totalParts > 1 && `/${activeItem.totalParts}`}
              </span>
              <span className="flex-1 truncate text-xs text-white/70">{activeItem.title}</span>
              {activeItem.durationStr && (
                <span className="shrink-0 text-[11px] tabular-nums text-white/40">
                  {fmtDuration(activeItem.durationStr)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Replay list (right sidebar) ── */}
        <aside className="flex w-72 shrink-0 flex-col border-l border-border/60 bg-card">
          {/* Sidebar header */}
          <div className="shrink-0 border-b border-border/50 px-3 py-2.5 flex items-center justify-between">
            <span className="text-xs font-semibold">直播录像</span>
            {roomQuery.data && (
              <span className="text-[10px] text-muted-foreground">
                {roomQuery.data.streamerName}
              </span>
            )}
          </div>

          {authMessage && platform === "bilibili" && (
            <div className="shrink-0 border-b border-border/50 bg-destructive/8 px-3 py-3">
              <p className="mb-2 text-xs text-destructive/90">{authMessage}</p>

              {/* Auto-extract from WebView */}
              <button
                type="button"
                onClick={() => void handleAutoExtract()}
                disabled={autoExtracting}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive/80 transition-colors hover:border-destructive/50 hover:bg-destructive/15 disabled:opacity-50"
              >
                {autoExtracting ? (
                  <>
                    <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                    正在提取…
                  </>
                ) : (
                  "从浏览器自动提取登录状态"
                )}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/40" />
                </div>
                <div className="relative flex justify-center text-[9px] uppercase tracking-wide text-muted-foreground/60">
                  <span className="bg-card px-1.5">或手动输入</span>
                </div>
              </div>

              <form
                onSubmit={(e) => void handleSessdataSubmit(e)}
                className="mt-2 flex flex-col gap-1.5"
              >
                <input
                  type="text"
                  value={sessdataInput}
                  onChange={(e) => setSessdataInput(e.target.value)}
                  placeholder="粘贴 SESSDATA"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    className="h-6 text-[11px]"
                    disabled={sessdataSubmitting || !sessdataInput.trim()}
                  >
                    {sessdataSubmitting ? "保存中…" : "保存并刷新"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setAuthMessage(null)}
                    className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    关闭
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  如何获取？登录 bilibili.com 后，F12 → Application → Cookies → 找到 SESSDATA 复制其
                  Value。
                </p>
              </form>
            </div>
          )}

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            <ReplayList
              platform={platform}
              roomId={roomId}
              activeId={activeItem?.id ?? null}
              onPlay={handlePlay}
              onAuthRequired={(msg) => setAuthMessage(msg)}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
