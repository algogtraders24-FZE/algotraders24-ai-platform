// lib/market-data/cache.ts
// Sprint 15D.3A - Provider-local TTL cache. Deliberately separate from
// services/api/ApiClient.ts's cache: that one is scoped to internal
// /api/private/* GET calls with a different response envelope, and mixing
// the two would let an internal-route cache key collide with a vendor
// cache key. The clock is injectable so tests can control expiry
// deterministically without real timers or sleeps.
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly clock: Clock = systemClock,
  ) {}

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: this.clock.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }
}
