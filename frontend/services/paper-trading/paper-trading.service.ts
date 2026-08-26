// services/paper-trading/paper-trading.service.ts
// Paper Trading Engine, Phase P1 - a fully isolated, database-only
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
// - The margin check compares a new position's required margin against
//   `balance - usedMargin` (a real, disclosed simplification - true
//   free-margin is equity-based, which would need a live snapshot for
//   EVERY open position on every check; deferred to Phase P2 alongside
//   automatic margin-call/stop-out, which needs the same background
//   price-evaluation mechanism).
import { prisma } from "@/lib/prisma";
import { marketData as sharedMarketData } from "@/services/market-data/shared-instance";
import { Errors } from "@/services/backend/ErrorHandler";
import type { MarketDataService } from "@/services/market-data/market-data.service";
import type { MarketSymbol } from "@/types/market";
import type { PaperAccountSummary, PaperPositionView, OpenPositionInput } from "@/types/paper-trading";

export const DEFAULT_STARTING_BALANCE = 10000;
export const DEFAULT_LEVERAGE = 100;

interface PaperPositionRow {
  id: string;
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  marginUsed: number;
  status: string;
  exitPrice: number | null;
  realizedPnl: number | null;
  openedAt: Date;
  closedAt: Date | null;
}

function toView(row: PaperPositionRow): PaperPositionView {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side === "sell" ? "sell" : "buy",
    quantity: row.quantity,
    entryPrice: row.entryPrice,
    marginUsed: row.marginUsed,
    status: row.status === "closed" ? "closed" : "open",
    exitPrice: row.exitPrice ?? undefined,
    realizedPnl: row.realizedPnl ?? undefined,
    openedAt: row.openedAt.toISOString(),
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
    const usedMargin = positions.filter((p) => p.status === "open").reduce((sum, p) => sum + p.marginUsed, 0);
    return {
      balance: account.balance,
      leverage: account.leverage,
      createdAt: account.createdAt.toISOString(),
      resetAt: account.resetAt.toISOString(),
      usedMargin,
      positions: positions.map(toView),
    };
  }

  /** Market order only in Phase P1 - see this file's own header for the fill/margin rules. */
  async openPosition(userId: string, input: OpenPositionInput): Promise<PaperPositionView> {
    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      throw Errors.validation("quantity must be a positive, finite number");
    }
    if (input.side !== "buy" && input.side !== "sell") {
      throw Errors.validation("side must be 'buy' or 'sell'");
    }

    const account = await this.getOrCreateAccount(userId);
    const snapshot = await this.marketData.getSnapshot({ symbol: input.symbol as MarketSymbol });
    if (snapshot.bid === undefined || snapshot.ask === undefined) {
      throw Errors.serviceUnavailable(`No real bid/ask is available for ${input.symbol} right now - cannot fill a market order`);
    }
    const entryPrice = input.side === "buy" ? snapshot.ask : snapshot.bid;
    const marginUsed = (input.quantity * entryPrice) / account.leverage;

    const openPositions = await prisma.paperPosition.findMany({ where: { accountId: account.id, status: "open" } });
    const usedMargin = openPositions.reduce((sum, p) => sum + p.marginUsed, 0);
    const freeMargin = account.balance - usedMargin;
    if (marginUsed > freeMargin) {
      throw Errors.validation(`Insufficient margin: this position needs ${marginUsed.toFixed(2)}, only ${freeMargin.toFixed(2)} free`, {
        marginUsed,
        freeMargin,
      });
    }

    const row = await prisma.paperPosition.create({
      data: {
        accountId: account.id,
        symbol: input.symbol,
        side: input.side,
        quantity: input.quantity,
        entryPrice,
        marginUsed,
        status: "open",
      },
    });
    return toView(row);
  }

  async closePosition(userId: string, positionId: string): Promise<PaperPositionView> {
    const account = await this.getOrCreateAccount(userId);
    const position = await prisma.paperPosition.findUnique({ where: { id: positionId } });
    if (!position || position.accountId !== account.id) throw Errors.notFound("Position");
    if (position.status !== "open") throw Errors.validation("Position is already closed");

    const snapshot = await this.marketData.getSnapshot({ symbol: position.symbol as MarketSymbol });
    if (snapshot.bid === undefined || snapshot.ask === undefined) {
      throw Errors.serviceUnavailable(`No real bid/ask is available for ${position.symbol} right now - cannot close at market`);
    }
    const exitPrice = position.side === "buy" ? snapshot.bid : snapshot.ask;
    const realizedPnl = (exitPrice - position.entryPrice) * position.quantity * (position.side === "buy" ? 1 : -1);

    const [updated] = await prisma.$transaction([
      prisma.paperPosition.update({
        where: { id: position.id },
        data: { status: "closed", exitPrice, realizedPnl, closedAt: new Date() },
      }),
      prisma.paperTradingAccount.update({
        where: { id: account.id },
        data: { balance: { increment: realizedPnl } },
      }),
    ]);
    return toView(updated);
  }

  /** Discards all open positions (0 realized P&L - never a fabricated flat close at a fetched price) and restores the $10,000 starting balance. */
  async resetAccount(userId: string): Promise<PaperAccountSummary> {
    const account = await this.getOrCreateAccount(userId);
    await prisma.$transaction([
      prisma.paperPosition.updateMany({
        where: { accountId: account.id, status: "open" },
        data: { status: "closed", realizedPnl: 0, closedAt: new Date() },
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
