// scripts/validate-paper-trading.ts
// Paper Trading Engine, Phase P1/P2 - a fully isolated, database-only
// simulation (no real money, no live-account connectivity). Exercises
// services/paper-trading/paper-trading.service.ts against the REAL
// database (PaperTradingAccount/PaperPosition, added by this feature's
// migration), same "real data, self-cleaning" convention as
// validate-chart-template-persistence.ts. A fake SnapshotSource replaces
// MarketDataService with a controllable bid/ask fixture - no live network
// call in the default suite. Synthetic papertrading<timestamp>-tagged
// user, hard-deleted in a `finally` block. Phase P2 adds limit orders
// (fillPendingLimitOrders) and automatic Stop Out (checkStopOut) -
// exercised directly (unit-level) here, and via onPriceObserved() (the
// combined real entry point the market-data snapshot route actually
// calls) at the end.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import {
  PaperTradingService,
  DEFAULT_STARTING_BALANCE,
  DEFAULT_LEVERAGE,
  STOP_OUT_LEVEL_PCT,
  type SnapshotSource,
} from "../services/paper-trading/paper-trading.service";
import type { MarketSnapshot } from "../types/market-snapshot";

const RUN_TAG = `papertrading-${Date.now()}`;

let passed = 0;
let failed = 0;

/** Phase P2 - entryPrice/marginUsed are now optional on PaperPositionView (honestly absent for a "pending" limit order). Every call site below opens a MARKET order, which always has both set immediately - this asserts that real invariant at runtime (never silently substitutes 0) so the rest of each test can use a plain `number`. */
function requireDefined(value: number | undefined, label: string): number {
  assert.ok(value !== undefined, `expected ${label} to be defined for a filled market order`);
  return value as number;
}

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

function fakeSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    symbol: "EURUSD",
    assetClass: "forex",
    price: 1.1,
    bid: 1.0999,
    ask: 1.1001,
    quoteCurrency: "USD",
    timestamp: new Date().toISOString(),
    timezone: "UTC",
    marketStatus: "open",
    provider: "fake",
    retrievedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A controllable fake - one test can change `.next` mid-run (e.g. to simulate price moving before a close). */
function fakeSource(initial: MarketSnapshot): SnapshotSource & { next: MarketSnapshot } {
  const state = { next: initial };
  return {
    get next() {
      return state.next;
    },
    set next(v: MarketSnapshot) {
      state.next = v;
    },
    async getSnapshot() {
      return state.next;
    },
  };
}

