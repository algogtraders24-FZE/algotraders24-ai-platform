// Public market hubs: the view is built only from supplied numbers, every section is optional (a missing source gives no section,
// never an estimate), the range is widened around validated US releases and says so, and the site links to every hub.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MARKETS, buildHubView, driverRule, marketBySlug, type HubInputs } from "../services/markets/hub";
import { ASSET_PROFILES } from "../services/macro/macro-alignment";
import { SYMBOL_LABEL } from "../services/market-alerts/alerts";
import type { SmcAnalysis } from "../services/smc/smc-engine";
import type { CalibrationRow } from "../services/calibration/forecast";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${(e as Error).message}`);
  }
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const NOW = Date.parse("2026-10-14T10:00:00Z");
const smc = (over: Partial<SmcAnalysis> = {}): SmcAnalysis =>
  ({
    price: 4150,
    atr: 6,
    bias: "Bullish",
    htf: { bias: "Bearish", event: "BOS" },
    volatility: "Normal",
    volatilityRatio: 1.02,
    pools: [
      { kind: "PDH", price: 4200.5, status: "untouched", formedIdx: 1 },
      { kind: "PDL", price: 4100, status: "swept", formedIdx: 1 },
    ],
    ...over,
  }) as unknown as SmcAnalysis;
const ev = (hoursAhead: number, title: string, currency = "USD", impact = "high") => ({ title, currency, impact, eventTime: new Date(NOW + hoursAhead * 3_600_000).toISOString(), forecast: "0.2%", previous: "0.3%" });
const cal = (h: 12 | 24, n: number, inside: number): CalibrationRow => ({ symbol: "XAUUSD", horizon: h, n, inside, rate: n ? inside / n : null, lo: 0.7, hi: 0.9, status: n >= 30 ? "on-target" : "collecting" });
const full = (over: Partial<HubInputs> = {}): HubInputs => ({
  smc: smc(),
  macro: { alignment: { label: "Neutral", score: 0, availableDrivers: 5, totalDrivers: 5 }, price: { text: "$4,150.00", changePct: -0.27 } },
  events: [ev(3, "CPI m/m"), ev(5, "Retail Sales m/m"), ev(2, "ECB Press Conference", "EUR"), ev(-1, "Old event"), ev(30, "Federal Funds Rate")],
  calibration: [cal(12, 40, 32), cal(24, 10, 8)],
  posts: [
    { slug: "gold-1", title: "Gold (XAU/USD) Analysis - 14 Oct 2026", publishedAt: "2026-10-14T05:00:00Z" },
    { slug: "gold-2", title: "Gold (XAU/USD) Analysis - 15 Oct 2026", publishedAt: "2026-10-15T05:00:00Z" },
    { slug: "btc-1", title: "Bitcoin (BTC/USD) Crypto Analysis", publishedAt: "2026-10-14T05:00:00Z" },
  ],
  listings: [{ slug: "a", title: "A", pricing: { amount: 299, currency: "USD" }, platformTag: "MT5" }, { slug: "b", title: "B", pricing: {}, platformTag: "MT4" }],
  ...over,
});
const gold = marketBySlug("gold")!;

test("MARKETS: unique slugs, every symbol is a calibrated/alert symbol, every macro asset has a profile with drivers", () => {
  assert.equal(new Set(MARKETS.map((m) => m.slug)).size, MARKETS.length);
  for (const m of MARKETS) {
    assert.ok(SYMBOL_LABEL[m.symbol], `${m.symbol} must be one of the platform's instruments`);
    assert.ok(ASSET_PROFILES[m.asset].drivers.length >= 4, m.slug);
    assert.ok(m.about.length > 150 && !/guarantee|will (rise|fall)|buy now/i.test(m.about), m.slug);
  }
  assert.equal(marketBySlug("nope"), undefined);
});

test("buildHubView: range text with price formatting, key levels, descriptive structure, macro summary", () => {
  const v = buildHubView(gold, full({ events: [] }), NOW);
  assert.equal(v.ranges?.r12, "12h +/-18.71 (0.45%)");
  assert.equal(v.ranges?.r24, "24h +/-27.92 (0.67%)");
  assert.equal(v.ranges?.widenedNote, null);
  assert.match(v.levels ?? "", /PDH 4200\.50 \(50\.50 above\), PDL 4100\.00 \(50\.00 below, swept\)/);
  assert.deepEqual(v.structure, { bias1h: "bullish", bias4h: "bearish", volatility: "normal (ATR 1.02x its recent average)" });
  assert.equal(v.macro?.label, "Neutral");
  assert.equal(v.macro?.available, 5);
  assert.equal(v.price?.text, "4150.00");
});

