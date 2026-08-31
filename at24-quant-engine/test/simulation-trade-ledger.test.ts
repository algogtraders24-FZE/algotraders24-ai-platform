import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrade, TradeLedger } from "../src/runtime/simulation/trade-ledger.js";
import { openPosition } from "../src/runtime/simulation/position-engine.js";
import { computeRealizedR } from "../src/runtime/risk/r-multiple.js";
import type { Instrument } from "../src/domain/market-data.js";

const INSTRUMENT: Instrument = { symbol: "X" };

function positionWithStop(stopLoss: number | undefined) {
  return openPosition({
    id: "p1",
    originatingOrderIntentId: "o1",
    instrument: INSTRUMENT,
    side: "BUY",
    quantity: 10,
    entryPrice: 100,
    entryTimestamp: 0,
    ...(stopLoss !== undefined ? { stopLoss } : {}),
    fee: 0,
  });
}

test("buildTrade computes netPnl = grossPnl - fees", () => {
  const trade = buildTrade({
    tradeId: "t1",
    strategyVersion: "1.0.0",
    position: positionWithStop(95),
    exitPrice: 110,
    exitTimestamp: 5,
    quantity: 10,
    grossPnl: 100,
    fees: 8,
    fillModel: "BarFillModel",
    spreadModel: "ZeroSpread",
    slippageModel: "ZeroSlippage",
    feeModel: "ZeroFee",
  });
  assert.equal(trade.netPnl, 92);
});

test("buildTrade's rMultiple reuses Q0.3's computeRealizedR exactly (no second formula)", () => {
  const trade = buildTrade({
    tradeId: "t1",
    strategyVersion: "1.0.0",
    position: positionWithStop(95),
    exitPrice: 110,
    exitTimestamp: 5,
    quantity: 10,
    grossPnl: 100,
    fees: 0,
    fillModel: "BarFillModel",
    spreadModel: "ZeroSpread",
    slippageModel: "ZeroSlippage",
    feeModel: "ZeroFee",
  });
  const expected = computeRealizedR("BUY", 100, 95, 110);
  assert.equal(trade.rMultiple, expected);
});

test("buildTrade's rMultiple is null (not 0 or NaN) when the position had no stopLoss", () => {
  const trade = buildTrade({
    tradeId: "t1",
    strategyVersion: "1.0.0",
    position: positionWithStop(undefined),
    exitPrice: 110,
    exitTimestamp: 5,
    quantity: 10,
    grossPnl: 100,
    fees: 0,
    fillModel: "BarFillModel",
    spreadModel: "ZeroSpread",
    slippageModel: "ZeroSlippage",
    feeModel: "ZeroFee",
  });
  assert.equal(trade.rMultiple, null);
});

test("TradeLedger.record freezes the trade — mutation attempts throw in strict mode", () => {
  const ledger = new TradeLedger();
  const trade = ledger.record(
    buildTrade({
      tradeId: "t1",
      strategyVersion: "1.0.0",
      position: positionWithStop(95),
      exitPrice: 110,
      exitTimestamp: 5,
      quantity: 10,
      grossPnl: 100,
      fees: 0,
      fillModel: "BarFillModel",
      spreadModel: "ZeroSpread",
      slippageModel: "ZeroSlippage",
      feeModel: "ZeroFee",
    }),
  );
  assert.ok(Object.isFrozen(trade));
  assert.throws(() => {
    (trade as { netPnl: number }).netPnl = 999;
  });
});

test("TradeLedger is append-only: all() returns every recorded trade in order, no update/remove API exists", () => {
  const ledger = new TradeLedger();
  for (let i = 0; i < 3; i++) {
    ledger.record(
      buildTrade({
        tradeId: `t${i}`,
        strategyVersion: "1.0.0",
        position: positionWithStop(95),
        exitPrice: 110,
        exitTimestamp: i,
        quantity: 10,
        grossPnl: 10 * i,
        fees: 0,
        fillModel: "BarFillModel",
        spreadModel: "ZeroSpread",
        slippageModel: "ZeroSlippage",
        feeModel: "ZeroFee",
      }),
    );
  }
  assert.equal(ledger.size(), 3);
  assert.deepEqual(ledger.all().map((t) => t.tradeId), ["t0", "t1", "t2"]);
});

test("TradeLedger.all() returns a defensive copy — external mutation of the returned array does not affect internal state", () => {
  const ledger = new TradeLedger();
  ledger.record(
    buildTrade({
      tradeId: "t1",
      strategyVersion: "1.0.0",
      position: positionWithStop(95),
      exitPrice: 110,
      exitTimestamp: 1,
      quantity: 10,
      grossPnl: 10,
      fees: 0,
      fillModel: "BarFillModel",
      spreadModel: "ZeroSpread",
      slippageModel: "ZeroSlippage",
      feeModel: "ZeroFee",
    }),
  );
  const copy = ledger.all() as unknown[];
  copy.push("intruder");
  assert.equal(ledger.size(), 1);
});
