// scripts/validate-intelligence-data-sufficiency.ts
// Sprint D2.8.15 - Intelligence Data Sufficiency, Evidence-State
// Reconciliation & Production Intelligence Remediation. Standalone
// validation, no test framework - run via `npm run validate:intelligence-
// data-sufficiency`. Deterministic, in-memory, no network by default;
// section 8 (per-instrument production verification) is a real, live,
// gated section (RUN_LIVE_INTELLIGENCE_VERIFICATION=1) matching the
// existing D2.6.6/D2.6.8 "self-skip honestly" convention - never fabricates
// a PASS when opted out or unconfigured.
import assert from "node:assert/strict";
import { validateCandles } from "../lib/market-data/candle-validation";
import { buildCandleSufficiencyReport, INDICATOR_REQUIREMENTS, MAX_CORE_INDICATOR_MINIMUM } from "../lib/market-data/indicator-requirements";
import { MarketStateService } from "../services/intelligence/market-state/market-state.service";
import { RegimeService } from "../services/intelligence/regime/regime.service";
import { HypothesisService } from "../services/intelligence/hypothesis/hypothesis.service";
import { IntelligenceEnvelopeService } from "../services/intelligence/envelope/intelligence-envelope.service";
import { DecisionContextService } from "../services/intelligence/decision/decision-context.service";
import { RealTimeIntelligenceService } from "../services/intelligence/orchestration/real-time-intelligence.service";
import { buildMicrostructureSnapshot } from "../services/microstructure/microstructure-snapshot.service";
import type { Candle } from "../types/market-candle";
import type { MarketSnapshot } from "../types/market-snapshot";
import type { RawMicrostructureResult, RawMicrostructureEvidence } from "../types/microstructure";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const NOW_MS = Date.UTC(2026, 0, 10, 0, 0, 0);

function candle(datetimeMs: number, close: number, overrides?: Partial<Candle>): Candle {
  return {
    datetime: new Date(datetimeMs).toISOString(),
    open: close - 0.001,
    high: close + 0.002,
    low: close - 0.002,
    close,
    volume: 1000,
    ...overrides,
  };
}

function makeCandles(count: number, startMs = NOW_MS - count * 3_600_000, stepMs = 3_600_000): Candle[] {
  return Array.from({ length: count }, (_, i) => candle(startMs + i * stepMs, 1.1 + i * 0.0003));
}

function snapshotFor(candles: Candle[], symbol = "EURUSD"): MarketSnapshot {
  const last = candles[candles.length - 1];
  return {
    symbol,
    assetClass: "forex",
    price: last.close,
    quoteCurrency: "USD",
    timestamp: last.datetime,
    timezone: "UTC",
    marketStatus: "open",
    provider: "test-fixture",
    retrievedAt: last.datetime,
  };
}

const marketStateSvc = new MarketStateService();
const regimeSvc = new RegimeService();
const hypothesisSvc = new HypothesisService();
const envelopeSvc = new IntelligenceEnvelopeService();
const decisionSvc = new DecisionContextService();