test("buildHubView: a US CPI inside the window widens the range and says so (12h x2, 24h x1.4 for gold-like); crypto uses its own factors", () => {
  const v = buildHubView(gold, full(), NOW);
  assert.equal(v.ranges?.r12, "12h +/-37.41 (0.90%)");
  assert.match(v.ranges?.widenedNote ?? "", /US CPI falls inside the window \(12h x2, 24h x1\.4\)/);
  const btc = buildHubView(marketBySlug("bitcoin")!, full({ smc: smc({ price: 80000, atr: 400 }) }), NOW);
  assert.match(btc.ranges?.widenedNote ?? "", /12h x1\.3, 24h x1\)/);
});

test("buildHubView: upcoming events = high-impact, timed, not past, soonest first, max 5, with 'in' text and forecast/previous", () => {
  const v = buildHubView(gold, full({ events: [ev(30, "Z"), ev(3, "CPI m/m"), ev(2, "ECB Press Conference", "EUR"), ev(-1, "old"), ev(1, "low", "USD", "low"), { ...ev(4, "holiday"), isHoliday: true }] as never }), NOW);
  assert.deepEqual(v.events.map((e) => e.title), ["ECB Press Conference", "CPI m/m", "Z"]);
  assert.equal(v.events[0].inText, "in 2h 0m");
  assert.equal(v.events[2].inText, "in 30h 0m");
  assert.match(v.events[1].utc, /^2026-10-14 13:00 UTC$/);
  assert.equal(v.events[1].forecast, "0.2%");
  const many = buildHubView(gold, full({ events: Array.from({ length: 9 }, (_, i) => ev(i + 1, `E${i}`)) as never }), NOW);
  assert.equal(many.events.length, 5);
});

test("buildHubView: drivers come from the macro profile with a plain rule per direction; analyses are only this market's, newest first", () => {
  const v = buildHubView(gold, full(), NOW);
  assert.ok(v.drivers.some((d) => d.label === "Real yield (10Y TIPS)" && /headwind/.test(d.rule)));
  assert.ok(v.drivers.some((d) => d.label === "Treasury yields" && /support/.test(d.rule)));
  assert.equal(driverRule("US dollar", -1), "a rise in us dollar counts as a headwind");
  assert.deepEqual(v.analyses.map((p) => p.slug), ["gold-2", "gold-1"]);
  assert.equal(buildHubView(marketBySlug("bitcoin")!, full(), NOW).analyses.length, 1);
});

test("buildHubView: calibration rows and listings pass through (price only when the listing has one)", () => {
  const v = buildHubView(gold, full(), NOW);
  assert.equal(v.calibration.row12?.n, 40);
  assert.equal(v.calibration.row24?.status, "collecting");
  assert.deepEqual(v.listings.map((l) => [l.slug, l.price]), [["a", "$299"], ["b", null]]);
});

test("buildHubView: every source down -> empty sections, never invented numbers", () => {
  const v = buildHubView(gold, { smc: null, macro: null, events: null, calibration: null, posts: null, listings: null }, NOW);
  assert.equal(v.price, null);
  assert.equal(v.ranges, null);
  assert.equal(v.levels, null);
  assert.equal(v.structure, null);
  assert.equal(v.macro, null);
  assert.deepEqual([v.events, v.analyses, v.listings], [[], [], []]);
  assert.deepEqual(v.calibration, { row12: null, row24: null });
  assert.ok(v.drivers.length >= 4, "the static 'what moves it' section still exists");
});

test("site: every hub is linked from the navbar, the footer index, the sitemap; pages declare self canonicals; hub text claims no direction", () => {
  const nav = read("components/layout/Navbar.tsx");
  const sitemap = read("app/sitemap.ts");
  for (const m of MARKETS) assert.ok(nav.includes(`/markets/${m.slug}`), `navbar links /markets/${m.slug}`);
  assert.ok(sitemap.includes("/markets/${m.slug}") && sitemap.includes("/markets`"));
  assert.ok(read("sections/Footer.tsx").includes('"/markets"'));
  assert.match(read("app/markets/[slug]/page.tsx"), /canonical:\s*`\/markets\/\$\{def\.slug\}`/);
  assert.match(read("app/markets/page.tsx"), /canonical:\s*"\/markets"/);
  const page = read("app/markets/[slug]/page.tsx");
  assert.ok(!/\b(buy now|sell now|will (rise|fall|reach)|price target|guaranteed)\b/i.test(page));
  assert.match(page, /never a buy or sell call|not a direction or a target/i);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
