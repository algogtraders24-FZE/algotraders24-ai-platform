// scripts/validate-microstructure-foundation.ts
// Sprint D2.8.5 - Microstructure Intelligence Foundation. Standalone,
// assert-based verification (no test framework, no real network - matching
// every prior sprint's scripts/validate-*.ts pattern). Run via
// `npm run validate:microstructure-foundation`.
//
// Covers: bid/ask validation (valid/invalid/crossed), spread/mid-price
// derivation, order-book aggregation (valid/invalid quantity), depth
// imbalance (including the zero-depth edge case), Binance's real
// isBuyerMaker aggressor mapping, buy/sell volume + volume delta
// (including the "no aggressor evidence at all" case), order-book
// unavailability propagation, freshness (stale/invalid timestamp), the
// provider capability registry, and an explicit sweep confirming no
// unavailable field is ever silently a fabricated 0/empty value. Two
// end-to-end tests exercise the real BinanceProvider.getMicrostructureSnapshot()
// and MicrostructureSnapshotService.getSnapshot() against a fake, injected
// HTTP transport - no real network call is ever made.
import assert from "node:assert/strict";
import { availableField, unavailableField, notSupportedField, invalidField, hasValue } from "../lib/microstructure/microstructure-field";
import { toBidAskFields, toOrderBookLevelsField, toTradesField, assessMicrostructureFreshness } from "../lib/microstructure/microstructure-validation";
import {
  computeMidPrice,
  computeSpread,
  computeSideDepth,
  computeDepthImbalance,
  computeAggressorVolumes,
  computeVolumeDelta,
  computeLiquidityConcentration,
} from "../lib/microstructure/microstructure-calculation";
import { buildMicrostructureSnapshot, MicrostructureSnapshotService } from "../services/microstructure/microstructure-snapshot.service";
import { getMicrostructureCapabilities } from "../lib/market-data/microstructure-capability-registry";
import { BinanceProvider, type BinanceFetch } from "../lib/market-data/providers/binance.provider";
import { MarketDataProviderError } from "../lib/market-data/errors";
import type { MarketDataProvider } from "../types/market-data-provider";
import type { RawMicrostructureResult } from "../types/microstructure";
import type { Clock } from "../lib/market-data/cache";

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

function fixedClock(nowMs: number): Clock {
  return { now: () => nowMs };
}

function fakeFetch(depthBody: unknown, tradesBody: unknown): BinanceFetch {
  return async (url: string) => {
    const body = url.includes("/depth") ? depthBody : url.includes("/trades") ? tradesBody : {};
    return { ok: true, status: 200, json: async () => body };
  };
}

