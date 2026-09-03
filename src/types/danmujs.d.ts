declare module "danmu.js" {
  export interface DanmuCommentStyle {
    fontSize?: string;
    color?: string;
    [key: string]: unknown;
  }

  export interface DanmuComment {
    id: string;
    txt: string;
    duration: number;
    mode: "scroll" | "top" | "bottom";
    style?: DanmuCommentStyle;
  }

  export interface DanmuOptions {
    container: HTMLElement;
    containerStyle?: { zIndex?: number | string };
    player?: HTMLMediaElement;
    comments?: unknown[];
    area?: { start: number; end: number; lines?: number };
    channelSize?: number;
    mouseControl?: boolean;
    mouseControlPause?: boolean;
    bOffset?: number;
    chaseEffect?: boolean;
    defaultOff?: boolean;
  }

  export default class DanmuJs {
    constructor(options: DanmuOptions);
    readonly state?: { bullets?: unknown[]; comments?: unknown[] };
    start(): void;
    stop(): void;
    play(): void;
    pause(): void;
    destroy(): void;
    show(mode?: string): void;
    hide(mode?: string): void;
    clear(): void;
    sendComment(comment: DanmuComment): void;
    setOpacity(opacity: number): void;
    setFontSize(size: number, channelSize?: number): void;
    setArea(area: { start: number; end: number; lines?: number }): void;
    setAllDuration(mode: string, duration: number): void;
  }
}
