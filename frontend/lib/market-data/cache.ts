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

/** A `getStale` read: the value plus how old it actually is, in ms. */
export interface StaleRead<T> {
  value: T;
  ageMs: number;
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

  // Sprint D2.3.S3 - resilience fallback. Peeks an entry regardless of
  // whether it has passed its normal TTL, as long as it is no older than
  // maxAgeMs. Never evicts (a caller deciding not to use a stale value must
  // not destroy it for a later caller that might). Returns undefined if the
  // key is absent entirely or older than maxAgeMs - the caller (not this
  // cache) decides what "too old to use" means for its situation.
  getStale(key: string, maxAgeMs: number): StaleRead<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    const ageMs = this.clock.now() - (entry.expiresAt - this.ttlMs);
    return ageMs <= maxAgeMs ? { value: entry.value, ageMs } : undefined;
  }

  /** True if any entry exists for key, regardless of freshness - diagnostic only (e.g. the failure DTO's `cached` flag). */
  has(key: string): boolean {
    return this.store.has(key);
  }
}
