/**
 * UI copy.
 *
 * `zh` defines the shape and `en` must match it exactly — TypeScript checks
 * that — so adding a string in one language fails the build until the other
 * has it too. `{name}` placeholders are filled in by `fill()`.
 */

export const zh = {
  window: {
    minimize: "最小化",
    fullscreen: "全屏",
    exitFullscreen: "退出全屏",
    close: "关闭",
  },

  nav: {
    main: "主导航",
    discover: "发现",
    search: "搜索",
    follows: "关注",
    settings: "设置",
  },

  theme: {
    toLight: "切换为亮色模式",
    toDark: "切换为暗色模式",
    light: "亮色模式",
    dark: "暗色模式",
    mode: "主题模式",
    modeHint: "选择亮色、暗色或跟随系统设置，立即生效。",
    system: "跟随系统",
    lightOption: "亮色",
    darkOption: "暗色",
  },

  language: {
    label: "界面语言",
    hint: "默认跟随系统语言，非中文系统显示英文",
    system: "跟随系统",
    zh: "简体中文",
    en: "English",
  },

  common: {
    retry: "重试",
    back: "返回",
    loading: "加载中",
    loadingDots: "加载中…",
    loadMore: "加载更多",
    loadMoreDots: "加载更多…",
    save: "保存",
    saving: "保存中…",
    saved: "已保存",
    saveFailed: "保存失败，请重试",
    loadFailed: "加载失败",
    readFailed: "读取失败",
    tryLater: "请稍后重试",
    externalOpen: "外部打开",
    recover: "尝试恢复",
    refreshLiveStatus: "刷新直播状态",
    clickToRetry: "点击重试",
  },

  error: {
    title: "应用出现意外错误",
    description: "请重启应用，若问题持续请反馈。",
  },

  route: {
    playerLoading: "播放器加载中",
    replayLoading: "录播加载中",
    pageNotFound: "页面不存在",
    pageNotFoundHint: "请检查地址是否正确",
    invalidPlayerLink: "无效的播放链接",
    invalidReplayLink: "无效的回放链接",
  },

  onboarding: {
    welcome: "欢迎使用 Streaming",
    intro: "一个入口，同时浏览三个平台的直播。",
    pickPlatform: "选择你常看的平台",
    start: "开始使用",
    footnote: "支持 Bilibili · 斗鱼 · 虎牙 · 随时可在设置中更改",
    bilibiliTagline: "游戏 · 虚拟 · 综合",
    douyuTagline: "游戏 · 体育 · 综艺",
    huyaTagline: "游戏 · 电竞 · 娱乐",
  },

  platform: {
    bilibili: "Bilibili",
    douyu: "斗鱼",
    huya: "虎牙",
  },

  discover: {
    title: "发现",
    lastWatched: "上次观看",
    resume: "继续",
    loadedAll: "已加载全部内容",
    emptyTitle: "暂无内容",
    emptyDescription: "可切换平台或稍后刷新",
  },

  search: {
    title: "搜索",
    all: "全部",
    emptyPrompt: "输入关键词开始搜索",
    failed: "搜索失败",
    noResults: `"{keyword}" 无结果`,
    noResultsHint: "换个关键词试试",
    loadedAll: "已加载全部结果",
  },

  follows: {
    title: "关注",
    emptyTitle: "暂无关注",
    emptyDescription: "在发现或搜索页点击 ♥",
  },

  globalSearch: {
    placeholder: "搜索直播间…",
    label: "搜索直播间",
    submit: `搜索 "{keyword}"`,
    history: "搜索历史",
    removeHistory: `删除 "{keyword}"`,
  },

  category: {
    featured: "推荐",
    collapse: "收起",
    more: "更多",
  },

  roomCard: {
    noCover: "暂无封面",
  },

  follow: {
    follow: "关注",
    unfollow: "取消关注",
    following: "已关注",
  },

  danmaku: {
    section: "弹幕",
    opacity: "不透明度",
    opacityLabel: "弹幕不透明度",
    fontSize: "字号",
    sizeSmall: "小",
    sizeMedium: "中",
    sizeLarge: "大",
    screenQuarter: "1/4 屏",
    screenHalf: "1/2 屏",
    screenThreeQuarter: "3/4 屏",
    screenFull: "全屏",
    onHint: "弹幕覆盖 {area}，点击{action}",
    offHint: "弹幕已关闭，点击开启（覆盖 {area}）",
    switchTo: "切到 {area}",
    turnOff: "关闭弹幕",
    toggleTitle: "{area}（D 键开关）",
  },

  player: {
    videoPlayer: "视频播放器",
    playbackProgress: "播放进度",
    volume: "音量",
    play: "播放",
    pause: "暂停",
    pauseBuffering: "暂停，正在缓冲",
    bufferingPause: "正在缓冲，点击暂停",
    mute: "静音",
    unmute: "取消静音",
    fullscreen: "全屏",
    exitFullscreen: "退出全屏",
    keySpace: "（空格）",
    keyMute: "（M）",
    keyFullscreen: "（F）",
    quality: "画质",
    qualityNext: "切换画质：当前 {current}，下一档 {next}",
    qualityOnly: "切换画质：当前 {current}，暂无其他画质",
    backToLive: "回到直播",
    behindLive: "落后直播约 {seconds} 秒，点击回到直播",
    resyncLive: "拉流，回到直播",
    behindLiveResync: "落后约 {seconds} 秒，点击拉流回到直播",
    networkLost: "网络已断开 · 等待重连",
    noDecoder: "当前系统缺少视频解码器，无法播放",
    noDecoderLinux: "请安装 gstreamer1.0-libav、gstreamer1.0-plugins-bad 后重启应用",
    noDecoderOther: "请检查系统或 WebView 的解码组件安装情况",
    recovering: "播放失败 · 正在尝试恢复",
    hevcHint: "当前系统可能缺少 HEVC 解码支持（Windows 请安装「HEVC 视频扩展」）",
    live: "直播中",
    carousel: "轮播回放",
    viewers: "{count} 人在看",
    loginBilibili: "登录Bilibili",
    loggingIn: "登录中…",
    loggedIn: "已登录",
    viewReplay: "查看录播",
    offlineHint: "主播当前未开播，可查看历史录播",
    recoveringAttempt: "播放失败 · 正在重新拉流（第 {attempt} 次）",
    fetchingSource: "获取播放源…",
  },

  replay: {
    title: "直播录像",
    ofStreamer: "的直播录像",
    showList: "显示回放列表",
    hideList: "隐藏回放列表",
    loadingUrl: "加载回放地址…",
    loadFailed: "无法加载回放",
    empty: "暂无回放录像",
    pickOne: "从右侧选择一段录播开始播放",
    watched: "已看完",
    continueWatching: "继续观看 {percent}%",
    finished: "已播完",
    autoPlayPaused: "已暂停自动连播",
    lastPart: "最后一段",
    restart: "重播",
    loadedAll: "已加载全部 {count} 场录播",
    unavailable: {
      bilibili: "B站回放不面向普通观众开放",
      huya: "虎牙暂不提供完整直播回放",
      other: "当前平台暂不支持回放",
    },
  },

  playbackStatus: {
    offline: {
      title: "主播当前未开播",
      hint: "可稍后重试，或从关注页查看其他开播房间",
    },
    offlineEnded: {
      title: "主播当前未开播",
      hint: "这不是播放故障，等主播开播后再试",
    },
    lineUnavailable: {
      title: "播放线路不可用",
      hint: "已尝试当前房间的播放源，可重试或外部打开",
    },
    noSource: {
      title: "暂无可用播放源",
      hint: "房间存在，但平台没有返回可播放地址",
    },
    noSourceRetry: {
      title: "暂无可用播放源",
      hint: "平台没有返回可播放地址，可稍后重试",
    },
    restricted: {
      title: "平台限制了播放",
      hint: "可能需要登录、权限或更换线路，可尝试外部打开",
    },
    network: {
      title: "网络连接失败",
      hint: "请检查网络或代理设置后重试",
    },
    unknown: {
      title: "暂时无法播放",
      hint: "可重试，或在平台网页中打开确认房间状态",
    },
  },

  settings: {
    title: "设置",
    viewing: "观看偏好",
    defaultPlatform: "默认平台",
    defaultPlatformHint: "启动时默认浏览的平台",
    resumeLastSession: "恢复上次浏览",
    resumeLastSessionHint: "启动时显示继续上次观看的提示",
    autoPlayNextReplay: "回放自动连播",
    autoPlayNextReplayHint: "一段录像结束后自动播放下一段",
    appearance: "外观",
    network: "网络",
    proxy: "代理设置",
    proxyHint: "影响直播封面、搜索等所有后台请求。切换后立即生效，无需重启。",
    proxyNone: "不代理",
    proxyNoneHint: "直接连接，忽略系统代理设置",
    proxySystem: "系统代理",
    proxySystemHint: "使用 OS 或环境变量中的代理配置",
    capabilities: "平台能力说明",
    replayCapability: "直播回放",
    replayCapabilityHint:
      "斗鱼支持全量录像；Bilibili 官方接口不面向普通观众，暂不支持；虎牙公开视频与直播回放不同，暂不支持。",
    supported: "支持 Bilibili · 斗鱼 · 虎牙",
  },
};

