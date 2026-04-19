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

  if (room && !room.isLive) {
    return {
      title: "主播当前未开播",
      hint: "可稍后重试，或从关注页查看其他开播房间",
      tone: "offline",
    };
  }

  if (isOfflineError(message)) {
    return {
      title: "主播当前未开播",
      hint: "这不是播放故障，等主播开播后再试",
      tone: "offline",
    };
  }

  if (allFailed) {
    return {
      title: "播放线路不可用",
      hint: "已尝试当前房间的播放源，可重试或外部打开",
      tone: "error",
    };
  }

  if (streamQuery.isSuccess && sources.length === 0) {
    return {
      title: "暂无可用播放源",
      hint: "房间存在，但平台没有返回可播放地址",
      tone: "error",
    };
  }

  if (isNoSourceError(message)) {
    return {
      title: "暂无可用播放源",
      hint: "平台没有返回可播放地址，可稍后重试",
      tone: "error",
    };
  }

  if (isPlatformLimitError(message)) {
    return {
      title: "平台限制了播放",
      hint: "可能需要登录、权限或更换线路，可尝试外部打开",
      tone: "error",
    };
  }

  if (isNetworkError(message)) {
    return {
      title: "网络连接失败",
      hint: "请检查网络或代理设置后重试",
      tone: "error",
    };
  }

  return {
    title: "暂时无法播放",
    hint: "可重试，或在平台网页中打开确认房间状态",
    tone: "error",
  };
}