async function main(): Promise<void> {
  // ---------------------------------------------------------------------
  // 1: valid bid/ask
  // ---------------------------------------------------------------------
  await test("1: valid bid/ask is accepted", () => {
    const { bid, ask } = toBidAskFields(1.5, 1.6);
    assert.equal(bid.state, "available");
    assert.equal(ask.state, "available");
    assert.equal(bid.value, 1.5);
    assert.equal(ask.value, 1.6);
  });

  // ---------------------------------------------------------------------
  // 2: invalid bid
  // ---------------------------------------------------------------------
  await test("2: a non-finite/non-positive bid is rejected as invalid, both fields invalid", () => {
    const { bid, ask } = toBidAskFields(-1, 1.6);
    assert.equal(bid.state, "invalid");
    assert.equal(ask.state, "invalid");
    assert.equal(bid.value, undefined);
  });

  // ---------------------------------------------------------------------
  // 3: invalid ask
  // ---------------------------------------------------------------------
  await test("3: a non-finite ask is rejected as invalid", () => {
    const { bid, ask } = toBidAskFields(1.5, NaN);
    assert.equal(bid.state, "invalid");
    assert.equal(ask.state, "invalid");
  });

  // ---------------------------------------------------------------------
  // 4: crossed market
  // ---------------------------------------------------------------------
  await test("4: a crossed market (ask < bid) is rejected as invalid, never swapped/clamped", () => {
    const { bid, ask } = toBidAskFields(1.6, 1.5);
    assert.equal(bid.state, "invalid");
    assert.equal(ask.state, "invalid");
    assert.ok(bid.reason?.includes("crossed market"));
  });

  // ---------------------------------------------------------------------
  // 5: spread calculation
  // ---------------------------------------------------------------------
  await test("5: spread = ask - bid, only from a valid pair", () => {
    const spread = computeSpread(availableField(1.5), availableField(1.6));
    assert.equal(spread.state, "available");
    assert.ok(Math.abs((spread.value as number) - 0.1) < 1e-9);
  });

  // ---------------------------------------------------------------------
  // 6: mid-price calculation
  // ---------------------------------------------------------------------
  await test("6: midPrice = (bid + ask) / 2", () => {
    const mid = computeMidPrice(availableField(1.5), availableField(1.6));
    assert.equal(mid.state, "available");
    assert.ok(Math.abs((mid.value as number) - 1.55) < 1e-9);
  });

  // ---------------------------------------------------------------------
  // 7: valid order-book aggregation
  // ---------------------------------------------------------------------
  await test("7: valid order-book levels parse and aggregate correctly", () => {
    const levels = toOrderBookLevelsField([
      ["1.5", "2"],
      ["1.4", "3"],
    ]);
    assert.equal(levels.state, "available");
    assert.equal(levels.value?.length, 2);
    const depth = computeSideDepth(levels);
    assert.equal(depth.state, "available");
    assert.equal(depth.value, 5);
  });

  // ---------------------------------------------------------------------
  // 8: invalid order-book quantity
  // ---------------------------------------------------------------------
  await test("8: a negative quantity invalidates the whole order-book side, never silently dropped-and-continued", () => {
    const levels = toOrderBookLevelsField([
      ["1.5", "2"],
      ["1.4", "-3"],
    ]);
    assert.equal(levels.state, "invalid");
  });

  // ---------------------------------------------------------------------
  // 9: depth imbalance
  // ---------------------------------------------------------------------
  await test("9: depthImbalance = (bidDepth - askDepth) / (bidDepth + askDepth)", () => {
    const imbalance = computeDepthImbalance(availableField(10), availableField(5));
    assert.equal(imbalance.state, "available");
    assert.ok(Math.abs((imbalance.value as number) - 1 / 3) < 1e-9);
  });

  // ---------------------------------------------------------------------
  // 10: zero-depth handling
  // ---------------------------------------------------------------------
  await test("10: zero combined depth yields unavailable imbalance, never a fabricated 0", () => {
    const imbalance = computeDepthImbalance(availableField(0), availableField(0));
    assert.equal(imbalance.state, "unavailable");
    assert.equal(imbalance.value, undefined);
  });

  // ---------------------------------------------------------------------
  // 11: Binance aggressor mapping
  // ---------------------------------------------------------------------
  await test("11: Binance's isBuyerMaker maps to aggressorSide exactly per its documented meaning (false=buy, true=sell)", () => {
    const trades = toTradesField(
      [
        { price: "100", qty: "1", time: 1000, isBuyerMaker: false },
        { price: "101", qty: "2", time: 2000, isBuyerMaker: true },
      ],
      (raw) => ({
        price: Number.parseFloat(raw.price),
        quantity: Number.parseFloat(raw.qty),
        timestamp: new Date(raw.time).toISOString(),
        aggressorSide: raw.isBuyerMaker === undefined ? undefined : raw.isBuyerMaker ? "sell" : "buy",
      }),
    );
    assert.equal(trades.state, "available");
    assert.equal(trades.value?.[0].aggressorSide.value, "buy");
    assert.equal(trades.value?.[1].aggressorSide.value, "sell");
  });

  // ---------------------------------------------------------------------
  // 12/13: buy volume, sell volume
  // ---------------------------------------------------------------------
  await test("12/13: buyVolume/sellVolume sum only trades whose real aggressorSide matches", () => {
    const trades = toTradesField(
      [
        { p: 1, q: 1 },
        { p: 1, q: 2 },
        { p: 1, q: 3 },
      ],
      (raw) => ({ price: raw.p, quantity: raw.q, timestamp: "2026-01-01T00:00:00.000Z", aggressorSide: raw.q === 3 ? undefined : raw.q === 1 ? "buy" : "sell" }),
    );
    const { buyVolume, sellVolume } = computeAggressorVolumes(trades);
    assert.equal(buyVolume.state, "available");
    assert.equal(buyVolume.value, 1);
    assert.equal(sellVolume.state, "available");
    assert.equal(sellVolume.value, 2);
  });

  // ---------------------------------------------------------------------
  // 14: volume delta
  // ---------------------------------------------------------------------
  await test("14: volumeDelta = buyVolume - sellVolume", () => {
    const delta = computeVolumeDelta(availableField(10), availableField(4));
    assert.equal(delta.state, "available");
    assert.equal(delta.value, 6);
  });

  // ---------------------------------------------------------------------
  // 15: unavailable aggressor data
  // ---------------------------------------------------------------------
  await test("15: a provider with trades but zero real aggressor evidence yields unavailable buy/sell/volume-delta, never 0", () => {
    const trades = toTradesField([{ p: 1, q: 1 }], (raw) => ({ price: raw.p, quantity: raw.q, timestamp: "2026-01-01T00:00:00.000Z", aggressorSide: undefined }));
    const { buyVolume, sellVolume } = computeAggressorVolumes(trades);
    assert.equal(buyVolume.state, "unavailable");
    assert.equal(sellVolume.state, "unavailable");
    const delta = computeVolumeDelta(buyVolume, sellVolume);
    assert.equal(delta.state, "unavailable");
    assert.equal(delta.value, undefined);
  });

  // ---------------------------------------------------------------------
  // 16: unavailable order book
  // ---------------------------------------------------------------------
  await test("16: depth/imbalance/liquidityConcentration all propagate unavailable order-book levels, never 0/empty", () => {
    const noBook = unavailableField<import("../types/microstructure").MicrostructureOrderBookLevel[]>("provider did not report order-book levels");
    const depth = computeSideDepth(noBook);
    assert.equal(depth.state, "unavailable");
    const concentration = computeLiquidityConcentration(noBook, noBook);
    assert.equal(concentration.state, "unavailable");
  });

  // ---------------------------------------------------------------------
  // 17: stale snapshot
  // ---------------------------------------------------------------------
  await test("17: a real but old timestamp is classified stale, never silently fresh", () => {
    const nowMs = Date.parse("2026-01-01T00:10:00.000Z");
    const oldTimestamp = "2026-01-01T00:00:00.000Z"; // 10 minutes old, well past crypto's 30s threshold
    const status = assessMicrostructureFreshness(oldTimestamp, "crypto", nowMs);
    assert.equal(status, "stale");
  });

  // ---------------------------------------------------------------------
  // 18: invalid timestamp
  // ---------------------------------------------------------------------
  await test("18: a timestamp in the future beyond tolerance is classified invalid, not fresh", () => {
    const nowMs = Date.parse("2026-01-01T00:00:00.000Z");
    const futureTimestamp = "2026-01-01T00:05:00.000Z"; // 5 minutes in the future
    const status = assessMicrostructureFreshness(futureTimestamp, "crypto", nowMs);
    assert.equal(status, "invalid");
  });
  await test("18b: a missing/unparseable timestamp is classified unknown, never guessed fresh", () => {
    const status = assessMicrostructureFreshness(undefined, "crypto", Date.now());
    assert.equal(status, "unknown");
  });

  // ---------------------------------------------------------------------
  // 19: provider capability state
  // ---------------------------------------------------------------------
  await test("19: the capability registry reflects only real, attributed evidence per provider", () => {
    const binance = getMicrostructureCapabilities("binance");
    assert.equal(binance?.capabilities.AGGRESSOR_SIDE, "confirmed");
    assert.equal(binance?.capabilities.ORDER_BOOK_DEPTH, "confirmed");
    const angelOne = getMicrostructureCapabilities("angel-one");
    assert.equal(angelOne?.capabilities.BID_ASK, "not_verified");
    assert.equal(angelOne?.capabilities.AGGRESSOR_SIDE, "unavailable");
    const dukascopy = getMicrostructureCapabilities("dukascopy");
    assert.equal(dukascopy?.capabilities.ORDER_BOOK_DEPTH, "research_only");
  });

  // ---------------------------------------------------------------------
  // 20: no fabricated fallback values
  // ---------------------------------------------------------------------
  await test("20: a snapshot built from all-unavailable raw evidence never contains a fabricated numeric/empty fallback anywhere in derived", () => {
    const noNumber = unavailableField<number>("no evidence");
    const noLevels = unavailableField<import("../types/microstructure").MicrostructureOrderBookLevel[]>("no evidence");
    const noTrades = unavailableField<import("../types/microstructure").MicrostructureTrade[]>("no evidence");
    const raw: RawMicrostructureResult = {
      symbol: "TESTUSD",
      provider: "test-fixture",
      assetClass: "crypto",
      timestamp: "2026-01-01T00:00:00.000Z",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      evidence: { bid: noNumber, ask: noNumber, bidLevels: noLevels, askLevels: noLevels, trades: noTrades, sequenceId: unavailableField("no evidence") },
    };
    const snapshot = buildMicrostructureSnapshot(raw, Date.parse("2026-01-01T00:00:05.000Z"));
    for (const [field, value] of Object.entries(snapshot.derived)) {
      assert.notEqual(value.state, "available", `${field} must not be "available" when built from zero raw evidence`);
      assert.equal(value.value, undefined, `${field} must not carry a value when unavailable`);
    }
  });

  // ---------------------------------------------------------------------
  // 21: not_supported_by_provider propagates through depth (extra coverage)
  // ---------------------------------------------------------------------
  await test("21: a not_supported_by_provider order book propagates that exact state into depth, not a generic unavailable", () => {
    const notSupported = notSupportedField<import("../types/microstructure").MicrostructureOrderBookLevel[]>("this provider has no order-book concept");
    const depth = computeSideDepth(notSupported);
    assert.equal(depth.state, "not_supported_by_provider");
  });

  // ---------------------------------------------------------------------
  // 22: invalid order-book propagation (extra coverage)
  // ---------------------------------------------------------------------
  await test("22: an invalid order book propagates invalid into depth/imbalance, never treated as usable", () => {
    const invalid = invalidField<import("../types/microstructure").MicrostructureOrderBookLevel[]>("malformed level");
    const depth = computeSideDepth(invalid);
    assert.equal(depth.state, "invalid");
    assert.equal(hasValue(depth), false);
  });

  // ---------------------------------------------------------------------
  // 23: end-to-end - real BinanceProvider.getMicrostructureSnapshot() against a fake transport
  // ---------------------------------------------------------------------
  await test("23: BinanceProvider.getMicrostructureSnapshot() produces real bid/ask/depth/aggressor evidence from a realistic fake payload", async () => {
    const depthBody = {
      lastUpdateId: 12345,
      bids: [
        ["62981.37", "1.9"],
        ["62981.30", "0.5"],
      ],
      asks: [
        ["62981.38", "8.4"],
        ["62981.40", "0.3"],
      ],
    };
    const tradesBody = [
      { id: 1, price: "62981.37", qty: "0.01", time: 1_700_000_000_000, isBuyerMaker: false },
      { id: 2, price: "62981.38", qty: "0.02", time: 1_700_000_000_500, isBuyerMaker: true },
    ];
    const provider = new BinanceProvider({ fetchImpl: fakeFetch(depthBody, tradesBody), clock: fixedClock(1_700_000_001_000) });
    const raw = await provider.getMicrostructureSnapshot({ symbol: "BTCUSD" });
    assert.equal(raw.provider, "binance");
    assert.equal(raw.evidence.bid.state, "available");
    assert.equal(raw.evidence.bid.value, 62981.37);
    assert.equal(raw.evidence.ask.state, "available");
    assert.equal(raw.evidence.bidLevels.state, "available");
    assert.equal(raw.evidence.bidLevels.value?.length, 2);
    assert.equal(raw.evidence.trades.state, "available");
    assert.equal(raw.evidence.trades.value?.[0].aggressorSide.value, "buy");
    assert.equal(raw.evidence.trades.value?.[1].aggressorSide.value, "sell");
    assert.equal(raw.evidence.sequenceId.value, "12345");

    const snapshot = buildMicrostructureSnapshot(raw, 1_700_000_001_000);
    assert.equal(snapshot.derived.spread.state, "available");
    assert.equal(snapshot.derived.buyVolume.state, "available");
    assert.equal(snapshot.derived.sellVolume.state, "available");
    assert.equal(snapshot.derived.volumeDelta.state, "available");
  });

  // ---------------------------------------------------------------------
  // 24: orchestrator rejects a provider without microstructure capability
  // ---------------------------------------------------------------------
  await test("24: MicrostructureSnapshotService rejects a provider that does not implement getMicrostructureSnapshot, never silently returns empty", async () => {
    const nonMicrostructureProvider: MarketDataProvider = {
      name: "no-microstructure",
      isConfigured: () => true,
      getMarketContext: async () => {
        throw new Error("not used");
      },
    };
    const svc = new MicrostructureSnapshotService(fixedClock(0));
    await assert.rejects(() => svc.getSnapshot(nonMicrostructureProvider, { symbol: "BTCUSD" }), (err: unknown) => {
      assert.ok(err instanceof MarketDataProviderError);
      assert.equal(err.kind, "unsupported_symbol");
      return true;
    });
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
