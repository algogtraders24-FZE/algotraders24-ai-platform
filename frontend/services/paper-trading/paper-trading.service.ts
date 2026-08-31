// services/paper-trading/paper-trading.service.ts
// Paper Trading Engine, Phase P1/P2 - a fully isolated, database-only
// simulation. No real money, no live-account connectivity, no BUY/SELL
// instruction ever reaches the real Exness/MT5 account - this is a
// simulated ledger over PaperTradingAccount/PaperPosition only.
//
// Honesty rules (this platform's non-negotiable discipline, applied here):
// - A market order NEVER fills without a real bid AND ask from
//   MarketDataService - rejected with a typed error otherwise, never a
//   mid-price/estimated fill.
// - Buy fills at the real ask, Sell fills at the real bid (the real
//   spread-crossing convention every real broker, including MT5, uses) -
//   closing a position crosses the spread the OPPOSITE way. P&L therefore
//   always reflects the real trading cost of the spread, never a
//   symmetric mid-to-mid number that hides it.
// - `leverage` (1:100 default) is disclosed as THIS SIMULATION's own
//   parameter - never claimed to be any real MT5/broker account's actual
//   default, which varies per broker/account type.
//
// Phase P2 (limit orders + automatic margin-call/stop-out):
// - A limit order NEVER fills at a fabricated/interpolated price - it
//   fills at EXACTLY limitPrice, only once a real observed bid/ask
//   genuinely crosses it (fillPendingLimitOrders(), below). No slippage
//   modeling in this simulation - a real, disclosed simplification.
// - Margin for a PENDING limit order is estimated from its own
//   limitPrice at PLACEMENT time (the real MT5 convention - a pending
//   order's margin requirement is real and reserved immediately, not
//   deferred until fill).
// - Stop Out level: 50% margin level - the common, well-documented
//   industry-standard MT5 default (verified via mql5.com/broker help
//   docs), used deliberately instead of Exness's own real but unusually
//   lenient 0%/60% retail-account levels, which would undermine this
//   simulation's own risk-management teaching purpose. See
//   STOP_OUT_LEVEL_PCT below.
// - checkStopOut() is a REAL, disclosed simplification: it only prices
//   the SYMBOL that was just observed (piggybacking on real snapshot
//   traffic - see onPriceObserved()) - other open positions in the same
//   account, on a DIFFERENT symbol, contribute their own entry price as
//   a flat 0 floating P&L for this pass (never a fabricated/stale price
//   for them). This means a stop-out driven purely by a DIFFERENT
//   symbol's move might not be caught until THAT symbol is itself next
//   observed - a deliberate, documented tradeoff against adding N extra
//   live provider calls to every single snapshot request this shared,
//   hot route already serves for every viewer of every chart.
import { prisma } from "@/lib/prisma";
import { marketData as sharedMarketData } from "@/services/market-data/shared-instance";
import { Errors } from "@/services/backend/ErrorHandler";
import { logger } from "@/services/backend/Logger";
import type { MarketDataService } from "@/services/market-data/market-data.service";
import type { MarketSymbol } from "@/types/market";
import type { PaperAccountSummary, PaperPositionView, OpenPositionInput } from "@/types/paper-trading";

export const DEFAULT_STARTING_BALANCE = 10000;
export const DEFAULT_LEVERAGE = 100;
// Common, well-documented MT5 industry-standard defaults (not this
// platform's own invention) - Margin Call is a warning threshold only
// (computed client-side already, from each open position's own live
// quote - see PaperTradingPanel.tsx); Stop Out is the real forced-closure
// threshold this service enforces server-side.
export const STOP_OUT_LEVEL_PCT = 50;

const log = logger.child("paper-trading");

interface PaperPositionRow {
  id: string;
  symbol: string;
  side: string;
  orderType: string;
  quantity: number;
  limitPrice: number | null;
  entryPrice: number | null;
  marginUsed: number | null;
  status: string;
  exitPrice: number | null;
  realizedPnl: number | null;
  closeReason: string | null;
  openedAt: Date;
  filledAt: Date | null;
  closedAt: Date | null;
}

function toView(row: PaperPositionRow): PaperPositionView {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side === "sell" ? "sell" : "buy",
    orderType: row.orderType === "limit" ? "limit" : "market",
    quantity: row.quantity,
    limitPrice: row.limitPrice ?? undefined,
    entryPrice: row.entryPrice ?? undefined,
    marginUsed: row.marginUsed ?? undefined,
    status: row.status === "pending" || row.status === "closed" || row.status === "cancelled" ? row.status : "open",
    exitPrice: row.exitPrice ?? undefined,
    realizedPnl: row.realizedPnl ?? undefined,
    closeReason: row.closeReason === "stop_out" ? "stop_out" : row.closeReason === "manual" ? "manual" : undefined,
    openedAt: row.openedAt.toISOString(),
    filledAt: row.filledAt?.toISOString(),
    closedAt: row.closedAt?.toISOString(),
  };
}

