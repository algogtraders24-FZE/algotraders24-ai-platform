"use client";

// components/chart-engine/PaperTradingPanel.tsx
// Paper Trading Engine, Phase P1/P2. Slots into NativeChart.tsx in the
// exact same vertical stack MicrostructurePanel already occupies, gated
// the same way MicrostructurePanel's own hypothesisType already is
// (`symbol === activeSymbol`) - only the primary/active pane renders it,
// so a 2x2 tiled layout never shows 4 redundant copies of the whole
// account. Reuses useLiveQuote (already established for the chart's own
// price marker) for both the order-entry preview and each open position's
// live P&L - no second polling mechanism.
//
// A fully isolated, database-only simulation - no real money, no
// live-account connectivity. Phase P2 adds Limit orders (a pending order
// section, separate from the open-positions table - a pending order has
// no entry price/live P&L yet, so it would be dishonest to render it in
// the same row shape) and a Margin Call warning badge (the automatic
// Stop Out itself happens server-side - see paper-trading.service.ts's
// checkStopOut() - this panel only reflects its outcome via the normal
// refetch, same as any other position-count/balance change).
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { usePaperTrading } from "@/context/PaperTradingContext";
import { useLiveQuote } from "./useLiveQuote";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import StatField from "@/components/workspace/StatField";
import { formatPrice, formatDecimalQuantity } from "@/lib/financial-format";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY } from "@/components/ui/financial-typography";
import type { PaperOrderType, PaperPositionSide, PaperPositionView } from "@/types/paper-trading";

export interface PaperTradingPanelProps {
  symbol: string;
  isActive: boolean;
}

// Phase P2 - the common, well-documented MT5 industry-standard Margin
// Call warning threshold (verified via mql5.com/broker help docs - see
// paper-trading.service.ts's own header for the matching Stop Out
// research). This is display-only here - the real forced closure at
// STOP_OUT_LEVEL_PCT (50) happens server-side.
const MARGIN_CALL_LEVEL_PCT = 100;

/** Post-completion phase - the imperative surface a chart click on the Buy/Ask or Sell/Bid trade line drives (NativeChart.tsx). Kept minimal and behavior-only (never a data getter) - it just does exactly what clicking the panel's own BUY/SELL toggle does. */
export interface PaperTradingPanelHandle {
  quickTrade: (side: PaperPositionSide) => void;
}

/** The real close-side price for a position: closing a Buy crosses the spread at bid, closing a Sell at ask - the same real spread-crossing convention paper-trading.service.ts's own closePosition() uses server-side. entryPrice is only genuinely absent for a "pending" position - PositionRow below is only ever given "open" ones (PendingOrderRow handles pending separately), but the type stays honest/optional across every status, so this guards the theoretical case rather than asserting it away. */
function livePnl(position: PaperPositionView, quote: { bid: number; ask: number } | undefined): number | undefined {
  if (!quote || position.entryPrice === undefined) return undefined;
  const currentPrice = position.side === "buy" ? quote.bid : quote.ask;
  return (currentPrice - position.entryPrice) * position.quantity * (position.side === "buy" ? 1 : -1);
}

function PositionRow({
  position,
  onClose,
  closing,
  onPnlChange,
}: {
  position: PaperPositionView;
  onClose: (id: string) => void;
  closing: boolean;
  onPnlChange: (id: string, pnl: number | undefined) => void;
}) {
  const quote = useLiveQuote(position.symbol);
  const pnl = livePnl(position, quote);

  useEffect(() => {
    onPnlChange(position.id, pnl);
  }, [position.id, pnl, onPnlChange]);

  const pnlClass = pnl === undefined ? FIN_TERTIARY : pnl >= 0 ? "text-signal-up" : "text-signal-down";
  const livePrice = quote ? (position.side === "buy" ? quote.bid : quote.ask) : undefined;

  return (
    <tr className="border-t border-border">
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{position.symbol}</td>
      <td className="py-1.5 pr-3">
        <Badge tone={position.side === "buy" ? "success" : "danger"}>{position.side.toUpperCase()}</Badge>
      </td>
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{formatDecimalQuantity(position.quantity)}</td>
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{position.entryPrice !== undefined ? formatPrice(position.entryPrice, { maxDecimals: 5 }) : "—"}</td>
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{livePrice !== undefined ? formatPrice(livePrice, { maxDecimals: 5 }) : "—"}</td>
      <td className={`py-1.5 pr-3 fin-num font-mono ${pnlClass}`}>
        {pnl === undefined ? "—" : `${pnl >= 0 ? "+" : ""}${formatPrice(pnl, { maxDecimals: 2 })}`}
      </td>
      <td className="py-1.5">
        <button
          type="button"
          onClick={() => onClose(position.id)}
          disabled={closing}
          className="rounded-control border border-border px-2 py-1 text-xs text-text-2 transition hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {closing ? "Closing…" : "Close"}
        </button>
      </td>
    </tr>
  );
}

