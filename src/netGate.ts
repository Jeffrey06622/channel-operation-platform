const MAX_CONCURRENT = 3;
const DEDUPE_WINDOW_MS = 250;

let active = 0;
const waiting: Array<() => void> = [];
const recent = new Map<string, Promise<unknown>>();

function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

/**
 * Runs `fn` inside the global database request gate.
 * At most MAX_CONCURRENT requests run at once; the rest wait in FIFO order.
 * A call with the same `key` as one started within DEDUPE_WINDOW_MS shares its
 * Promise. Only read-only callers may pass a shared key; writes must use a unique key.
 */
export function withGate<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = recent.get(key);
  if (existing) return existing as Promise<T>;

  const run = (async () => {
    await acquireSlot();
    try {
      return await fn();
    } finally {
      releaseSlot();
    }
  })();

  recent.set(key, run);
  setTimeout(() => {
    if (recent.get(key) === run) recent.delete(key);
  }, DEDUPE_WINDOW_MS);
  return run;
}
