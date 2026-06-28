/**
 * Platform helpers — macOS gets native decorations (traffic lights), Windows
 * keeps the custom window controls. Detected once at module load.
 */

import { platform as osPlatform } from "@tauri-apps/plugin-os";

export type OsPlatform = "macos" | "windows" | "linux" | "unknown";

function detect(): OsPlatform {
  try {
    const p = osPlatform();
    if (p === "macos" || p === "windows" || p === "linux") return p;
    return "unknown";
  } catch {
    return "unknown";
  }
}

export const os = detect();

/** macOS uses native traffic lights — hide custom window buttons. */
export const isMac = os === "macos";
/** Windows/Linux keep the custom window controls. */
export const isWinLike = os === "windows" || os === "linux";
