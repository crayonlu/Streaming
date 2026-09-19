const STORAGE_KEY = "streaming_replay_progress_v1";
const MIN_RESUME_SECONDS = 10;

export interface ReplayProgress {
  position: number;
  duration: number;
  completed: boolean;
  updatedAt: number;
}

type ProgressMap = Record<string, ReplayProgress>;

function readAll(): ProgressMap {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? (value as ProgressMap) : {};
  } catch {
    return {};
  }
}

export function replayProgressKey(platform: string, roomId: string, replayId: string) {
  return `${platform}:${roomId}:${replayId}`;
}

export function loadReplayProgress(key: string): ReplayProgress | null {
  const progress = readAll()[key];
  if (!progress || progress.completed || progress.position < MIN_RESUME_SECONDS) return null;
  if (!Number.isFinite(progress.position) || progress.position <= 0) return null;
  return progress;
}

export function getReplayProgress(key: string): ReplayProgress | null {
  return readAll()[key] ?? null;
}

export function saveReplayProgress(key: string, position: number, duration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
  const remaining = duration - position;
  const completed = position / duration >= 0.95 || remaining <= 30;
  const all = readAll();
  all[key] = {
    position: completed ? 0 : Math.max(0, position),
    duration,
    completed,
    updatedAt: Date.now(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Progress persistence is best-effort.
  }
}
