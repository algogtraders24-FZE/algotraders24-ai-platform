// Validates the shareable badge facts: forward record line, tones, truncation, no money. Pure.
import assert from "node:assert/strict";
import { badgeFacts, truncate, BADGE_TITLE_MAX } from "../services/live-results/badge";
import { buildPublicResults, type DealWithMagic } from "../services/live-results/build";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };

const at = (iso: string) => Date.parse(iso + "Z");
let ms = at("2026-10-01T06:00:00");
let id = 0;
const deal = (p: Partial<DealWithMagic>): DealWithMagic => ({ positionId: "0", timeMsc: (ms += 60_000), symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 40000, commission: 0, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy", magic: "33302", ...p });
const pair = (profit: number): DealWithMagic[] => { const p = String(++id); return [deal({ positionId: p }), deal({ positionId: p, type: "sell", entry: "out", profit, comment: "" })]; };

const NOW = at("2026-10-08T12:00:00");
function results(opts: { profits: number[]; firstSyncAt: number; lastSyncAt?: number; title?: string; mode?: string }) {
  ms = at("2026-10-01T06:00:00"); // every scenario starts from the same clock
  const deals: DealWithMagic[] = [deal({ positionId: "b", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 10_000, magic: "0" })];
  for (const p of opts.profits) deals.push(...pair(p));
  return buildPublicResults({
    page: { title: opts.title ?? "XXXUS30", description: "", showAmounts: false, positionDelayMin: 15, magicFilter: "33302" },
    account: { mode: opts.mode ?? "demo", currency: "USD", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 0, firstSyncAt: opts.firstSyncAt, lastSyncAt: opts.lastSyncAt ?? NOW - 60_000, batches: 3, chainHead: "a".repeat(64) },
    deals, snapshots: [], nowUtc: NOW,
  });
}

// 4 trades before the first sync, then 3 winners and 1 loser after it
const history = [100, -50, 80, -20];
const forward = [200, 150, -100, 120];
const first = at("2026-10-01T06:00:00") + 61_000 * 2 * history.length + 120_000 / 2;
const r = results({ profits: [...history, ...forward], firstSyncAt: first });
const f = badgeFacts(r);
eq(f.modeLabel, "DEMO", "demo label");
eq(f.live, true, "recent sync -> live");
ok(/^Live forward \+[\d.]+% · 4 trades$/.test(f.headline), `forward headline names the gain and the trade count (got: ${f.headline})`);
eq(f.tone, "pos", "positive forward record -> green");
ok(/^Tracked \d+ days? · max drawdown [\d.]+% · terminal-reported$/.test(f.sub), "sub line states the days, drawdown and that it is terminal-reported");

const neg = badgeFacts(results({ profits: [...history, -300, -100], firstSyncAt: first }));
eq(neg.tone, "neg", "negative forward record -> red");
ok(/^Live forward -[\d.]+% · 2 trades$/.test(neg.headline), "negative gain keeps its sign");

const none = badgeFacts(results({ profits: history, firstSyncAt: NOW - 3600_000 }));
eq(none.headline, "Live tracking started · no closed trades yet", "no forward trades: says so, never invents a number");
eq(none.tone, "neutral", "neutral tone without forward trades");

const one = badgeFacts(results({ profits: [...history, 40], firstSyncAt: first }));
ok(/ · 1 trade$/.test(one.headline), "singular trade");

eq(badgeFacts(results({ profits: history, firstSyncAt: first, lastSyncAt: NOW - 3 * 3600_000 })).live, false, "old last sync -> not live");
eq(badgeFacts(results({ profits: history, firstSyncAt: first, mode: "real" })).modeLabel, "REAL", "real account label");
eq(badgeFacts(results({ profits: history, firstSyncAt: first, mode: "contest" })).modeLabel, "CONTEST", "contest label");

const long = badgeFacts(results({ profits: history, firstSyncAt: first, title: "A very long Expert Advisor title that must not overflow the badge" }));
ok(long.title.length <= BADGE_TITLE_MAX && long.title.endsWith("…"), "long titles are cut with an ellipsis");
eq(truncate("short", 26), "short", "short titles untouched");

const all = JSON.stringify([f, neg, none, one, long]);
ok(!/USD|\$|balance|profit|\bnet\b/i.test(all), "badge facts carry no money or currency");

console.log(`validate-live-results-badge: ${checks} checks passed`);
