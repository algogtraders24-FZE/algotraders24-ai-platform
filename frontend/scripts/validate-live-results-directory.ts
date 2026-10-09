// Validates the public summary, directory filters/sorts, Compare rows and the public JSON route handlers' building blocks. Pure.
import assert from "node:assert/strict";
import { buildPublicResults, type BuildInput, type DealWithMagic } from "../services/live-results/build";
import { DEFAULT_FILTER, MAX_COMPARE, MIN_TRADES_TO_JUDGE, SPARKLINE_POINTS, compareRows, downsample, filterAndSort, summarizeResults, type ResultsSummary } from "../services/live-results/summary";

let checks = 0;
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++; };
const eq = <T>(a: T, b: T, m: string) => { assert.deepEqual(a, b, m); checks++; };
const at = (iso: string) => Date.parse(iso + "Z");

// ---- a synthetic page: deposit 10 000, n round trips of +60 / -40
function page(n: number, opts: { showAmounts?: boolean; showBroker?: boolean; broker?: string; platform?: string; magic?: string | null; mode?: string } = {}): ReturnType<typeof buildPublicResults> {
  let ms = at("2026-08-01T06:00:00");
  let id = 0;
  const deal = (p: Partial<DealWithMagic>): DealWithMagic => ({ positionId: "0", timeMsc: (ms += 3_600_000 * 5), symbol: "US30", type: "buy", entry: "in", volume: 1.5, price: 40123.5, commission: 0, swap: 0, profit: 0, fee: 0, comment: "Zenith_Buy", magic: "33302", ...p });
  const deals: DealWithMagic[] = [deal({ positionId: "b", type: "balance", entry: "none", symbol: "", volume: 0, price: 0, profit: 10_000, magic: "0" })];
  for (let i = 0; i < n; i++) {
    const p = String(++id);
    deals.push(deal({ positionId: p }), deal({ positionId: p, type: "sell", entry: "out", profit: i % 5 === 4 ? -40 : 60, comment: "" }));
  }
  const base: BuildInput = {
    page: { title: "Zenith", description: "demo EA", showAmounts: opts.showAmounts ?? false, showBroker: opts.showBroker, positionDelayMin: 15, magicFilter: opts.magic ?? null },
    account: { mode: opts.mode ?? "demo", currency: "USD", marginMode: "hedging", leverage: 500, serverUtcOffsetSec: 0, firstSyncAt: at("2026-08-10T00:00:00"), lastSyncAt: at("2026-10-08T11:59:00"), batches: 4, chainHead: "c".repeat(64), broker: opts.broker, platform: opts.platform },
    deals, snapshots: [], nowUtc: at("2026-10-08T12:00:00"),
  };
  return buildPublicResults(base);
}

// ---- downsample
eq(downsample([1, 2, 3]), [1, 2, 3], "short series are kept");
const long = Array.from({ length: 1000 }, (_, i) => i);
const ds = downsample(long);
eq([ds.length, ds[0], ds[ds.length - 1]], [SPARKLINE_POINTS, 0, 999], "long series are cut to the point cap and keep both ends");
ok(ds.every((v, i) => i === 0 || v >= ds[i - 1]!), "downsampling keeps the order");

// ---- summary
const r = page(50, { broker: "Exness Technologies Ltd", showBroker: true, platform: "mt4" });
const s = summarizeResults("zenith-1", r);
eq([s.slug, s.title, s.mode, s.platform, s.broker, s.oneEa], ["zenith-1", "Zenith", "demo", "mt4", "Exness Technologies Ltd", false], "identity facts: platform from the account, broker only because the owner showed it");
eq([s.trades, s.enoughData], [50, true], "50 trades is enough to judge");
ok(s.sparkline.length > 1 && s.sparkline.length <= SPARKLINE_POINTS, "a sparkline within the point cap");
near(s.winRatePct, 80, "win rate 80% (4 of 5 round trips win)");
near(s.gainPct, r.stats.timeWeightedGainPct, "gain is the time-weighted gain of the page");
eq(s.liveForward.trades, r.integrity.liveTracked.trades, "live-forward record is carried over");
ok(s.avgMonthlyPct !== null, "an average month exists");
eq(summarizeResults("x", page(10)).enoughData, false, `under ${MIN_TRADES_TO_JUDGE} trades is flagged as too few`);
eq(summarizeResults("x", page(2, { showBroker: false, broker: "Hidden Broker Ltd" })).broker, null, "a broker the owner did not choose to show is never in the summary");
eq(summarizeResults("x", page(5, { magic: "33302" })).oneEa, true, "a magic-filtered page is marked one EA");

function near(a: number | null, b: number | null, m: string) {
  assert.ok(a !== null && b !== null && Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);
  checks++;
}

// ---- privacy: the summary is percent-only even when the page shows amounts
const withAmounts = page(50, { showAmounts: true, broker: "B", showBroker: true });
const sa = summarizeResults("a", withAmounts);
const json = JSON.stringify(sa);
ok(!/USD|balance|deposit|profit"|net"|volume|lots|openPrice|closePrice/i.test(json.replace(/"profitFactor"/g, "")), "the summary carries no money, size or price, even when the page itself shows amounts");
eq(Object.keys(sa).sort(), Object.keys(s).sort(), "the summary has the same keys whether or not the page shows amounts");
ok(!("history" in sa) && !("amounts" in sa) && !("openPositions" in sa), "no history rows, no amounts block, no open positions");