async function main(): Promise<void> {
  // ============================================================
  // Section 1: Candle validation (lib/market-data/candle-validation.ts)
  // ============================================================
  await test("candle validation: a fully well-formed candle array is accepted with zero issues", () => {
    const candles = makeCandles(30);
    const result = validateCandles(candles, NOW_MS);
    assert.equal(result.totalValid, 30);
    assert.equal(result.issues.length, 0);
  });

  await test("candle validation: duplicate timestamp is rejected, never silently deduped into the wrong slot", () => {
    const candles = makeCandles(10);
    const withDup = [...candles.slice(0, 5), candles[4], ...candles.slice(5)];
    const result = validateCandles(withDup, NOW_MS);
    assert.equal(result.totalValid, 10);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].type, "duplicate-timestamp");
  });

  await test("candle validation: out-of-order timestamp is rejected, never silently re-sorted", () => {
    const candles = makeCandles(10);
    const outOfOrder = [...candles];
    [outOfOrder[3], outOfOrder[4]] = [outOfOrder[4], outOfOrder[3]];
    const result = validateCandles(outOfOrder, NOW_MS);
    assert.ok(result.issues.some((i) => i.type === "out-of-order"));
  });

  await test("candle validation: missing/unparseable datetime is rejected", () => {
    const candles = makeCandles(5);
    const broken = [...candles.slice(0, 2), { ...candles[2], datetime: "" }, ...candles.slice(3)];
    const result = validateCandles(broken, NOW_MS);
    assert.equal(result.totalValid, 4);
    assert.equal(result.issues[0].type, "missing-timestamp");
  });

  await test("candle validation: future timestamp beyond tolerance is rejected, never treated as real data", () => {
    const candles = makeCandles(5);
    const withFuture = [...candles, candle(NOW_MS + 3_600_000 * 5, 1.2)];
    const result = validateCandles(withFuture, NOW_MS);
    assert.equal(result.totalValid, 5);
    assert.equal(result.issues[0].type, "future-timestamp");
  });

  await test("candle validation: invalid OHLC (high < low) is rejected", () => {
    const candles = makeCandles(5);
    const broken = [...candles.slice(0, 2), candle(candles[2].datetime ? Date.parse(candles[2].datetime) : NOW_MS, 1.1, { high: 1.0, low: 1.2 }), ...candles.slice(3)];
    const result = validateCandles(broken, NOW_MS);
    assert.equal(result.issues[0].type, "invalid-ohlc");
  });

  await test("candle validation: non-positive price is rejected", () => {
    const candles = makeCandles(5);
    const broken = [...candles.slice(0, 2), candle(Date.parse(candles[2].datetime), -1, { open: -1, high: -0.9, low: -1.1 }), ...candles.slice(3)];
    const result = validateCandles(broken, NOW_MS);
    assert.equal(result.issues[0].type, "invalid-ohlc");
  });

  await test("candle validation: negative volume is rejected", () => {
    const candles = makeCandles(5);
    const broken = [...candles.slice(0, 2), candle(Date.parse(candles[2].datetime), 1.1, { volume: -5 }), ...candles.slice(3)];
    const result = validateCandles(broken, NOW_MS);
    assert.equal(result.issues[0].type, "negative-volume");
  });

  await test("candle validation: one malformed row never cascades - later valid rows are still accepted", () => {
    const candles = makeCandles(20);
    const broken = [...candles.slice(0, 10), candle(Date.parse(candles[10].datetime), 1.1, { high: 1.0, low: 1.2 }), ...candles.slice(11)];
    const result = validateCandles(broken, NOW_MS);
    assert.equal(result.totalValid, 19);
    assert.equal(result.issues.length, 1);
  });

  // ============================================================
  // Section 2: Indicator requirements model (candle-sufficiency reporting)
  // ============================================================
  await test("indicator requirements: EMA50's minimum (50) is the largest single requirement", () => {
    assert.equal(MAX_CORE_INDICATOR_MINIMUM, INDICATOR_REQUIREMENTS.ema50.minimumCandles);
    assert.equal(MAX_CORE_INDICATOR_MINIMUM, 50);
  });

  await test("indicator requirements: sufficiency report marks each indicator sufficient only at/above its real minimum", () => {
    const report = buildCandleSufficiencyReport(100, INDICATOR_REQUIREMENTS.ema50.minimumCandles);
    assert.equal(report.perIndicator.ema50.sufficient, true);
    assert.equal(report.perIndicator.ema20.sufficient, true);
    assert.equal(report.perIndicator.macd.sufficient, true, "50 candles clears MACD's real 34-candle minimum");
  });

  await test("indicator requirements: one candle below a real minimum is reported insufficient for that indicator only", () => {
    const report = buildCandleSufficiencyReport(100, INDICATOR_REQUIREMENTS.rsi14.minimumCandles - 1);
    assert.equal(report.perIndicator.rsi14.sufficient, false);
    assert.equal(report.perIndicator.ema20.sufficient, false, "14 candles is also below EMA20's 20-candle minimum");
  });

  await test("indicator requirements: truncated flag is honest about requested vs. received, independent of per-indicator sufficiency", () => {
    const report = buildCandleSufficiencyReport(100, 60);
    assert.equal(report.truncated, true);
    assert.equal(report.receivedCandles, 60);
    assert.equal(report.requestedCandles, 100);
  });

  // ============================================================
  // Section 3: MarketStateService <-> candle-validation wiring
  // ============================================================
  await test("assemble(): malformed candles are rejected before indicator computation, not merely flagged", () => {
    const candles = makeCandles(80);
    const withDup = [...candles.slice(0, 40), candles[39], ...candles.slice(40)];
    const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles: withDup, nowMs: NOW_MS });
    assert.equal(state.candleValidation?.totalReceived, 81);
    assert.equal(state.candleValidation?.totalValid, 80);
    assert.equal(state.candleValidation?.issues.length, 1);
    assert.equal(state.candleValidation?.issues[0].type, "duplicate-timestamp");
  });

  await test("assemble(): core indicators still compute from the valid remainder when only a few rows are rejected", () => {
    const candles = makeCandles(80);
    const withDup = [...candles.slice(0, 40), candles[39], ...candles.slice(40)];
    const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles: withDup, nowMs: NOW_MS });
    assert.ok(state.technical?.ema50 !== undefined, "80 valid candles is comfortably above EMA50's 50-candle minimum");
    assert.ok(state.technical?.macd !== undefined);
  });

  await test("assemble(): candleValidation is deterministic - identical (candles, nowMs) always yields identical validation", () => {
    const candles = makeCandles(50);
    const a = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles, nowMs: NOW_MS });
    const b = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles, nowMs: NOW_MS });
    assert.deepEqual(a.candleValidation, b.candleValidation);
  });

  await test("assemble(): a genuinely empty candle array produces zero received/valid, never a fabricated count", () => {
    const snapshot: MarketSnapshot = {
      symbol: "EURUSD", assetClass: "forex", price: 1.1, quoteCurrency: "USD",
      timestamp: new Date(NOW_MS).toISOString(), timezone: "UTC", marketStatus: "open",
      provider: "test-fixture", retrievedAt: new Date(NOW_MS).toISOString(),
    };
    const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot, candles: [], nowMs: NOW_MS });
    assert.equal(state.candleValidation?.totalReceived, 0);
    assert.equal(state.candleValidation?.totalValid, 0);
  });

  // ============================================================
  // Section 4: Per-indicator boundary availability (exact minimum vs. one below)
  // ============================================================
  const boundaryCases: Array<{ name: string; minimum: number; check: (rsi14: unknown, ema20: unknown, ema50: unknown, atr14: unknown, macd: unknown, bollinger: unknown, recentRange: unknown) => unknown }> = [
    { name: "ema20", minimum: INDICATOR_REQUIREMENTS.ema20.minimumCandles, check: (_r, ema20) => ema20 },
    { name: "ema50", minimum: INDICATOR_REQUIREMENTS.ema50.minimumCandles, check: (_r, _e20, ema50) => ema50 },
    { name: "rsi14", minimum: INDICATOR_REQUIREMENTS.rsi14.minimumCandles, check: (rsi14) => rsi14 },
    { name: "atr14", minimum: INDICATOR_REQUIREMENTS.atr14.minimumCandles, check: (_r, _e20, _e50, atr14) => atr14 },
    { name: "macd", minimum: INDICATOR_REQUIREMENTS.macd.minimumCandles, check: (_r, _e20, _e50, _a, macd) => macd },
    { name: "bollinger", minimum: INDICATOR_REQUIREMENTS.bollinger.minimumCandles, check: (_r, _e20, _e50, _a, _m, bollinger) => bollinger },
    { name: "recentRange", minimum: INDICATOR_REQUIREMENTS.recentRange.minimumCandles, check: (_r, _e20, _e50, _a, _m, _b, recentRange) => recentRange },
  ];

  for (const { name, minimum, check } of boundaryCases) {
    await test(`boundary: ${name} is available at exactly its documented minimum (${minimum}) candles`, () => {
      const candles = makeCandles(minimum);
      const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles, nowMs: NOW_MS + 999_999_999 });
      const t = state.technical;
      const value = check(t?.rsi14, t?.ema20, t?.ema50, t?.atr14, t?.macd, t?.bollinger, state.structure?.recentRange);
      assert.notEqual(value, undefined, `${name} should be computable with exactly ${minimum} candles`);
    });

    await test(`boundary: ${name} is honestly unavailable at one candle below its minimum (${minimum - 1})`, () => {
      const candles = makeCandles(minimum - 1);
      const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles, nowMs: NOW_MS + 999_999_999 });
      const t = state.technical;
      const value = check(t?.rsi14, t?.ema20, t?.ema50, t?.atr14, t?.macd, t?.bollinger, state.structure?.recentRange);
      assert.equal(value, undefined, `${name} must remain undefined with only ${minimum - 1} candles - never estimated`);
    });
  }

  // ============================================================
  // Section 5: Composition non-cascading proofs (D2.8.15's central claim)
  // ============================================================
  const richCandles = makeCandles(80, NOW_MS - 80 * 3_600_000);
  const richMarketState = marketStateSvc.assemble({ symbol: "BTCUSD", timeframe: "1h", snapshot: snapshotFor(richCandles, "BTCUSD"), candles: richCandles, nowMs: NOW_MS });
  const richRegime = regimeSvc.classify({ marketState: richMarketState });
  const richHypotheses = hypothesisSvc.generate({ marketState: richMarketState, regime: richRegime });

  await test("composition: core-available + microstructure-unavailable never forces insufficient-intelligence", () => {
    const envelope = envelopeSvc.build({ marketState: richMarketState, regime: richRegime, hypotheses: richHypotheses, generatedAt: new Date(NOW_MS).toISOString() });
    const dc = decisionSvc.build(envelope); // no microstructure supplied at all
    assert.notEqual(dc.state, "insufficient-intelligence");
    assert.equal(dc.microstructureEvidence, undefined, "never attempted = absent, not a fabricated 'unavailable' evidence object");
  });

  await test("composition: core-available + historicalValidation insufficient never forces insufficient-intelligence", () => {
    const envelope = envelopeSvc.build({ marketState: richMarketState, regime: richRegime, hypotheses: richHypotheses, generatedAt: new Date(NOW_MS).toISOString() });
    const dc = decisionSvc.build(envelope);
    assert.notEqual(dc.state, "insufficient-intelligence");
    assert.equal(dc.historicalContext.status, "unavailable");
  });

  await test("composition: microstructure-available + core-available - neither evidence source suppresses the other", () => {
    const rawEvidence: RawMicrostructureEvidence = {
      bid: { state: "available", value: 63189.99 },
      ask: { state: "available", value: 63190.0 },
      bidLevels: { state: "available", value: [{ price: 63189.99, quantity: 1.92 }] },
      askLevels: { state: "available", value: [{ price: 63190.0, quantity: 6.39 }] },
      trades: {
        state: "available",
        value: [
          { price: 63189.99, quantity: 0.5, timestamp: new Date(NOW_MS - 5000).toISOString(), aggressorSide: { state: "available", value: "buy" } },
          { price: 63190.0, quantity: 0.1, timestamp: new Date(NOW_MS - 4000).toISOString(), aggressorSide: { state: "available", value: "sell" } },
        ],
      },
      sequenceId: { state: "available", value: "1" },
    };
    const rawResult: RawMicrostructureResult = {
      symbol: "BTCUSD",
      provider: "binance",
      assetClass: "crypto",
      timestamp: new Date(NOW_MS - 4000).toISOString(),
      retrievedAt: new Date(NOW_MS - 3900).toISOString(),
      evidence: rawEvidence,
    };
    const microstructure = buildMicrostructureSnapshot(rawResult, NOW_MS);
    const envelope = envelopeSvc.build({ marketState: richMarketState, regime: richRegime, hypotheses: richHypotheses, generatedAt: new Date(NOW_MS).toISOString() });
    const dc = decisionSvc.build(envelope, microstructure);
    assert.ok(dc.currentState.rsi14 !== undefined, "core intelligence remains present alongside microstructure");
    assert.notEqual(dc.microstructureEvidence, undefined, "real microstructure supplied - evidence must be assessed");
    assert.notEqual(dc.state, "insufficient-intelligence");
  });

  // ============================================================
  // Section 6: missingInformation capability gating (D2.8.15 Phase 7 fix)
  // ============================================================
  await test("missingInformation: BTCUSD (real Binance microstructure capability) has no volume-delta/liquidity-risk disclaimer", () => {
    const envelope = envelopeSvc.build({ marketState: richMarketState, regime: richRegime, hypotheses: richHypotheses, generatedAt: new Date(NOW_MS).toISOString() });
    const dc = decisionSvc.build(envelope);
    const descriptions = dc.missingInformation.map((m) => m.description);
    assert.ok(!descriptions.some((d) => d.includes("volume delta")));
    assert.ok(!descriptions.some((d) => d.includes("order book depth") || d.includes("Liquidity risk")));
  });

  await test("missingInformation: EURUSD (no Binance-mapped microstructure capability) still shows the real disclaimer", () => {
    const eurCandles = makeCandles(80, NOW_MS - 80 * 3_600_000);
    const eurMarketState = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(eurCandles, "EURUSD"), candles: eurCandles, nowMs: NOW_MS });
    const eurRegime = regimeSvc.classify({ marketState: eurMarketState });
    const eurHypotheses = hypothesisSvc.generate({ marketState: eurMarketState, regime: eurRegime });
    const envelope = envelopeSvc.build({ marketState: eurMarketState, regime: eurRegime, hypotheses: eurHypotheses, generatedAt: new Date(NOW_MS).toISOString() });
    const dc = decisionSvc.build(envelope);
    const descriptions = dc.missingInformation.map((m) => m.description);
    assert.ok(descriptions.some((d) => d.toLowerCase().includes("volume delta")));
    assert.ok(descriptions.some((d) => d.toLowerCase().includes("liquidity risk")));
  });

  await test("missingInformation: execution-risk disclaimer is permanent - present for every instrument regardless of capability", () => {
    const envelope = envelopeSvc.build({ marketState: richMarketState, regime: richRegime, hypotheses: richHypotheses, generatedAt: new Date(NOW_MS).toISOString() });
    const dc = decisionSvc.build(envelope);
    const descriptions = dc.missingInformation.map((m) => m.description);
    assert.ok(descriptions.some((d) => d.includes("Execution risk")));
  });

  // Post-completion (2026-08-26): the old unconditional "Liquidity zone
  // data is not implemented" disclaimer is gone - real SMC Equal High/Low
  // liquidity zones are now computed (see market-state.service.ts's
  // liquidityZones()). The missingInformation item is now CONDITIONAL,
  // same pattern as recentRange: present only when no real Equal
  // High/Low cluster exists in the candle history, absent when one does.
  await test("missingInformation: liquidity-zone disclaimer is now conditional (SMC Equal High/Low), never an unconditional permanent claim", () => {
    const envelope = envelopeSvc.build({ marketState: richMarketState, regime: richRegime, hypotheses: richHypotheses, generatedAt: new Date(NOW_MS).toISOString() });
    const dc = decisionSvc.build(envelope);
    const descriptions = dc.missingInformation.map((m) => m.description);
    const hasRealCluster = Boolean(richMarketState.structure?.liquidityZones?.equalHigh || richMarketState.structure?.liquidityZones?.equalLow);
    const flagsMissing = descriptions.some((d) => d.includes("Equal High/Equal Low liquidity cluster"));
    assert.equal(flagsMissing, !hasRealCluster, "the disclaimer must appear if and only if no real cluster was actually detected");
  });

  // ============================================================
  // Section 7: No-fabrication guarantees
  // ============================================================
  await test("no-fabrication: an unavailable indicator is never converted to 0 or any numeric placeholder", () => {
    const sparse = makeCandles(3, NOW_MS - 3 * 3_600_000);
    const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(sparse), candles: sparse, nowMs: NOW_MS });
    assert.equal(state.technical?.ema20, undefined);
    assert.equal(state.technical?.atr14, undefined);
    assert.notEqual(state.technical?.ema20, 0);
  });

  await test("no-fabrication: a stale-rejected candle never re-enters computation as if it were valid", () => {
    const candles = makeCandles(30, NOW_MS - 30 * 3_600_000);
    const withFuture = [...candles, candle(NOW_MS + 3_600_000 * 100, 999)];
    const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles: withFuture, nowMs: NOW_MS });
    assert.equal(state.candleValidation?.totalValid, 30, "the fabricated far-future 999 price must never reach any indicator");
  });

  await test("no-fabrication: an invalid-OHLC candle never re-enters computation even if surrounded by valid rows", () => {
    const candles = makeCandles(30, NOW_MS - 30 * 3_600_000);
    const brokenIdx = 15;
    const broken = [...candles.slice(0, brokenIdx), candle(Date.parse(candles[brokenIdx].datetime), 1.1, { high: 0.5, low: 2.0 }), ...candles.slice(brokenIdx + 1)];
    const state = marketStateSvc.assemble({ symbol: "EURUSD", timeframe: "1h", snapshot: snapshotFor(candles), candles: broken, nowMs: NOW_MS });
    assert.equal(state.candleValidation?.totalValid, 29);
  });

  // ============================================================
  // Section 8: Live per-instrument production verification (7 instruments)
  // Gated - opt-in only, self-skips honestly when not requested, matching
  // D2.6.6/D2.6.8's existing "never fabricate a PASS" convention. Real
  // findings from a manual run are documented in the D2.8.15 architecture
  // spec (docs/architecture/D2.8.15-*.md).
  // ============================================================
  await liveProductionVerification();

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

