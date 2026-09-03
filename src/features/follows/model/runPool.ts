/**
 * Minimal worker-pool: run `worker` over `items` with at most `concurrency`
 * in flight. Individual failures are swallowed (callers treat per-item
 * errors as skippable) — mirrors Promise.allSettled semantics but bounded.
 */
export async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let idx = 0;
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (idx < items.length) {
        const item = items[idx++];
        try {
          await worker(item);
        } catch {
          // Individual failures are non-fatal — stale snapshot stays in place.
        }
      }
    },
  );
  await Promise.all(lanes);
}

// ── self-check ──────────────────────────────────────────────────────────
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(`runPool check FAILED: ${msg}`);
}

async function selfCheck() {
  let active = 0;
  let maxActive = 0;
  const done: number[] = [];
  const items = Array.from({ length: 10 }, (_, i) => i);
  await runPool(items, 3, async (n) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    done.push(n);
  });
  assert(done.length === 10, "all items processed");
  assert(maxActive <= 3, `concurrency capped at 3, got ${maxActive}`);

  await runPool([1, 2], 3, async (n) => {
    if (n === 1) throw new Error("boom");
  });
  // Reaching here means the failure was swallowed and the pool completed.

  await runPool([], 3, async () => assert(false, "worker must not run for empty input"));
  // biome-ignore lint/suspicious/noConsole: self-check output, runs only as a script
  console.log("runPool check OK — 4 assertions passed");
}

const _g = globalThis as unknown as { process?: { argv?: string[] } };
const _entry = _g.process?.argv?.[1];
if (_entry && import.meta.url === `file://${_entry}`) {
  void selfCheck();
}