// ---- avg month: finished months only when there is more than one; the running month when it is the only one
const rOne = page(10);
const onlyMonth = rOne.stats.monthlyHistory.map((m) => m.gainPct).filter((g): g is number => g !== null);
eq(rOne.stats.monthlyHistory.length, 1, "a short record sits inside one month");
near(summarizeResults("x", rOne).avgMonthlyPct, onlyMonth[0]!, "with one month only, the running month is the average");
const rMany = page(300);
const monthsMany = rMany.stats.monthlyHistory.map((m) => m.gainPct).filter((g): g is number => g !== null);
ok(monthsMany.length >= 3, "a long record spans several months");
const finishedMany = monthsMany.slice(0, -1);
near(summarizeResults("x", rMany).avgMonthlyPct, Math.round((finishedMany.reduce((a, b) => a + b, 0) / finishedMany.length) * 100) / 100, "average month = mean of the FINISHED months (the running month is excluded)");

// ---- directory filters and sorts
const mk = (p: Partial<ResultsSummary>): ResultsSummary => ({ ...s, ...p });
const list = [
  mk({ slug: "a", title: "Alpha", broker: null, mode: "demo", platform: "mt5", stale: false, trades: 100, daysSinceFirstSync: 40, lastSyncAt: 3000, maxDrawdownPct: 12, enoughData: true, gainPct: 90 }),
  mk({ slug: "b", title: "Bravo", broker: null, mode: "real", platform: "mt4", stale: true, trades: 200, daysSinceFirstSync: 10, lastSyncAt: 1000, maxDrawdownPct: 5, enoughData: true, gainPct: 5 }),
  mk({ slug: "c", title: "Charlie", mode: "demo", platform: "mt4", stale: false, trades: 8, daysSinceFirstSync: 90, lastSyncAt: 2000, maxDrawdownPct: null, enoughData: false, gainPct: 400, broker: "Exness Technologies Ltd" }),
];
const slugs = (x: ResultsSummary[]) => x.map((p) => p.slug).join("");
eq(slugs(filterAndSort(list, DEFAULT_FILTER, "newest")), "acb", "sorted by recent update");
eq(slugs(filterAndSort(list, DEFAULT_FILTER, "longest")), "cab", "sorted by longest tracked");
eq(slugs(filterAndSort(list, DEFAULT_FILTER, "trades")), "bac", "sorted by most trades");
eq(slugs(filterAndSort(list, DEFAULT_FILTER, "drawdown")), "bac", "sorted by lowest drawdown, an unknown drawdown goes last");
eq(slugs(filterAndSort(list, DEFAULT_FILTER, "name")), "abc", "sorted by name");
eq(slugs(filterAndSort(list, { ...DEFAULT_FILTER, mode: "demo" }, "name")), "ac", "demo only");
eq(slugs(filterAndSort(list, { ...DEFAULT_FILTER, platform: "mt4" }, "name")), "bc", "MT4 only");
eq(slugs(filterAndSort(list, { ...DEFAULT_FILTER, liveOnly: true }, "name")), "ac", "reporting now only");
eq(slugs(filterAndSort(list, { ...DEFAULT_FILTER, enoughOnly: true }, "name")), "ab", "enough trades only");
eq(slugs(filterAndSort(list, { ...DEFAULT_FILTER, query: "exness" }, "name")), "c", "search matches the broker name");
eq(slugs(filterAndSort(list, { ...DEFAULT_FILTER, query: "zzz" }, "name")), "", "search with no match");
ok(!("gain" in { newest: 1, longest: 1, trades: 1, drawdown: 1, name: 1 }), "there is no sort by gain");
eq(slugs(filterAndSort(list, DEFAULT_FILTER, "newest")), slugs(filterAndSort([...list].reverse(), DEFAULT_FILTER, "newest")), "the result does not depend on the input order");

// ---- compare rows
const rows = compareRows(list.slice(0, 2));
ok(rows.every((x) => x.cells.length === 2), "one cell per compared page in every row");
eq(rows.find((x) => x.label === "Platform")!.cells, ["MetaTrader 5", "MetaTrader 4"], "platform row");
eq(rows.find((x) => x.label === "Account")!.cells, ["DEMO", "REAL"], "account row");
eq(rows.find((x) => x.label === "Enough trades to judge")!.cells, ["yes", "yes"], "enough-trades row");
eq(compareRows([list[2]!]).find((x) => x.label === "Enough trades to judge")!.cells, [`no (under ${MIN_TRADES_TO_JUDGE})`], "a short record says so");
eq(compareRows([list[2]!]).find((x) => x.label === "Broker (self-reported)")!.cells, ["Exness Technologies Ltd"], "a shown broker is labelled self-reported");
eq(compareRows([list[0]!]).find((x) => x.label === "Broker (self-reported)")!.cells, ["not shown"], "a page that does not show its broker says so");
eq(MAX_COMPARE, 4, "up to four pages can be compared");

console.log(`validate-live-results-directory: ${checks} checks passed`);