export type Dict = typeof zh;

export const en: Dict = {
  window: {
    minimize: "Minimize",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    close: "Close",
  },

  nav: {
    main: "Main navigation",
    discover: "Discover",
    search: "Search",
    follows: "Following",
    settings: "Settings",
  },

  theme: {
    toLight: "Switch to light mode",
    toDark: "Switch to dark mode",
    light: "Light mode",
    dark: "Dark mode",
    mode: "Theme",
    modeHint: "Pick light, dark, or follow the system setting. Applies immediately.",
    system: "System",
    lightOption: "Light",
    darkOption: "Dark",
  },

  language: {
    label: "Language",
    hint: "Follows the system language; English outside Chinese locales",
    system: "System",
    zh: "Chinese (Simplified)",
    en: "English",
  },

  common: {
    retry: "Retry",
    back: "Back",
    loading: "Loading",
    loadingDots: "Loading…",
    loadMore: "Load more",
    loadMoreDots: "Loading more…",
    save: "Save",
    saving: "Saving…",
    saved: "Saved",
    saveFailed: "Could not save, please retry",
    loadFailed: "Could not load",
    readFailed: "Could not read settings",
    tryLater: "Please try again later",
    externalOpen: "Open in browser",
    recover: "Try to recover",
    refreshLiveStatus: "Refresh live status",
    clickToRetry: "Click to retry",
  },

  error: {
    title: "Something went wrong",
    description: "Restart the app; if it keeps happening, please report it.",
  },

  route: {
    playerLoading: "Loading player",
    replayLoading: "Loading replays",
    pageNotFound: "Page not found",
    pageNotFoundHint: "Check that the address is correct",
    invalidPlayerLink: "Invalid stream link",
    invalidReplayLink: "Invalid replay link",
  },

  onboarding: {
    welcome: "Welcome to Streaming",
    intro: "One place to watch live streams from all three platforms.",
    pickPlatform: "Pick the platform you watch most",
    start: "Get started",
    footnote: "Bilibili · Douyu · Huya — change this in Settings any time",
    bilibiliTagline: "Games · Virtual · General",
    douyuTagline: "Games · Sports · Variety",
    huyaTagline: "Games · Esports · Entertainment",
  },

  platform: {
    bilibili: "Bilibili",
    douyu: "Douyu",
    huya: "Huya",
  },

  discover: {
    title: "Discover",
    lastWatched: "Last watched",
    resume: "Resume",
    loadedAll: "That is everything",
    emptyTitle: "Nothing here yet",
    emptyDescription: "Switch platform, or refresh in a moment",
  },

  search: {
    title: "Search",
    all: "All",
    emptyPrompt: "Type a keyword to search",
    failed: "Search failed",
    noResults: `No results for "{keyword}"`,
    noResultsHint: "Try a different keyword",
    loadedAll: "That is every result",
  },

  follows: {
    title: "Following",
    emptyTitle: "Not following anything yet",
    emptyDescription: "Tap ♥ on the Discover or Search page",
  },

  globalSearch: {
    placeholder: "Search live rooms…",
    label: "Search live rooms",
    submit: `Search "{keyword}"`,
    history: "Recent searches",
    removeHistory: `Remove "{keyword}"`,
  },

  category: {
    featured: "Featured",
    collapse: "Collapse",
    more: "More",
  },

  roomCard: {
    noCover: "No cover",
  },

  follow: {
    follow: "Follow",
    unfollow: "Unfollow",
    following: "Following",
  },

  danmaku: {
    section: "Danmaku",
    opacity: "Opacity",
    opacityLabel: "Danmaku opacity",
    fontSize: "Text size",
    sizeSmall: "S",
    sizeMedium: "M",
    sizeLarge: "L",
    screenQuarter: "1/4 screen",
    screenHalf: "1/2 screen",
    screenThreeQuarter: "3/4 screen",
    screenFull: "Full screen",
    onHint: "Danmaku covers {area}; click to {action}",
    offHint: "Danmaku is off; click to turn it on (covers {area})",
    switchTo: "switch to {area}",
    turnOff: "turn them off",
    toggleTitle: "{area} (D to toggle)",
  },

  player: {
    videoPlayer: "Video player",
    playbackProgress: "Playback progress",
    volume: "Volume",
    play: "Play",
    pause: "Pause",
    pauseBuffering: "Pause, buffering",
    bufferingPause: "Buffering, click to pause",
    mute: "Mute",
    unmute: "Unmute",
    fullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    keySpace: " (Space)",
    keyMute: " (M)",
    keyFullscreen: " (F)",
    quality: "Quality",
    qualityNext: "Change quality: {current} now, {next} next",
    qualityOnly: "Change quality: {current} now, no other option",
    backToLive: "Back to live",
    behindLive: "About {seconds}s behind live; click to jump back",
    resyncLive: "Re-sync to live",
    behindLiveResync: "About {seconds}s behind; click to re-sync to live",
    networkLost: "Network lost · waiting to reconnect",
    noDecoder: "This system has no video decoder, so playback is unavailable",
    noDecoderLinux: "Install gstreamer1.0-libav and gstreamer1.0-plugins-bad, then restart",
    noDecoderOther: "Check the decoder components of your system or WebView",
    recovering: "Playback failed · trying to recover",
    hevcHint: 'This system may lack HEVC decoding (on Windows, install "HEVC Video Extensions")',
    live: "Live",
    carousel: "Carousel replay",
    viewers: "{count} watching",
    loginBilibili: "Log in to Bilibili",
    loggingIn: "Logging in…",
    loggedIn: "Logged in",
    viewReplay: "View replays",
    offlineHint: "The streamer is offline; past recordings are available",
    recoveringAttempt: "Playback failed · re-syncing (attempt {attempt})",
    fetchingSource: "Fetching stream…",
  },

  replay: {
    title: "Recordings",
    ofStreamer: " recordings",
    showList: "Show recording list",
    hideList: "Hide recording list",
    loadingUrl: "Loading replay address…",
    loadFailed: "Could not load recordings",
    empty: "No recordings yet",
    pickOne: "Pick a recording on the right to start playing",
    watched: "Watched",
    continueWatching: "Continue at {percent}%",
    finished: "Finished",
    autoPlayPaused: "Auto-play paused",
    lastPart: "Last part",
    restart: "Replay",
    loadedAll: "All {count} recordings loaded",
    unavailable: {
      bilibili: "Bilibili replays are not open to regular viewers",
      huya: "Huya does not provide full live replays yet",
      other: "This platform does not support replays yet",
    },
  },

  playbackStatus: {
    offline: {
      title: "The streamer is offline",
      hint: "Try again later, or check the Following page for other live rooms",
    },
    offlineEnded: {
      title: "The streamer is offline",
      hint: "This is not a playback problem; try again once the stream starts",
    },
    lineUnavailable: {
      title: "This stream line is unavailable",
      hint: "Every source for this room was tried; retry or open it in a browser",
    },
    noSource: {
      title: "No playable source",
      hint: "The room exists, but the platform returned no playable address",
    },
    noSourceRetry: {
      title: "No playable source",
      hint: "The platform returned no playable address; try again later",
    },
    restricted: {
      title: "The platform blocked playback",
      hint: "It may need a login, permissions, or another line; try opening it in a browser",
    },
    network: {
      title: "Could not reach the network",
      hint: "Check your connection or proxy settings and try again",
    },
    unknown: {
      title: "Cannot play right now",
      hint: "Retry, or open the room's page to check its state",
    },
  },

  settings: {
    title: "Settings",
    viewing: "Viewing",
    defaultPlatform: "Default platform",
    defaultPlatformHint: "The platform shown when the app starts",
    resumeLastSession: "Resume last session",
    resumeLastSessionHint: "Offer to continue where you left off when the app starts",
    autoPlayNextReplay: "Auto-play next recording",
    autoPlayNextReplayHint: "Continue with the next part when one finishes",
    appearance: "Appearance",
    network: "Network",
    proxy: "Proxy",
    proxyHint: "Affects covers, search, and every other background request. Applies immediately.",
    proxyNone: "No proxy",
    proxyNoneHint: "Connect directly, ignoring the system proxy",
    proxySystem: "System proxy",
    proxySystemHint: "Use the proxy configured in the OS or the environment",
    capabilities: "Platform capabilities",
    replayCapability: "Live replays",
    replayCapabilityHint:
      "Douyu keeps every recording. Bilibili's public API is not open to regular viewers, so it is unsupported. Huya publishes videos, not live replays, so it is unsupported too.",
    supported: "Supports Bilibili · Douyu · Huya",
  },
};

export const dictionaries: Record<"zh" | "en", Dict> = { zh, en };