/** Minimal shape this service needs from MarketDataService - lets tests inject a fake with a fixed bid/ask fixture instead of the real shared singleton. */
export interface SnapshotSource {
  getSnapshot: MarketDataService["getSnapshot"];
}

export class PaperTradingService {
  constructor(private readonly marketData: SnapshotSource = sharedMarketData) {}

  /** Auto-creates a $10,000/1:100 account on first access - never a separate "onboarding" step. */
  async getOrCreateAccount(userId: string) {
    const existing = await prisma.paperTradingAccount.findUnique({ where: { userId } });
    if (existing) return existing;
    return prisma.paperTradingAccount.create({
      data: { userId, balance: DEFAULT_STARTING_BALANCE, leverage: DEFAULT_LEVERAGE },
    });
  }

  async getSummary(userId: string): Promise<PaperAccountSummary> {
    const account = await this.getOrCreateAccount(userId);
    const positions = await prisma.paperPosition.findMany({
      where: { accountId: account.id },
      orderBy: { openedAt: "desc" },
    });
    // Phase P2 - a pending limit order reserves margin too, the real MT5 convention.
    const usedMargin = positions
      .filter((p) => p.status === "open" || p.status === "pending")
      .reduce((sum, p) => sum + (p.marginUsed ?? 0), 0);
    return {
      balance: account.balance,
      leverage: account.leverage,
      createdAt: account.createdAt.toISOString(),
      resetAt: account.resetAt.toISOString(),
      usedMargin,
      positions: positions.map(toView),
    };
  }