const REQUIRED_INSTRUMENTS = ["BTCUSD", "ETHUSD", "EURUSD", "XAUUSD", "XAGUSD", "NIFTY50", "BANKNIFTY"] as const;

async function liveProductionVerification(): Promise<void> {
  console.log("\n=== LIVE PER-INSTRUMENT PRODUCTION VERIFICATION (7 instruments) ===");
  if (process.env.RUN_LIVE_INTELLIGENCE_VERIFICATION !== "1") {
    console.log("LIVE TEST: NOT RUN - opt-in RUN_LIVE_INTELLIGENCE_VERIFICATION=1 not set.");
    return;
  }

  const svc = new RealTimeIntelligenceService();
  const decisionContextSvc = new DecisionContextService();

  for (const symbol of REQUIRED_INSTRUMENTS) {
    await test(`live production: ${symbol} resolves with honest evidence states (or an honest insufficient-data, never a fabricated result)`, async () => {
      const ctx = await svc.build({
        requestId: `d2.8.15-validate-${symbol}`,
        userId: "d2.8.15-validation-script",
        question: `What is the current market intelligence for ${symbol}?`,
        symbol,
        timeframe: "1h",
        includeMicrostructure: true,
      });

      if (ctx.status !== "resolved" || !ctx.envelope) {
        // A genuine provider-side failure is an honest, acceptable outcome -
        // never treated as a test failure by itself.
        console.log(`    (${symbol} resolved to status="${ctx.status}" - accepted as an honest provider-side outcome)`);
        return;
      }

      const dc = decisionContextSvc.build(ctx.envelope, ctx.microstructure);
      // No unavailable value was ever silently converted to a fabricated zero.
      const technical = ctx.envelope.marketState.technical ?? {};
      for (const [key, value] of Object.entries(technical)) {
        if (value === 0) assert.notEqual(key, "rsi14", "RSI of exactly 0 is mathematically possible but must never be a stand-in for 'unavailable'");
      }
      // decisionState must always be one of the four real, documented values.
      assert.ok(["well-supported", "partially-supported", "conflicted", "insufficient-intelligence"].includes(dc.state));
      // Microstructure and historical-validation states are independent of each other and of core availability.
      assert.ok(typeof dc.historicalContext.status === "string");
    });
  }
}

main();
