import { strings } from "@/shared/i18n";
import type { RoomDetail, StreamSource } from "@/shared/types/domain";

type QueryLike = {
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
};

export interface PlaybackStatus {
  title: string;
  hint: string;
  tone: "error" | "offline";
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "");
}

function isOfflineError(message: string) {
  return /未开播|下播|offline|not\s*live/i.test(message);
}

function isNoSourceError(message: string) {
  return /未获取到可用播放源|暂无可用流|no playable|no available|missing rtmp|清晰度/i.test(
    message,
  );
}

function isNetworkError(message: string) {
  return /network|timeout|timed out|request failed|不可达|检查网络|failed to fetch|BAD_GATEWAY/i.test(
    message,
  );
}

function isPlatformLimitError(message: string) {
  return /风控|权限|登录|cookie|risk|forbidden|403|401|签名/i.test(message);
}

export function getPlaybackStatus(params: {
  room?: RoomDetail;
  sources: StreamSource[];
  detailQuery: QueryLike;
  streamQuery: QueryLike;
  allFailed: boolean;
}): PlaybackStatus {
  const { room, sources, detailQuery, streamQuery, allFailed } = params;
  const message = [errorText(detailQuery.error), errorText(streamQuery.error)].join(" ");
  const t = strings().playbackStatus;

  if (room && !room.isLive) {
    return { ...t.offline, tone: "offline" };
  }

  if (isOfflineError(message)) {
    return { ...t.offlineEnded, tone: "offline" };
  }

  if (allFailed) {
    return { ...t.lineUnavailable, tone: "error" };
  }

  if (streamQuery.isSuccess && sources.length === 0) {
    return { ...t.noSource, tone: "error" };
  }

  if (isNoSourceError(message)) {
    return { ...t.noSourceRetry, tone: "error" };
  }

  if (isPlatformLimitError(message)) {
    return { ...t.restricted, tone: "error" };
  }

  if (isNetworkError(message)) {
    return { ...t.network, tone: "error" };
  }

  return { ...t.unknown, tone: "error" };
}