  /** Market order (Phase P1) or limit order (Phase P2) - see this file's own header for the fill/margin rules of each. */
  async openPosition(userId: string, input: OpenPositionInput): Promise<PaperPositionView> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw Errors.validation("quantity must be a positive, finite number");
    }
    if (input.side !== "buy" && input.side !== "sell") {
      throw Errors.validation("side must be 'buy' or 'sell'");
    }
    const orderType = input.orderType === "limit" ? "limit" : "market";

    const account = await this.getOrCreateAccount(userId);

    if (orderType === "limit") {
      if (!Number.isFinite(input.limitPrice) || (input.limitPrice as number) <= 0) {
        throw Errors.validation("limitPrice must be a positive, finite number for a limit order");
      }
      const limitPrice = input.limitPrice as number;
      const marginUsed = (input.quantity * limitPrice) / account.leverage;
      await this.assertFreeMargin(account.id, account.balance, marginUsed);

      const row = await prisma.paperPosition.create({
        data: {
          accountId: account.id,
          symbol: input.symbol,
          side: input.side,
          orderType: "limit",
          quantity: input.quantity,
          limitPrice,
          marginUsed,
          status: "pending",
        },
      });
      return toView(row);
    }

    const snapshot = await this.marketData.getSnapshot({ symbol: input.symbol as MarketSymbol });
    if (snapshot.bid === undefined || snapshot.ask === undefined) {
      throw Errors.serviceUnavailable(`No real bid/ask is available for ${input.symbol} right now - cannot fill a market order`);
    }
    const entryPrice = input.side === "buy" ? snapshot.ask : snapshot.bid;
    const marginUsed = (input.quantity * entryPrice) / account.leverage;
    await this.assertFreeMargin(account.id, account.balance, marginUsed);

    const row = await prisma.paperPosition.create({
      data: {
        accountId: account.id,
        symbol: input.symbol,
        side: input.side,
        orderType: "market",
        quantity: input.quantity,
        entryPrice,
        marginUsed,
        status: "open",
        filledAt: new Date(),
      },
    });
    return toView(row);
  }

  private async assertFreeMargin(accountId: string, balance: number, additionalMarginUsed: number): Promise<void> {
    const existing = await prisma.paperPosition.findMany({
      where: { accountId, status: { in: ["open", "pending"] } },
    });
    const usedMargin = existing.reduce((sum, p) => sum + (p.marginUsed ?? 0), 0);
    const freeMargin = balance - usedMargin;
    if (additionalMarginUsed > freeMargin) {
      throw Errors.validation(`Insufficient margin: this order needs ${additionalMarginUsed.toFixed(2)}, only ${freeMargin.toFixed(2)} free`, {
        marginUsed: additionalMarginUsed,
        freeMargin,
      });
    }
  }

  async closePosition(userId: string, positionId: string): Promise<PaperPositionView> {
    const account = await this.getOrCreateAccount(userId);
    const position = await prisma.paperPosition.findUnique({ where: { id: positionId } });
    if (!position || position.accountId !== account.id) throw Errors.notFound("Position");
    if (position.status !== "open") throw Errors.validation("Position is not open (already closed, cancelled, or still pending)");

    const snapshot = await this.marketData.getSnapshot({ symbol: position.symbol as MarketSymbol });
    if (snapshot.bid === undefined || snapshot.ask === undefined) {
      throw Errors.serviceUnavailable(`No real bid/ask is available for ${position.symbol} right now - cannot close at market`);
    }
    const exitPrice = position.side === "buy" ? snapshot.bid : snapshot.ask;
    const realizedPnl = (exitPrice - (position.entryPrice as number)) * position.quantity * (position.side === "buy" ? 1 : -1);

    const [updated] = await prisma.$transaction([
      prisma.paperPosition.update({
        where: { id: position.id },
        data: { status: "closed", exitPrice, realizedPnl, closeReason: "manual", closedAt: new Date() },
      }),
      prisma.paperTradingAccount.update({
        where: { id: account.id },
        data: { balance: { increment: realizedPnl } },
      }),
    ]);
    return toView(updated);
  }

  /** Phase P2 - withdraws a limit order that hasn't filled yet. Only "pending" is cancellable (an "open" position must be closePosition()'d instead - cancel never touches a real fill). No balance change: a pending order's margin was reserved, never deducted, so releasing it is just the status flip (getSummary()'s usedMargin sum stops counting it the moment it's no longer "open"/"pending"). */
  async cancelPendingOrder(userId: string, positionId: string): Promise<PaperPositionView> {
    const account = await this.getOrCreateAccount(userId);
    const position = await prisma.paperPosition.findUnique({ where: { id: positionId } });
    if (!position || position.accountId !== account.id) throw Errors.notFound("Position");
    if (position.status !== "pending") throw Errors.validation("Only a pending limit order can be cancelled");

    const updated = await prisma.paperPosition.update({
      where: { id: position.id },
      data: { status: "cancelled" },
    });
    return toView(updated);
  }

  /**
   * Phase P2 - fills any pending limit order on `symbol` whose real
   * trigger price has genuinely been crossed by this real observed
   * bid/ask. A buy-limit sits BELOW the market, waiting for a real dip to
   * or through it (fills when ask <= limitPrice); a sell-limit sits ABOVE
   * the market, waiting for a real rally to or through it (fills when
   * bid >= limitPrice) - the same real MT5 pending-order semantics.
   * Conditional UPDATE (`status: "pending"` in the WHERE clause) makes
   * each fill atomic against a concurrent duplicate call for the same
   * symbol (two viewers polling the same chart at once) - only the FIRST
   * call to reach a given row can ever flip it, the second finds 0 rows
   * affected and does nothing.
   */
  async fillPendingLimitOrders(symbol: string, bid: number, ask: number): Promise<void> {
    const pending = await prisma.paperPosition.findMany({
      where: { symbol, status: "pending", orderType: "limit" },
    });
    for (const order of pending) {
      const limitPrice = order.limitPrice as number;
      const crossed = order.side === "buy" ? ask <= limitPrice : bid >= limitPrice;
      if (!crossed) continue;
      const result = await prisma.paperPosition.updateMany({
        where: { id: order.id, status: "pending" },
        data: { status: "open", entryPrice: limitPrice, filledAt: new Date() },
      });
      if (result.count > 0) {
        log.info("limit order filled", { positionId: order.id, symbol, side: order.side, limitPrice });
      }
    }
  }

  /**
   * Phase P2 - closes the largest-losing open position on `symbol`,
   * repeating, for any account whose margin level (equity/usedMargin)
   * has genuinely dropped to/below STOP_OUT_LEVEL_PCT - the real MT5
   * "close positions until the account is safe again" behavior. See this
   * file's own header comment for the real, disclosed single-symbol
   * scoping tradeoff. Never closes a position on a DIFFERENT symbol
   * without a live price for it - staying honest rather than guessing.
   */
  async checkStopOut(symbol: string, bid: number, ask: number): Promise<void> {
    const accountsWithOpenPosition = await prisma.paperPosition.findMany({
      where: { symbol, status: "open" },
      select: { accountId: true },
      distinct: ["accountId"],
    });

    for (const { accountId } of accountsWithOpenPosition) {
      await this.checkStopOutForAccount(accountId, symbol, bid, ask);
    }
  }

  private async checkStopOutForAccount(accountId: string, symbol: string, bid: number, ask: number): Promise<void> {
    let account = await prisma.paperTradingAccount.findUnique({ where: { id: accountId } });
    if (!account) return;

    let openPositions = await prisma.paperPosition.findMany({ where: { accountId, status: "open" } });
    const pendingMargin = (await prisma.paperPosition.findMany({ where: { accountId, status: "pending" } })).reduce(
      (sum, p) => sum + (p.marginUsed ?? 0),
      0,
    );

    // Bounded loop - each iteration closes exactly one position, so this
    // can never exceed the account's own open-position count.
    for (let i = 0; i < openPositions.length; i++) {
      const usedMargin = openPositions.reduce((sum, p) => sum + (p.marginUsed ?? 0), 0) + pendingMargin;
      if (usedMargin <= 0) return;

      // Real, disclosed simplification (see this file's header): only the
      // JUST-observed symbol's position(s) get a genuine floating-P&L
      // contribution this pass - every other symbol contributes 0 (never
      // a stale/fabricated price for it).
      const floatingPnl = openPositions
        .filter((p) => p.symbol === symbol)
        .reduce((sum, p) => {
          const price = p.side === "buy" ? bid : ask;
          return sum + (price - (p.entryPrice as number)) * p.quantity * (p.side === "buy" ? 1 : -1);
        }, 0);
      const equity = account.balance + floatingPnl;
      const marginLevel = (equity / usedMargin) * 100;
      if (marginLevel > STOP_OUT_LEVEL_PCT) return;

      const closeable = openPositions.filter((p) => p.symbol === symbol);
      if (closeable.length === 0) return; // nothing we can honestly close without a live price for it

      closeable.sort((a, b) => {
        const pnlA = ((a.side === "buy" ? bid : ask) - (a.entryPrice as number)) * a.quantity * (a.side === "buy" ? 1 : -1);
        const pnlB = ((b.side === "buy" ? bid : ask) - (b.entryPrice as number)) * b.quantity * (b.side === "buy" ? 1 : -1);
        return pnlA - pnlB; // most negative (largest loser) first
      });
      const target = closeable[0];
      const exitPrice = target.side === "buy" ? bid : ask;
      const realizedPnl = (exitPrice - (target.entryPrice as number)) * target.quantity * (target.side === "buy" ? 1 : -1);

      const [, updatedAccount] = await prisma.$transaction([
        prisma.paperPosition.updateMany({
          where: { id: target.id, status: "open" },
          data: { status: "closed", exitPrice, realizedPnl, closeReason: "stop_out", closedAt: new Date() },
        }),
        prisma.paperTradingAccount.update({
          where: { id: accountId },
          data: { balance: { increment: realizedPnl } },
        }),
      ]);
      log.warn("stop-out closed a position", { accountId, positionId: target.id, symbol, realizedPnl, marginLevel });

      account = updatedAccount;
      openPositions = openPositions.filter((p) => p.id !== target.id);
    }
  }

  /**
   * Phase P2 - the single real entry point for both new mechanisms,
   * called from the market-data snapshot route (app/api/private/market-
   * data/snapshot/route.ts) every time ANY viewer's real price poll
   * observes a fresh bid/ask for a symbol - piggybacking on traffic that
   * was already happening, never a new dedicated polling loop of its
   * own. Deliberately swallows its own errors: a bug here must NEVER
   * break the real snapshot response every chart/quote on the platform
   * depends on.
   */
  async onPriceObserved(symbol: string, bid: number | undefined, ask: number | undefined): Promise<void> {
    if (bid === undefined || ask === undefined) return;
    try {
      await this.fillPendingLimitOrders(symbol, bid, ask);
    } catch (err) {
      log.error("fillPendingLimitOrders failed", { symbol, error: err instanceof Error ? err.message : String(err) });
    }
    try {
      await this.checkStopOut(symbol, bid, ask);
    } catch (err) {
      log.error("checkStopOut failed", { symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Discards all open/pending positions (0 realized P&L for open ones - never a fabricated flat close at a fetched price; pending ones are simply cancelled) and restores the $10,000 starting balance. */
  async resetAccount(userId: string): Promise<PaperAccountSummary> {
    const account = await this.getOrCreateAccount(userId);
    await prisma.$transaction([
      prisma.paperPosition.updateMany({
        where: { accountId: account.id, status: "open" },
        data: { status: "closed", realizedPnl: 0, closeReason: "manual", closedAt: new Date() },
      }),
      prisma.paperPosition.updateMany({
        where: { accountId: account.id, status: "pending" },
        data: { status: "cancelled" },
      }),
      prisma.paperTradingAccount.update({
        where: { id: account.id },
        data: { balance: DEFAULT_STARTING_BALANCE, resetAt: new Date() },
      }),
    ]);
    return this.getSummary(userId);
  }
}

export const paperTradingService = new PaperTradingService();