async function main(): Promise<void> {
  const user = await prisma.user.create({ data: { email: `${RUN_TAG}@internal.test`, name: "Paper Trading Test User" } });

  try {
    await test("getOrCreateAccount() creates a real $10,000/1:100 account on first access", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      const account = await svc.getOrCreateAccount(user.id);
      assert.equal(account.balance, DEFAULT_STARTING_BALANCE);
      assert.equal(account.leverage, DEFAULT_LEVERAGE);
    });

    await test("getOrCreateAccount() is idempotent - a second call returns the SAME account, never a duplicate", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      const a = await svc.getOrCreateAccount(user.id);
      const b = await svc.getOrCreateAccount(user.id);
      assert.equal(a.id, b.id);
    });

    await test("openPosition('buy') fills at the real ASK, never mid-price or bid", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000 });
      assert.equal(position.entryPrice, 1.1001);
      assert.equal(position.side, "buy");
      assert.equal(position.status, "open");
    });

    await test("openPosition('sell') fills at the real BID, never mid-price or ask", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "sell", quantity: 1000 });
      assert.equal(position.entryPrice, 1.0999);
    });

    await test("marginUsed = (quantity * entryPrice) / leverage - the real, disclosed 1:100 default", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000 });
      const expected = (1000 * 1.1001) / DEFAULT_LEVERAGE;
      assert.ok(Math.abs(requireDefined(position.marginUsed, "marginUsed") - expected) < 1e-9);
    });

    await test("openPosition() rejects a market order when the snapshot has no real bid/ask - never a mid-price/estimated fill", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: undefined, ask: undefined })));
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "XAUUSD", side: "buy", quantity: 1 }));
    });

    await test("openPosition() rejects when the position's required margin exceeds free margin (balance - already-used margin) - no silent over-leveraging", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      // Enough quantity that margin required (~11,001) exceeds the fresh $10,000 balance at 1:100 leverage.
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1_000_000 }));
    });

    await test("openPosition() rejects a non-positive or non-finite quantity", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 0 }));
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: -5 }));
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: Number.NaN }));
    });

    await test("closePosition() on a real BUY: realizedPnl = (exitPrice(bid) - entryPrice) * quantity, and the account balance updates by exactly that amount", async () => {
      const source = fakeSource(fakeSnapshot({ bid: 1.1, ask: 1.1002 }));
      const svc = new PaperTradingService(source);
      const before = await svc.getSummary(user.id);
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000 });
      // Price moves up before close - real profit for a long.
      source.next = fakeSnapshot({ bid: 1.11, ask: 1.1102 });
      const closed = await svc.closePosition(user.id, position.id);
      const expectedPnl = (1.11 - requireDefined(position.entryPrice, "entryPrice")) * 1000;
      assert.ok(Math.abs((closed.realizedPnl ?? 0) - expectedPnl) < 1e-9);
      assert.equal(closed.exitPrice, 1.11);
      assert.equal(closed.status, "closed");
      const after = await svc.getSummary(user.id);
      assert.ok(Math.abs(after.balance - (before.balance + expectedPnl)) < 1e-6);
    });

    await test("closePosition() on a real SELL: realizedPnl = (entryPrice - exitPrice(ask)) * quantity - the mirrored short-side formula", async () => {
      const source = fakeSource(fakeSnapshot({ bid: 1.1, ask: 1.1002 }));
      const svc = new PaperTradingService(source);
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "sell", quantity: 1000 });
      // Price moves down before close - real profit for a short.
      source.next = fakeSnapshot({ bid: 1.09, ask: 1.0902 });
      const closed = await svc.closePosition(user.id, position.id);
      const expectedPnl = (requireDefined(position.entryPrice, "entryPrice") - 1.0902) * 1000;
      assert.ok(Math.abs((closed.realizedPnl ?? 0) - expectedPnl) < 1e-9);
      assert.equal(closed.exitPrice, 1.0902);
    });

    await test("closePosition() rejects when the snapshot has no real bid/ask - never a mid-price/estimated close", async () => {
      const source = fakeSource(fakeSnapshot({ bid: 1.1, ask: 1.1002 }));
      const svc = new PaperTradingService(source);
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100 });
      source.next = fakeSnapshot({ bid: undefined, ask: undefined });
      await assert.rejects(() => svc.closePosition(user.id, position.id));
    });

    await test("closePosition() rejects an already-closed position - never a double-realized P&L", async () => {
      const source = fakeSource(fakeSnapshot({ bid: 1.1, ask: 1.1002 }));
      const svc = new PaperTradingService(source);
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100 });
      await svc.closePosition(user.id, position.id);
      await assert.rejects(() => svc.closePosition(user.id, position.id));
    });

    await test("closePosition() rejects a position id that doesn't belong to this user - never lets one user close another's position", async () => {
      const otherUser = await prisma.user.create({ data: { email: `${RUN_TAG}-other@internal.test`, name: "Other User" } });
      try {
        const source = fakeSource(fakeSnapshot({ bid: 1.1, ask: 1.1002 }));
        const svc = new PaperTradingService(source);
        const position = await svc.openPosition(otherUser.id, { symbol: "EURUSD", side: "buy", quantity: 100 });
        await assert.rejects(() => svc.closePosition(user.id, position.id));
      } finally {
        await prisma.paperPosition.deleteMany({ where: { account: { userId: otherUser.id } } });
        await prisma.paperTradingAccount.deleteMany({ where: { userId: otherUser.id } });
        await prisma.user.delete({ where: { id: otherUser.id } });
      }
    });

    await test("getSummary().usedMargin sums ONLY currently-open positions, never closed ones", async () => {
      const source = fakeSource(fakeSnapshot({ bid: 1.1, ask: 1.1002 }));
      const svc = new PaperTradingService(source);
      await svc.resetAccount(user.id); // clean slate for this test's own math
      const p1 = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100 });
      const p2 = await svc.openPosition(user.id, { symbol: "EURUSD", side: "sell", quantity: 100 });
      await svc.closePosition(user.id, p1.id);
      const summary = await svc.getSummary(user.id);
      const stillOpen = summary.positions.find((p) => p.id === p2.id);
      assert.ok(stillOpen);
      assert.ok(
        Math.abs(summary.usedMargin - requireDefined(stillOpen!.marginUsed, "marginUsed")) < 1e-9,
        "usedMargin must equal exactly the one still-open position's margin, not include the closed one",
      );
    });

    await test("resetAccount() discards open positions at 0 realized P&L (never a fabricated flat close at a fetched price) and restores the $10,000 balance", async () => {
      const source = fakeSource(fakeSnapshot({ bid: 1.1, ask: 1.1002 }));
      const svc = new PaperTradingService(source);
      await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100 });
      const summary = await svc.resetAccount(user.id);
      assert.equal(summary.balance, DEFAULT_STARTING_BALANCE);
      assert.equal(summary.positions.filter((p) => p.status === "open").length, 0);
      const wasOpen = summary.positions.find((p) => p.status === "closed" && p.realizedPnl === 0);
      assert.ok(wasOpen, "the discarded position must be closed with exactly 0 realized P&L, not a computed close price");
      assert.equal(wasOpen!.exitPrice, undefined, "a reset-discarded position must never carry a fabricated exit price");
    });

    // ============================================================
    // Phase P2 - limit orders
    // ============================================================
    await test("openPosition(orderType='limit') creates a real 'pending' order - no entryPrice yet, but marginUsed IS computed immediately from limitPrice (the real MT5 convention - a pending order reserves margin at placement)", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000, orderType: "limit", limitPrice: 1.09 });
      assert.equal(position.status, "pending");
      assert.equal(position.orderType, "limit");
      assert.equal(position.limitPrice, 1.09);
      assert.equal(position.entryPrice, undefined, "a pending limit order must never carry a fabricated entry price");
      const expectedMargin = (1000 * 1.09) / DEFAULT_LEVERAGE;
      assert.ok(Math.abs(requireDefined(position.marginUsed, "marginUsed") - expectedMargin) < 1e-9);
    });

    await test("openPosition(orderType='limit') rejects a missing or non-positive limitPrice", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100, orderType: "limit" }));
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100, orderType: "limit", limitPrice: 0 }));
      await assert.rejects(() => svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100, orderType: "limit", limitPrice: -5 }));
    });

    await test("getSummary().usedMargin includes PENDING limit orders too, not only open positions", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      await svc.resetAccount(user.id);
      const pending = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000, orderType: "limit", limitPrice: 1.09 });
      const summary = await svc.getSummary(user.id);
      assert.ok(Math.abs(summary.usedMargin - requireDefined(pending.marginUsed, "marginUsed")) < 1e-9);
    });

    await test("openPosition() rejects a limit order whose margin (open + already-pending) exceeds free margin - no silent over-reservation", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      await svc.resetAccount(user.id);
      // 1,000,000 units at 1.09 / 100 leverage = 10,900 margin - exceeds the fresh $10,000 balance.
      await assert.rejects(() =>
        svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1_000_000, orderType: "limit", limitPrice: 1.09 }),
      );
    });

    await test("cancelPendingOrder() withdraws a pending limit order with zero balance change - margin was reserved, never deducted", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      await svc.resetAccount(user.id);
      const before = await svc.getSummary(user.id);
      const pending = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000, orderType: "limit", limitPrice: 1.09 });
      const cancelled = await svc.cancelPendingOrder(user.id, pending.id);
      assert.equal(cancelled.status, "cancelled");
      const after = await svc.getSummary(user.id);
      assert.equal(after.balance, before.balance);
      assert.equal(after.usedMargin, 0, "a cancelled order must no longer be counted in usedMargin");
    });

    await test("cancelPendingOrder() rejects a position that is already open (must use closePosition instead) or already closed/cancelled", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 1.0999, ask: 1.1001 })));
      const open = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100 });
      await assert.rejects(() => svc.cancelPendingOrder(user.id, open.id));
      const pending = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 100, orderType: "limit", limitPrice: 1.09 });
      await svc.cancelPendingOrder(user.id, pending.id);
      await assert.rejects(() => svc.cancelPendingOrder(user.id, pending.id));
    });

    await test("fillPendingLimitOrders(): a BUY limit fills exactly at limitPrice once the real ask drops to/through it - never before, never at a different price", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      await svc.resetAccount(user.id);
      const pending = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000, orderType: "limit", limitPrice: 1.09 });
      await svc.fillPendingLimitOrders("EURUSD", 1.0999, 1.1001); // ask (1.1001) still above limitPrice (1.09) - must NOT fill
      let summary = await svc.getSummary(user.id);
      assert.equal(summary.positions.find((p) => p.id === pending.id)?.status, "pending");

      await svc.fillPendingLimitOrders("EURUSD", 1.0899, 1.09); // ask reaches exactly limitPrice - must fill
      summary = await svc.getSummary(user.id);
      const filled = summary.positions.find((p) => p.id === pending.id);
      assert.equal(filled?.status, "open");
      assert.equal(filled?.entryPrice, 1.09, "must fill at exactly limitPrice, never the observed ask itself or an interpolated value");
      assert.ok(filled?.filledAt, "filledAt must be stamped once a limit order genuinely fills");
    });

    await test("fillPendingLimitOrders(): a SELL limit fills exactly at limitPrice once the real bid rises to/through it", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      await svc.resetAccount(user.id);
      const pending = await svc.openPosition(user.id, { symbol: "EURUSD", side: "sell", quantity: 1000, orderType: "limit", limitPrice: 1.11 });
      await svc.fillPendingLimitOrders("EURUSD", 1.0999, 1.1001); // bid still below limitPrice - must NOT fill
      let summary = await svc.getSummary(user.id);
      assert.equal(summary.positions.find((p) => p.id === pending.id)?.status, "pending");

      await svc.fillPendingLimitOrders("EURUSD", 1.11, 1.1102); // bid reaches exactly limitPrice - must fill
      summary = await svc.getSummary(user.id);
      const filled = summary.positions.find((p) => p.id === pending.id);
      assert.equal(filled?.status, "open");
      assert.equal(filled?.entryPrice, 1.11);
    });

    await test("fillPendingLimitOrders() never touches a pending order on a DIFFERENT symbol", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      await svc.resetAccount(user.id);
      const pending = await svc.openPosition(user.id, { symbol: "GBPUSD", side: "buy", quantity: 1000, orderType: "limit", limitPrice: 1.35 });
      await svc.fillPendingLimitOrders("EURUSD", 1.0, 1.0); // a real crossing price, but for a different symbol entirely
      const summary = await svc.getSummary(user.id);
      assert.equal(summary.positions.find((p) => p.id === pending.id)?.status, "pending");
    });

    // ============================================================
    // Phase P2 - automatic Stop Out
    // ============================================================
    await test(`checkStopOut(): closes the largest-losing open position on the observed symbol once margin level genuinely drops to/below ${STOP_OUT_LEVEL_PCT}% - closeReason='stop_out', balance updated by the exact realized P&L`, async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 100, ask: 100 })));
      await svc.resetAccount(user.id);
      // A large, heavily-leveraged position: entry 100, quantity chosen so
      // marginUsed is a real, meaningful fraction of the $10,000 balance -
      // then the price crashes far enough that floating loss alone drops
      // margin level to/below the real 50% stop-out threshold.
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 5000 });
      // marginUsed = 5000*100/100 = 5000. A crash to bid=50 gives floating
      // P&L = (50-100)*5000 = -250,000 - equity goes deeply negative,
      // margin level far below 50% - an unambiguous, real stop-out case.
      await svc.checkStopOut("EURUSD", 50, 50.02);
      const summary = await svc.getSummary(user.id);
      const closed = summary.positions.find((p) => p.id === position.id);
      assert.equal(closed?.status, "closed");
      assert.equal(closed?.closeReason, "stop_out");
      assert.equal(closed?.exitPrice, 50, "a stop-out close on a BUY must exit at the real bid, the same real spread-crossing convention manual closes use");
      const expectedPnl = (50 - 100) * 5000;
      assert.ok(Math.abs((closed?.realizedPnl ?? 0) - expectedPnl) < 1e-6);
      assert.ok(Math.abs(summary.balance - (DEFAULT_STARTING_BALANCE + expectedPnl)) < 1e-6);
    });

    await test("checkStopOut(): never closes anything when margin level is genuinely healthy", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 100, ask: 100 })));
      await svc.resetAccount(user.id);
      const position = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 10 });
      await svc.checkStopOut("EURUSD", 100.01, 100.02); // a real, small profitable move
      const summary = await svc.getSummary(user.id);
      assert.equal(summary.positions.find((p) => p.id === position.id)?.status, "open", "a healthy account must never have a position force-closed");
    });

    await test("checkStopOut() never touches an account with no open position on the observed symbol", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot({ bid: 100, ask: 100 })));
      await svc.resetAccount(user.id);
      const position = await svc.openPosition(user.id, { symbol: "GBPUSD", side: "buy", quantity: 10 });
      await svc.checkStopOut("EURUSD", 1, 1); // an extreme crash, but for an entirely different symbol
      const summary = await svc.getSummary(user.id);
      assert.equal(summary.positions.find((p) => p.id === position.id)?.status, "open");
    });

    // ============================================================
    // Phase P2 - onPriceObserved() (the real integration point the
    // market-data snapshot route calls on every real price observation)
    // ============================================================
    await test("onPriceObserved() fills a real limit order AND checks stop-out for the same symbol in one real call - the exact entry point the snapshot route uses", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      await svc.resetAccount(user.id);
      const pending = await svc.openPosition(user.id, { symbol: "EURUSD", side: "buy", quantity: 1000, orderType: "limit", limitPrice: 1.09 });
      await svc.onPriceObserved("EURUSD", 1.0899, 1.09);
      const summary = await svc.getSummary(user.id);
      assert.equal(summary.positions.find((p) => p.id === pending.id)?.status, "open");
    });

    await test("onPriceObserved() is a safe no-op when bid/ask are undefined - never throws, never a fabricated fill", async () => {
      const svc = new PaperTradingService(fakeSource(fakeSnapshot()));
      await assert.doesNotReject(() => svc.onPriceObserved("EURUSD", undefined, undefined));
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await prisma.paperPosition.deleteMany({ where: { account: { userId: user.id } } });
    await prisma.paperTradingAccount.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    console.log("  cleanup - all validation rows removed (user, paper trading account, positions)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
