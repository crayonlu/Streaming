/**
 * useBilibiliAuth
 *
 * Encapsulates the full B站 Cookie login flow:
 *   1. On mount (when platform === "bilibili"), checks whether SESSDATA is
 *      already stored and sets the initial login state.
 *   2. `login()` opens the B站 login window and polls until SESSDATA arrives
 *      or the 120s deadline elapses.
 *
 * Returns:
 *   loginState  — "idle" | "logging-in" | "logged-in"
 *   login       — call to start the login flow (no-op if already logging in)
 *
 * Usage:
 *   const { loginState, login } = useBilibiliAuth(platform);
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  closeBilibiliLoginWindow,
  getBilibiliCookie,
  openBilibiliLoginWindow,
  setBilibiliSessdata,
} from "@/shared/api/commands";
import type { PlatformId } from "@/shared/types/domain";

export type BilibiliLoginState = "idle" | "logging-in" | "logged-in";

const POLL_INTERVAL_MS = 1500;
const POLL_DEADLINE_MS = 120_000;

export function useBilibiliAuth(platform: PlatformId | string | undefined) {
  const [loginState, setLoginState] = useState<BilibiliLoginState>("idle");
  const loggingInRef = useRef(false);
  // Signals the polling loop to abort when the component unmounts (Q-011).
  const abortedRef = useRef(false);

  useEffect(() => {
    abortedRef.current = false;
    return () => {
      abortedRef.current = true;
    };
  }, []);

  // Check stored cookie on mount / platform change.
  useEffect(() => {
    if (platform !== "bilibili") return;
    void getBilibiliCookie()
      .then((r) => setLoginState(r.hasSessdata ? "logged-in" : "idle"))
      .catch(() => setLoginState("idle"));
  }, [platform]);

  // Open login window and poll until SESSDATA is detected or timeout.
  const login = useCallback(async () => {
    if (platform !== "bilibili") return;
    if (loggingInRef.current) return;
    loggingInRef.current = true;
    setLoginState("logging-in");
    try {
      await openBilibiliLoginWindow();

      const deadline = Date.now() + POLL_DEADLINE_MS;
      while (Date.now() < deadline) {
        await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
        // Stop polling if the component unmounted while we were waiting (Q-011).
        if (abortedRef.current) return;
        const result = await getBilibiliCookie();
        if (result.hasSessdata) {
          if (result.cookie) await setBilibiliSessdata(result.cookie);
          await closeBilibiliLoginWindow();
          setLoginState("logged-in");
          loggingInRef.current = false;
          return;
        }
      }
      // Deadline elapsed without login — user likely closed the window.
      loggingInRef.current = false;
      setLoginState("idle");
    } catch {
      loggingInRef.current = false;
      setLoginState("idle");
    }
  }, [platform]);

  return { loginState, login };
}