/** Phase P2 - a pending limit order has no entry price/live P&L yet (honestly so, until fillPendingLimitOrders() genuinely crosses limitPrice) - a distinct row shape from PositionRow above, never forced into the same columns with fabricated placeholder values. */
function PendingOrderRow({ position, onCancel, cancelling }: { position: PaperPositionView; onCancel: (id: string) => void; cancelling: boolean }) {
  return (
    <tr className="border-t border-border">
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{position.symbol}</td>
      <td className="py-1.5 pr-3">
        <Badge tone={position.side === "buy" ? "success" : "danger"}>{position.side.toUpperCase()}</Badge>
      </td>
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{formatDecimalQuantity(position.quantity)}</td>
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{position.limitPrice !== undefined ? formatPrice(position.limitPrice, { maxDecimals: 5 }) : "—"}</td>
      <td className="py-1.5">
        <button
          type="button"
          onClick={() => onCancel(position.id)}
          disabled={cancelling}
          className="rounded-control border border-border px-2 py-1 text-xs text-text-2 transition hover:border-danger hover:text-danger disabled:opacity-50"
        >
          {cancelling ? "Cancelling…" : "Cancel"}
        </button>
      </td>
    </tr>
  );
}

const PaperTradingPanel = forwardRef<PaperTradingPanelHandle, PaperTradingPanelProps>(function PaperTradingPanel({ symbol, isActive }, ref) {
  const { account, loaded, openPosition, closePosition, cancelPosition, reset } = usePaperTrading();
  const quote = useLiveQuote(symbol);

  const [side, setSide] = useState<PaperPositionSide>("buy");
  const [orderType, setOrderType] = useState<PaperOrderType>("market");
  const [quantity, setQuantity] = useState("");
  const [limitPrice, setLimitPrice] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closingId, setClosingId] = useState<string | undefined>(undefined);
  const [cancellingId, setCancellingId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pnlById, setPnlById] = useState<Record<string, number | undefined>>({});
  const quantityInputRef = useRef<HTMLInputElement>(null);

  const onPnlChange = useCallback((id: string, pnl: number | undefined) => {
    setPnlById((prev) => (prev[id] === pnl ? prev : { ...prev, [id]: pnl }));
  }, []);

  // Post-completion phase - a chart trade-line click always sets the
  // clicked direction AND forces orderType back to "market" - real MT5's
  // own "click the bid/ask price" One Click Trading is specifically an
  // instant-market-execution shortcut, never a way to set a limit
  // trigger price (a moving live line has no stable price to anchor a
  // pending order to). If a real quantity is already typed, it goes
  // straight to the SAME confirm modal "Place Order" uses (never a
  // separate, second order-submission path) - otherwise it just focuses
  // the quantity input, since a quantity-less order can't be confirmed
  // either way.
  useImperativeHandle(
    ref,
    () => ({
      quickTrade: (clickedSide: PaperPositionSide) => {
        setSide(clickedSide);
        setOrderType("market");
        setError(undefined);
        const parsed = Number(quantity);
        if (Number.isFinite(parsed) && parsed > 0) {
          setConfirmOpen(true);
        } else {
          quantityInputRef.current?.focus();
        }
      },
    }),
    [quantity],
  );

  if (!isActive) return null;

  if (!loaded) {
    return (
      <div className="rounded-control border border-border bg-ink-3 px-3 py-2">
        <span className={FIN_LABEL}>Loading paper trading account…</span>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="rounded-control border border-border bg-ink-3 px-3 py-2">
        <p className={FIN_LABEL}>Paper Trading</p>
        <p className={`${FIN_TERTIARY} mt-0.5`}>Could not load your paper trading account.</p>
      </div>
    );
  }

  const openPositions = account.positions.filter((p) => p.status === "open");
  const pendingOrders = account.positions.filter((p) => p.status === "pending");
  const totalUnrealizedPnl = openPositions.reduce((sum, p) => sum + (pnlById[p.id] ?? 0), 0);
  const equity = account.balance + totalUnrealizedPnl;
  const freeMargin = account.balance - account.usedMargin;
  const marginLevel = account.usedMargin > 0 ? (equity / account.usedMargin) * 100 : undefined;
  const marginCallActive = marginLevel !== undefined && marginLevel <= MARGIN_CALL_LEVEL_PCT;

  const parsedQuantity = Number(quantity);
  const quantityValid = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const parsedLimitPrice = Number(limitPrice);
  const limitPriceValid = Number.isFinite(parsedLimitPrice) && parsedLimitPrice > 0;
  const previewPrice = quote ? (side === "buy" ? quote.ask : quote.bid) : undefined;
  // Phase P2 - a limit order's margin is estimated from its OWN
  // limitPrice (real MT5 convention, see paper-trading.service.ts's own
  // header) - never the live price, which the order isn't filling at.
  const marginPreviewPrice = orderType === "limit" ? (limitPriceValid ? parsedLimitPrice : undefined) : previewPrice;
  const previewMargin = marginPreviewPrice !== undefined && quantityValid ? (parsedQuantity * marginPreviewPrice) / account.leverage : undefined;
  const canSubmit = quantityValid && (orderType === "market" ? previewPrice !== undefined : limitPriceValid);

  async function handleSubmit() {
    setSubmitting(true);
    setError(undefined);
    try {
      await openPosition({
        symbol,
        side,
        quantity: parsedQuantity,
        orderType,
        limitPrice: orderType === "limit" ? parsedLimitPrice : undefined,
      });
      setQuantity("");
      setLimitPrice("");
      setConfirmOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to open position");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClose(id: string) {
    setClosingId(id);
    setError(undefined);
    try {
      await closePosition(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close position");
    } finally {
      setClosingId(undefined);
    }
  }

  async function handleCancel(id: string) {
    setCancellingId(id);
    setError(undefined);
    try {
      await cancelPosition(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel order");
    } finally {
      setCancellingId(undefined);
    }
  }

  async function handleReset() {
    await reset();
    setResetConfirmOpen(false);
  }

  return (
    <div className="rounded-control border border-border bg-ink-3 px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={FIN_LABEL}>Paper Trading</p>
        <button
          type="button"
          onClick={() => setResetConfirmOpen(true)}
          className="text-[11px] text-text-3 underline decoration-dotted hover:text-text-2"
        >
          Reset Account
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <StatField label="Balance">
          <span className={FIN_PRIMARY}>{formatPrice(account.balance, { maxDecimals: 2 })}</span>
        </StatField>
        <StatField label="Equity">
          <span className={FIN_PRIMARY}>{formatPrice(equity, { maxDecimals: 2 })}</span>
        </StatField>
        <StatField label="Used Margin">
          <span className={FIN_SECONDARY}>{formatPrice(account.usedMargin, { maxDecimals: 2 })}</span>
        </StatField>
        <StatField label="Free Margin">
          <span className={FIN_SECONDARY}>{formatPrice(freeMargin, { maxDecimals: 2 })}</span>
        </StatField>
        <StatField label="Margin Level">
          <span className={marginCallActive ? "text-danger fin-num font-mono" : FIN_SECONDARY}>
            {marginLevel === undefined ? "—" : `${marginLevel.toFixed(0)}%`}
          </span>
          {marginCallActive && <Badge tone="danger" className="ml-1.5">Margin Call</Badge>}
        </StatField>
        <StatField label="Leverage">
          <span className={FIN_SECONDARY}>1:{account.leverage}</span>
        </StatField>
      </div>

      <div className="mt-2.5 flex flex-wrap items-end gap-2 border-t border-border pt-2.5">
        <div className="flex overflow-hidden rounded-control border border-border">
          <button
            type="button"
            onClick={() => setSide("buy")}
            className={`px-3 py-1.5 text-xs font-semibold ${side === "buy" ? "bg-success/15 text-success" : "text-text-3"}`}
          >
            BUY
          </button>
          <button
            type="button"
            onClick={() => setSide("sell")}
            className={`px-3 py-1.5 text-xs font-semibold ${side === "sell" ? "bg-danger/15 text-danger" : "text-text-3"}`}
          >
            SELL
          </button>
        </div>
        <div className="flex overflow-hidden rounded-control border border-border">
          <button
            type="button"
            onClick={() => setOrderType("market")}
            className={`px-3 py-1.5 text-xs font-semibold ${orderType === "market" ? "bg-gold/15 text-gold" : "text-text-3"}`}
          >
            MARKET
          </button>
          <button
            type="button"
            onClick={() => setOrderType("limit")}
            className={`px-3 py-1.5 text-xs font-semibold ${orderType === "limit" ? "bg-gold/15 text-gold" : "text-text-3"}`}
          >
            LIMIT
          </button>
        </div>
        <label className="flex flex-col gap-0.5">
          <span className={FIN_LABEL}>Quantity ({symbol})</span>
          <input
            ref={quantityInputRef}
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.00"
            className={`w-28 rounded-control border border-border bg-ink px-2 py-1 text-sm text-text ${FIN_PRIMARY}`}
          />
        </label>
        {orderType === "limit" && (
          <label className="flex flex-col gap-0.5">
            <span className={FIN_LABEL}>Limit Price</span>
            <input
              type="number"
              min="0"
              step="any"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder="0.00000"
              className={`w-28 rounded-control border border-border bg-ink px-2 py-1 text-sm text-text ${FIN_PRIMARY}`}
            />
          </label>
        )}
        <div className="text-[11px] text-text-3">
          {orderType === "market" ? (
            previewPrice !== undefined ? (
              <>
                Fill ≈ {formatPrice(previewPrice, { maxDecimals: 5 })} · Margin ≈{" "}
                {previewMargin !== undefined ? formatPrice(previewMargin, { maxDecimals: 2 }) : "—"}
              </>
            ) : (
              "Waiting for a live price…"
            )
          ) : (
            <>
              Fills only when the real live price reaches {limitPriceValid ? formatPrice(parsedLimitPrice, { maxDecimals: 5 }) : "your limit price"} · Margin
              ≈ {previewMargin !== undefined ? formatPrice(previewMargin, { maxDecimals: 2 }) : "—"}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!canSubmit}
          className="rounded-control border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Place Order
        </button>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}

      {pendingOrders.length > 0 && (
        <div className="mt-2.5 overflow-x-auto border-t border-border pt-2.5">
          <p className={`${FIN_LABEL} mb-1`}>Pending Orders</p>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className={FIN_LABEL}>
                <th className="pb-1.5 pr-3">Symbol</th>
                <th className="pb-1.5 pr-3">Side</th>
                <th className="pb-1.5 pr-3">Qty</th>
                <th className="pb-1.5 pr-3">Limit Price</th>
                <th className="pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {pendingOrders.map((p) => (
                <PendingOrderRow key={p.id} position={p} onCancel={handleCancel} cancelling={cancellingId === p.id} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {openPositions.length > 0 && (
        <div className="mt-2.5 overflow-x-auto border-t border-border pt-2.5">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className={FIN_LABEL}>
                <th className="pb-1.5 pr-3">Symbol</th>
                <th className="pb-1.5 pr-3">Side</th>
                <th className="pb-1.5 pr-3">Qty</th>
                <th className="pb-1.5 pr-3">Entry</th>
                <th className="pb-1.5 pr-3">Live</th>
                <th className="pb-1.5 pr-3">P&amp;L</th>
                <th className="pb-1.5" />
              </tr>
            </thead>
            <tbody>
              {openPositions.map((p) => (
                <PositionRow key={p.id} position={p} onClose={handleClose} closing={closingId === p.id} onPnlChange={onPnlChange} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-text-3">
        Simulated account - no real money, never connects to your live MT5 account. Market orders fill at the real live bid/ask; a limit order fills at
        exactly your limit price once the real price reaches it. 1:{account.leverage} leverage is this simulation&apos;s own parameter, not a claim about
        any real broker account. Margin Call is a {MARGIN_CALL_LEVEL_PCT}% warning; Stop Out automatically closes your largest-losing position(s) once
        margin level reaches 50% - both are the common MT5 industry-standard levels, not this specific broker&apos;s own settings.
      </p>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Confirm ${side === "buy" ? "Buy" : "Sell"} ${orderType === "limit" ? "Limit " : ""}${symbol}`}
      >
        <p className="text-sm text-text-2">
          {orderType === "market" ? (
            <>
              {side === "buy" ? "Buy" : "Sell"} {quantity} {symbol} at ≈{" "}
              {previewPrice !== undefined ? formatPrice(previewPrice, { maxDecimals: 5 }) : "—"} (the real live price at fill time may differ slightly).
            </>
          ) : (
            <>
              {side === "buy" ? "Buy" : "Sell"} {quantity} {symbol} once the real price reaches{" "}
              {limitPriceValid ? formatPrice(parsedLimitPrice, { maxDecimals: 5 }) : "—"}. This order stays pending - it may never fill if the price
              doesn&apos;t reach it.
            </>
          )}{" "}
          Required margin ≈ {previewMargin !== undefined ? formatPrice(previewMargin, { maxDecimals: 2 }) : "—"}.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-control border border-border px-3 py-1.5 text-xs text-text-2">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-control border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold disabled:opacity-50"
          >
            {submitting ? "Placing…" : "Confirm"}
          </button>
        </div>
      </Modal>

      <Modal open={resetConfirmOpen} onClose={() => setResetConfirmOpen(false)} title="Reset Paper Trading Account">
        <p className="text-sm text-text-2">
          This discards all open positions and restores your balance to {formatPrice(10000, { maxDecimals: 0 })}. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setResetConfirmOpen(false)}
            className="rounded-control border border-border px-3 py-1.5 text-xs text-text-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="rounded-control border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger"
          >
            Reset
          </button>
        </div>
      </Modal>
    </div>
  );
});

export default PaperTradingPanel;
