import type { SessionHoursRule } from "../risk-specification.js";

export type { SessionHoursRule };

/** Q0.7.17 — what happens to an open position when its session window ends. */
export type SessionExitBehavior = "CLOSE_ALL" | "NO_NEW_ENTRIES" | "NONE";

/**
 * Q0.7.18 — LEAN's three-way timezone distinction (`Q0.4_PLATFORM_DECISIONS.md`:
 * "Three-way (algorithm/exchange/data) timezone distinction... ADOPT" — more
 * rigorous than every other researched platform), finally implemented.
 * Every StrategyIR MUST set `strategyTimezone` explicitly — there is no
 * default, and nothing in this package ever reads the host machine's local
 * timezone (Q0.3's existing `Intl.DateTimeFormat`-explicit-zone discipline,
 * extended here to the IR level). `exchangeTimezone`/`dataTimezone` are
 * optional because not every source strategy distinguishes them, but when
 * unset they are NOT assumed to equal `strategyTimezone` — a validator
 * checking session-window math must use whichever field is actually
 * relevant and fail if it is missing, never silently substitute another.
 */
export interface StrategyTimezoneModel {
  readonly strategyTimezone: string; // IANA name, e.g. "UTC", "America/New_York"
  readonly exchangeTimezone?: string;
  readonly dataTimezone?: string;
}

export interface SessionSemanticsIR {
  readonly sessionHours: SessionHoursRule;
  readonly sessionExitBehavior: SessionExitBehavior;
}
