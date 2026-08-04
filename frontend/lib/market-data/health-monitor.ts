// lib/market-data/health-monitor.ts
// Sprint D2.3.S3 - Provider Health Monitor. A small in-memory rolling window
// per provider name, classified into one of four honest states so the UI can
// show real provider health instead of a generic "unavailable". No
// persistence - resets on server restart, which is the same "live check, not
// historical record" philosophy services/backend/HealthService.ts already
// uses for platform-wide health. This module never makes a network call
// itself - it only records outcomes MarketDataService reports to it.
import { systemClock, type Clock } from "./cache";
import type { MarketDataErrorKind } from "./errors";

export type ProviderHealthState = "healthy" | "degraded" | "rate_limited" | "offline";

export interface ProviderHealthSnapshot {
  provider: string;
  state: ProviderHealthState;
  lastLatencyMs?: number;
  lastErrorKind?: MarketDataErrorKind;
  lastCheckedAt: string;
  consecutiveFailures: number;
  successCount: number;
  failureCount: number;
}

interface Outcome {
  ok: boolean;
  kind?: MarketDataErrorKind;
}

interface ProviderWindow {
  outcomes: Outcome[];
  lastLatencyMs?: number;
  lastErrorKind?: MarketDataErrorKind;
  lastCheckedAtMs?: number;
}

function countTrailing(outcomes: readonly Outcome[], predicate: (o: Outcome) => boolean): number {
  let count = 0;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (!predicate(outcomes[i])) break;
    count++;
  }
  return count;
}

// Pure classification - no I/O, no clock read, independently testable. Order
// matters: rate-limit is checked before generic-offline so a provider that's
// merely being throttled is never reported as fully down.
export function classify(recent: readonly Outcome[]): ProviderHealthState {
  if (recent.length === 0) return "healthy";
  const consecutiveRateLimit = countTrailing(recent, (o) => !o.ok && o.kind === "rate_limit");
  if (consecutiveRateLimit >= 2) return "rate_limited";
  const consecutiveFailures = countTrailing(recent, (o) => !o.ok);
  if (consecutiveFailures >= 3) return "offline";
  if (recent.some((o) => !o.ok)) return "degraded";
  return "healthy";
}

const WINDOW_SIZE = 20;

export class ProviderHealthMonitor {
  private readonly windows = new Map<string, ProviderWindow>();

  constructor(
    private readonly windowSize: number = WINDOW_SIZE,
    private readonly clock: Clock = systemClock,
  ) {}

  private windowFor(provider: string): ProviderWindow {
    let w = this.windows.get(provider);
    if (!w) {
      w = { outcomes: [] };
      this.windows.set(provider, w);
    }
    return w;
  }

  private push(provider: string, outcome: Outcome): ProviderWindow {
    const w = this.windowFor(provider);
    w.outcomes.push(outcome);
    if (w.outcomes.length > this.windowSize) w.outcomes.shift();
    w.lastCheckedAtMs = this.clock.now();
    return w;
  }

  recordSuccess(provider: string, latencyMs: number): void {
    const w = this.push(provider, { ok: true });
    w.lastLatencyMs = latencyMs;
  }

  recordFailure(provider: string, kind: MarketDataErrorKind): void {
    const w = this.push(provider, { ok: false, kind });
    w.lastErrorKind = kind;
  }

  snapshot(provider: string): ProviderHealthSnapshot {
    const w = this.windows.get(provider);
    const outcomes = w?.outcomes ?? [];
    return {
      provider,
      state: classify(outcomes),
      lastLatencyMs: w?.lastLatencyMs,
      lastErrorKind: w?.lastErrorKind,
      lastCheckedAt: new Date(w?.lastCheckedAtMs ?? this.clock.now()).toISOString(),
      consecutiveFailures: countTrailing(outcomes, (o) => !o.ok),
      successCount: outcomes.filter((o) => o.ok).length,
      failureCount: outcomes.filter((o) => !o.ok).length,
    };
  }

  allSnapshots(): ProviderHealthSnapshot[] {
    return Array.from(this.windows.keys()).map((provider) => this.snapshot(provider));
  }
}
