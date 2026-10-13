// services/automation/concurrency.ts
// Tiny pure helper used by the slot dispatcher (kept free of server-only
// imports so it is unit-testable).

/** Runs `fn` over `items` with at most `limit` in flight; stops starting new items once `shouldStop()` is true. `fn` must not throw (the dispatcher passes a wrapper that never does). Returns how many items `fn` was started for. */
export async function runWithConcurrency<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>, shouldStop: () => boolean = () => false): Promise<number> {
  let next = 0;
  let started = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length && !shouldStop()) {
      const item = items[next++];
      started += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return started;
}
