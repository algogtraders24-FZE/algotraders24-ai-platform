// scripts/validate-paper-trading.ts
// Paper Trading Engine, Phase P1 - a fully isolated, database-only
// simulation (no real money, no live-account connectivity). Exercises
// services/paper-trading/paper-trading.service.ts against the REAL
// database (PaperTradingAccount/PaperPosition, added by this feature's
// migration), same "real data, self-cleaning" convention as
// validate-chart-template-persistence.ts. A fake SnapshotSource replaces
// MarketDataService with a controllable bid/ask fixture - no live network
// call in the default suite. Synthetic papertrading<timestamp>-tagged
// user, hard-deleted in a `finally` block.
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../lib/prisma";
import { PaperTradingService, DEFAULT_STARTING_BALANCE, DEFAULT_LEVERAGE, type SnapshotSource } from "../services/paper-trading/paper-trading.service";
import type { MarketSnapshot } from "../types/market-snapshot";

const RUN_TAG = `papertrading-${Date.now()}`;

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
      assert.ok(Math.abs(position.marginUsed - expected) < 1e-9);
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
      const expectedPnl = (1.11 - position.entryPrice) * 1000;
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
      const expectedPnl = (position.entryPrice - 1.0902) * 1000;
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
      assert.ok(Math.abs(summary.usedMargin - (stillOpen!.marginUsed)) < 1e-9, "usedMargin must equal exactly the one still-open position's margin, not include the closed one");
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
