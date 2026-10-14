// services/market-alerts/runner.ts
// DB side of the market alerts: load the enabled rules, fetch each symbol's market structure and the high-impact
// calendar ONCE (not once per user), evaluate, persist the state change with a compare-and-set (so two overlapping
// runs cannot announce the same condition twice) and notify (bell, plus Telegram / push for users who connected them).
// Dependencies are injected so the whole loop is testable offline; production wiring is `productionDeps()`.
// Never throws to the cron: a failed symbol or user is skipped, the rest still run.

import { evaluateMarketRule, labelFor, marketAlertSeverity, marketAlertText, nextTransition, type MarketAlertContext, type MarketAlertKind } from "./alerts";

export interface StoredRule {
  id: string;
  userId: string;
  symbol: string;
  kind: string;
  threshold: number;
  enabled: boolean;
  cooldownMin: number;
  state: string;
  lastFiredAt: Date | null;
}

export interface RunnerDeps {
  listEnabledRules: () => Promise<StoredRule[]>;
  /** Compare-and-set: only applies when the stored state still equals what we read. Returns true when it applied. */
  cas: (rule: StoredRule, data: { state: "ok" | "firing"; lastFiredAt?: Date; lastValue: number | null }) => Promise<boolean>;
  getSmc: (symbol: string) => Promise<MarketAlertContext["smc"]>;
  /** High-impact events for the symbol's currencies (the whole feed week); null when the feed is unavailable. */
  getEvents: (symbol: string) => Promise<MarketAlertContext["events"]>;
  notify: (userId: string, n: { title: string; body: string; severity: "info" | "warning"; href: string; tag: string }) => Promise<void>;
}

export interface RunResult {
  rules: number;
  symbols: number;
  fired: number;
  skipped: number;
}

const MAX_RULES = 5000;
const HREF = "/dashboard/alerts";

export async function runMarketAlertsWith(deps: RunnerDeps, nowDate: Date = new Date()): Promise<RunResult> {
  const result: RunResult = { rules: 0, symbols: 0, fired: 0, skipped: 0 };
  let rules: StoredRule[];
  try {
    rules = (await deps.listEnabledRules()).slice(0, MAX_RULES);
  } catch {
    return result; // table absent (migration not applied yet) or DB down: nothing to do
  }
  result.rules = rules.length;
  const now = nowDate.getTime();

  const bySymbol = new Map<string, StoredRule[]>();
  for (const r of rules) (bySymbol.get(r.symbol) ?? bySymbol.set(r.symbol, []).get(r.symbol)!).push(r);
  result.symbols = bySymbol.size;

  await Promise.all(
    [...bySymbol.entries()].map(async ([symbol, symbolRules]) => {
      const kinds = new Set(symbolRules.map((r) => r.kind));
      const needsSmc = kinds.has("level_near") || kinds.has("vol_high");
      const needsEvents = kinds.has("event_soon");
      const [smc, events] = await Promise.all([
        needsSmc ? deps.getSmc(symbol).catch(() => null) : Promise.resolve(null),
        needsEvents ? deps.getEvents(symbol).catch(() => null) : Promise.resolve(null),
      ]);
      const ctx: MarketAlertContext = { nowUtc: now, smc, events };

      for (const rule of symbolRules) {
        try {
          const kind = rule.kind as MarketAlertKind;
          const ev = evaluateMarketRule({ kind, threshold: rule.threshold, symbol }, ctx);
          const tr = nextTransition(
            { state: rule.state === "firing" ? "firing" : "ok", lastFiredAt: rule.lastFiredAt ? rule.lastFiredAt.getTime() : null, cooldownMin: rule.cooldownMin, enabled: rule.enabled },
            ev,
            now,
          );
          if (tr.action === "none") {
            if (ev.value === null) result.skipped++;
            continue;
          }
          const applied = await deps.cas(rule, tr.action === "fire" ? { state: "firing", lastFiredAt: nowDate, lastValue: ev.value } : { state: "ok", lastValue: ev.value });
          if (!applied || tr.action === "resolve") continue;
          result.fired++;
          const text = marketAlertText(kind, symbol, ev, tr.reminder);
          await deps.notify(rule.userId, { ...text, severity: marketAlertSeverity(kind), href: HREF, tag: `ma-${symbol}-${kind}` }).catch(() => undefined);
        } catch {
          result.skipped++;
        }
      }
    }),
  );
  return result;
}

/** Name shown in notifications is derived from the symbol; exported for the UI and tests. */
export { labelFor };
