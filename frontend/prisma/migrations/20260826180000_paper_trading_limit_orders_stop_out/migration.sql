-- Paper Trading Engine, Phase P2 - limit orders + automatic margin-call/
-- stop-out. Hand-written (not `prisma migrate dev`), per this repo's
-- established convention. Loosens entryPrice/marginUsed to nullable (a
-- pending limit order has neither yet - see paper-trading.service.ts),
-- adds orderType/limitPrice/filledAt/closeReason, and adds a new index
-- for the symbol-scoped pending-order/open-position lookup
-- (fillPendingLimitOrders()/checkStopOut(), triggered by real price
-- observations on the market-data snapshot route). All existing rows are
-- Phase P1 market orders, already NOT NULL on entryPrice/marginUsed - this
-- migration never touches their values, only loosens the column
-- constraint for future rows.

ALTER TABLE "PaperPosition" ALTER COLUMN "entryPrice" DROP NOT NULL;
ALTER TABLE "PaperPosition" ALTER COLUMN "marginUsed" DROP NOT NULL;

ALTER TABLE "PaperPosition" ADD COLUMN "orderType" TEXT NOT NULL DEFAULT 'market';
ALTER TABLE "PaperPosition" ADD COLUMN "limitPrice" DOUBLE PRECISION;
ALTER TABLE "PaperPosition" ADD COLUMN "filledAt" TIMESTAMP(3);
ALTER TABLE "PaperPosition" ADD COLUMN "closeReason" TEXT;

CREATE INDEX "PaperPosition_symbol_status_idx" ON "PaperPosition"("symbol", "status");
