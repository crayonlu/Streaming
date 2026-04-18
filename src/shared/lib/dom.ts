export function findScrollParent(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start?.parentElement ?? null;
  while (el && el !== document.body) {
    const { overflowY } = window.getComputedStyle(el);
    if (/(auto|scroll|overlay)/.test(overflowY)) return el;
    el = el.parentElement;
  }
  return null;
}

// ── Formatting utilities ──────────────────────────────────────────────────────

export function fmtDate(unix: number): string {
  if (!unix) return "";
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDuration(str?: string): string {
  if (!str) return "";
  const parts = str.split(":").map(Number);
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    if (m >= 60) {
      const h = Math.floor(m / 60);
      return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }
  return str;
}
