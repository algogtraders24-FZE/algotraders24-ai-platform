"use client";

// components/chart-engine/PaperTradingPanel.tsx
// Paper Trading Engine, Phase P1. Slots into NativeChart.tsx in the exact
// same vertical stack MicrostructurePanel already occupies, gated the
// same way MicrostructurePanel's own hypothesisType already is
// (`symbol === activeSymbol`) - only the primary/active pane renders it,
// so a 2x2 tiled layout never shows 4 redundant copies of the whole
// account. Reuses useLiveQuote (already established for the chart's own
// price marker) for both the order-entry preview and each open position's
// live P&L - no second polling mechanism.
//
// A fully isolated, database-only simulation - no real money, no
// live-account connectivity. Market orders only in Phase P1 (limit
// orders/automatic margin-call are Phase P2, not built here).
import { useCallback, useEffect, useState } from "react";
import { usePaperTrading } from "@/context/PaperTradingContext";
import { useLiveQuote } from "./useLiveQuote";
import Badge from "@/components/ui/Badge";
import Modal from "@/components/ui/Modal";
import StatField from "@/components/workspace/StatField";
import { formatPrice, formatDecimalQuantity } from "@/lib/financial-format";
import { FIN_LABEL, FIN_PRIMARY, FIN_SECONDARY, FIN_TERTIARY } from "@/components/ui/financial-typography";
import type { PaperPositionSide, PaperPositionView } from "@/types/paper-trading";

export interface PaperTradingPanelProps {
  symbol: string;
  isActive: boolean;
}

/** The real close-side price for a position: closing a Buy crosses the spread at bid, closing a Sell at ask - the same real spread-crossing convention paper-trading.service.ts's own closePosition() uses server-side. */
function livePnl(position: PaperPositionView, quote: { bid: number; ask: number } | undefined): number | undefined {
  if (!quote) return undefined;
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
      <td className={`py-1.5 pr-3 ${FIN_SECONDARY}`}>{formatPrice(position.entryPrice, { maxDecimals: 5 })}</td>
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

export default function PaperTradingPanel({ symbol, isActive }: PaperTradingPanelProps) {
  const { account, loaded, openPosition, closePosition, reset } = usePaperTrading();
  const quote = useLiveQuote(symbol);

  const [side, setSide] = useState<PaperPositionSide>("buy");
  const [quantity, setQuantity] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closingId, setClosingId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [pnlById, setPnlById] = useState<Record<string, number | undefined>>({});

  const onPnlChange = useCallback((id: string, pnl: number | undefined) => {
    setPnlById((prev) => (prev[id] === pnl ? prev : { ...prev, [id]: pnl }));
  }, []);

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
  const totalUnrealizedPnl = openPositions.reduce((sum, p) => sum + (pnlById[p.id] ?? 0), 0);
  const equity = account.balance + totalUnrealizedPnl;
  const freeMargin = account.balance - account.usedMargin;
  const marginLevel = account.usedMargin > 0 ? (equity / account.usedMargin) * 100 : undefined;

  const parsedQuantity = Number(quantity);
  const quantityValid = Number.isFinite(parsedQuantity) && parsedQuantity > 0;
  const previewPrice = quote ? (side === "buy" ? quote.ask : quote.bid) : undefined;
  const previewMargin = previewPrice !== undefined && quantityValid ? (parsedQuantity * previewPrice) / account.leverage : undefined;

  async function handleSubmit() {
    setSubmitting(true);
    setError(undefined);
    try {
      await openPosition({ symbol, side, quantity: parsedQuantity });
      setQuantity("");
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
          <span className={FIN_SECONDARY}>{marginLevel === undefined ? "—" : `${marginLevel.toFixed(0)}%`}</span>
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
        <label className="flex flex-col gap-0.5">
          <span className={FIN_LABEL}>Quantity ({symbol})</span>
          <input
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="0.00"
            className={`w-28 rounded-control border border-border bg-ink px-2 py-1 text-sm text-text ${FIN_PRIMARY}`}
          />
        </label>
        <div className="text-[11px] text-text-3">
          {previewPrice !== undefined ? (
            <>
              Fill ≈ {formatPrice(previewPrice, { maxDecimals: 5 })} · Margin ≈{" "}
              {previewMargin !== undefined ? formatPrice(previewMargin, { maxDecimals: 2 }) : "—"}
            </>
          ) : (
            "Waiting for a live price…"
          )}
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!quantityValid || previewPrice === undefined}
          className="rounded-control border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-semibold text-gold transition hover:bg-gold/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Place Order
        </button>
      </div>

      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}

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
        Simulated account - no real money, never connects to your live MT5 account. Market orders fill at the real live bid/ask. 1:{account.leverage}{" "}
        leverage is this simulation&apos;s own parameter, not a claim about any real broker account. Margin call/stop-out is not automatic yet - manage
        your own risk.
      </p>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Confirm ${side === "buy" ? "Buy" : "Sell"} ${symbol}`}>
        <p className="text-sm text-text-2">
          {side === "buy" ? "Buy" : "Sell"} {quantity} {symbol} at ≈{" "}
          {previewPrice !== undefined ? formatPrice(previewPrice, { maxDecimals: 5 }) : "—"} (the real live price at fill time may differ slightly).
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
}
