"use client";
// components/chart-engine/ExecPanel.tsx
// Trade tab: send the current trade plan to the user's OWN MetaTrader 5 through the AT24 Execute EA. Nothing is sent until the user presses
// "Confirm and send" in the review step; the EA then applies its own checks and places (or refuses) the order, and the result comes back here.
// Renders nothing while the bridge is not open to this account (the Trade tab then keeps its "coming soon" card).
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TradePlan } from "@/lib/chart-engine/annotations/plan";
import { marketOrderCheck, planFreshness } from "@/lib/chart-engine/live-price";

interface OrderView { id: string; symbol: string; side: string; kind: string; volume: number; price: number | null; stopLoss: number; takeProfit: number | null; status: string; createdAt: string; ticket: string | null; fillPrice: number | null; reason: string | null }
interface State { enabled: boolean; connected?: boolean; maxLots?: number; orders?: OrderView[] }

const CHIP: Record<string, { label: string; cls: string }> = {
  queued: { label: "Waiting for your EA", cls: "bg-gold/10 text-gold" },
  sent: { label: "Sent to your EA", cls: "bg-gold/15 text-gold" },
  filled: { label: "Filled", cls: "bg-green-500/15 text-green-400" },
  placed: { label: "Limit order placed", cls: "bg-green-500/15 text-green-400" },
  refused: { label: "Refused", cls: "bg-red-500/15 text-red-400" },
  error: { label: "Error", cls: "bg-red-500/15 text-red-400" },
  expired: { label: "Expired", cls: "bg-ink-4 text-text-3" },
  cancelled: { label: "Cancelled", cls: "bg-ink-4 text-text-3" },
  unknown: { label: "Result not reported: check your terminal", cls: "bg-ink-4 text-text-2" },
};

const nonce = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const fmtP = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(2) : Math.abs(n) >= 10 ? n.toFixed(3) : n.toFixed(5));

export default function ExecPanel({ active, symbol, plan, formatPrice, onEnabled, quote }: { active: boolean; symbol: string; plan: TradePlan | null; formatPrice: (n: number) => string; onEnabled?: (enabled: boolean) => void; quote?: { bid: number; ask: number } | null }) {
  const [state, setState] = useState<State | null>(null);
  const [lots, setLots] = useState("0.01");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const nonceRef = useRef<string>(nonce());
  // "plan" = wait at the plan's price (a limit order when the plan is a limit); "market" = enter now at the current price with the plan's stop and target
  const [mode, setMode] = useState<"plan" | "market">("market");

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/private/exec/orders", { cache: "no-store" });
      const j = await r.json();
      if (j?.status === "ok") { setState(j.data as State); onEnabled?.(j.data.enabled === true); }
      else { setState({ enabled: false }); onEnabled?.(false); }
    } catch {
      setState({ enabled: false });
      onEnabled?.(false);
    }
  }, [onEnabled]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(id);
  }, [active, refresh]);

  // a different plan or lot size is a different confirmation
  const p = plan && plan.state === "plan" ? plan : null;
  useEffect(() => { nonceRef.current = nonce(); setReview(false); }, [symbol, p?.entry, p?.stop, p?.target, lots, mode]);

  if (!state || !state.enabled) return null;

  const plainSymbol = symbol.replace(/[^A-Za-z0-9]/g, "");
  const lotsNum = Number(lots);
  const maxLots = state.maxLots ?? 0.1;
  const lotsOk = Number.isFinite(lotsNum) && lotsNum >= 0.01 && lotsNum <= maxLots && Math.round(lotsNum * 100) / 100 === lotsNum;
  const connected = state.connected === true;
  // what is actually sent: a market order is never given a price (the EA then uses the live price: a plan price that is a few seconds old made it refuse with 'price moved')
  const isLimitPlan = p?.entryType === "limit";
  const sendKind: "market" | "limit" = isLimitPlan && mode === "plan" ? "limit" : "market";
  const mid = quote ? (quote.bid + quote.ask) / 2 : undefined;
  const mkt = p && quote ? marketOrderCheck({ dir: p.dir, stop: p.stop, target: p.target }, quote) : null;
  // why this order cannot be sent right now (null = fine)
  const blockReason: string | null = !p ? null : sendKind === "market" ? (mkt && !mkt.ok ? mkt.reason : null) : (mid !== undefined ? planFreshness(p, mid).reason : null);

  async function send() {
    if (!p) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await fetch("/api/private/exec/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: plainSymbol, side: p.dir === "long" ? "buy" : "sell", kind: sendKind, volume: lotsNum, ...(sendKind === "limit" ? { price: p.entry } : {}), stopLoss: p.stop, takeProfit: p.target,
          clientNonce: nonceRef.current, confirm: true, plan: { score: p.score, scoreMax: p.scoreMax, rr: p.rr, source: p.source },
        }),
      });
      const j = await r.json();
      setNotice(j?.status === "ok" ? { ok: true, text: j.data.created ? "Order queued. Your EA will pick it up within a few seconds." : "This order was already queued." } : { ok: false, text: j?.error?.message ?? "The order was not queued." });
    } catch {
      setNotice({ ok: false, text: "The order was not queued." });
    } finally {
      setBusy(false);
      setReview(false);
      nonceRef.current = nonce();
      void refresh();
    }
  }

  async function cancel(id: string) {
    await fetch(`/api/private/exec/orders?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void refresh();
  }

  return (
    <div className="mb-3 flex flex-col gap-3 text-[13px] text-text-2">
      <div className="rounded-lg border border-border bg-ink-3/60 p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-text">Send to my MT5 / MT4</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${connected ? "bg-green-500/15 text-green-400" : "bg-ink-4 text-text-3"}`}>{connected ? "EA connected" : "EA not connected"}</span>
        </div>
        <p className="mt-1 text-text-3">
          {connected ? "Your AT24 Execute EA is polling. It places an order only after you confirm it here, and refuses anything its own checks do not allow." : (
            <>Attach the AT24 Execute EA to your MT5 to send orders from this chart. <Link href="/dashboard/live-sync" className="text-gold underline">Set it up</Link>.</>
          )}
        </p>
      </div>

      {p ? (
        <div className="rounded-lg border border-border bg-ink-3/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">Order from the current plan</p>
          {isLimitPlan && (
            <div className="mb-2 flex gap-1 rounded-md bg-ink-4 p-0.5 text-[12.5px]" role="tablist" aria-label="Order type">
              <button type="button" role="tab" aria-selected={mode === "market"} onClick={() => setMode("market")} className={`flex-1 rounded px-2 py-1 ${mode === "market" ? "bg-gold font-semibold text-ink" : "text-text-2"}`}>{p.dir === "long" ? "Buy now (market)" : "Sell now (market)"}</button>
              <button type="button" role="tab" aria-selected={mode === "plan"} onClick={() => setMode("plan")} className={`flex-1 rounded px-2 py-1 ${mode === "plan" ? "bg-gold font-semibold text-ink" : "text-text-2"}`}>Wait at plan price (limit)</button>
            </div>
          )}
          <p className="text-text">{p.dir === "long" ? "BUY" : "SELL"} {sendKind === "limit" ? "LIMIT" : "MARKET"} {plainSymbol} · entry {sendKind === "limit" ? formatPrice(p.entry) : mkt ? `now ~${formatPrice(mkt.entry)}` : "at the current price"} · stop {formatPrice(p.stop)} · target {formatPrice(p.target)}</p>
          {sendKind === "market" && mkt && mkt.ok && <p className="mt-1 text-[12.5px] text-text-3">At the current price the risk is {formatPrice(mkt.risk)} and the reward is {formatPrice(mkt.reward)} (R:R 1:{mkt.rr.toFixed(2)}{p.entryType === "limit" ? `, the plan at its own price is 1:${p.rr}` : ""}). A market order fills at the broker's price within seconds, so there is no waiting for a zone.</p>}
          <label className="mt-3 flex flex-col gap-1 text-[11px] uppercase text-text-3">Lots (max {maxLots})
            <input value={lots} inputMode="decimal" onChange={(e) => setLots(e.target.value)} className="w-28 rounded-md border border-border bg-ink-3 px-2 py-1.5 text-[13px] text-text focus:border-gold focus:outline-none" />
          </label>
          {blockReason && <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[12.5px] text-amber-200">{blockReason} {sendKind === "limit" && isLimitPlan ? "Switch to Buy / Sell now, or run Re-analyze on the Chat tab." : "Run Re-analyze on the Chat tab, then send the new plan."}</p>}
          {!review ? (
            <button type="button" disabled={!connected || !lotsOk || Boolean(blockReason)} onClick={() => setReview(true)} className="mt-3 w-full rounded-lg bg-gold py-2.5 text-[14px] font-semibold text-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">Review order</button>
          ) : (
            <div className="mt-3 rounded-lg border border-gold/40 bg-gold/5 p-3">
              <p className="font-semibold text-text">Review</p>
              <p className="mt-1">{p.dir === "long" ? "Buy" : "Sell"} {lotsNum} lot {plainSymbol} ({sendKind}). Entry {sendKind === "limit" ? formatPrice(p.entry) : "at the current market price"}, stop {formatPrice(p.stop)}, target {formatPrice(p.target)}. Your EA places it in your own MetaTrader and refuses it if any of its limits is hit.{sendKind === "limit" ? " A limit order waits for price to come to the entry and may never fill." : ""}</p>
              <p className="mt-1 text-[12px] text-text-3">The order is queued only when you press Confirm. A stop loss limits the loss but is not a guarantee, and you can lose the amount at risk.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void send()} className="flex-1 rounded-lg bg-gold py-2 text-[14px] font-semibold text-ink hover:brightness-110 disabled:opacity-50">{busy ? "Sending…" : "Confirm and send"}</button>
                <button type="button" disabled={busy} onClick={() => setReview(false)} className="rounded-lg border border-border bg-ink-3 px-4 py-2 text-text-2 hover:bg-ink-4">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-text-3">No trade plan on this chart right now. Run Analyze on the Chat tab; when a plan appears you can send it here.</p>
      )}

      {notice && <p className={`rounded-lg border p-2.5 text-[12.5px] ${notice.ok ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>{notice.text}</p>}

      {(state.orders ?? []).length > 0 && (
        <div className="rounded-lg border border-border bg-ink-3/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">My orders</p>
          <ul className="flex flex-col gap-2">
            {(state.orders ?? []).map((o) => {
              const chip = CHIP[o.status] ?? CHIP.unknown;
              return (
                <li key={o.id} className="flex items-start justify-between gap-2 border-t border-border pt-2 first:border-t-0 first:pt-0">
                  <span className="min-w-0">
                    <span className="font-medium text-text">{o.symbol}</span> <span className="text-text-3">{o.side} {o.kind} {o.volume}</span>
                    <span className="block truncate tabular-nums text-text-3">{o.price !== null ? fmtP(o.price) : "market"} → stop {fmtP(o.stopLoss)}{o.takeProfit !== null ? `, target ${fmtP(o.takeProfit)}` : ""}</span>
                    {o.reason && <span className="block text-[12px] text-red-300">{o.reason}</span>}
                    {o.ticket && <span className="block text-[12px] text-text-3">ticket #{o.ticket}{o.fillPrice ? ` at ${fmtP(o.fillPrice)}` : ""}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}>{chip.label}</span>
                    {o.status === "queued" && <button type="button" onClick={() => void cancel(o.id)} className="mt-1 block w-full text-[12px] text-text-3 underline hover:text-text">Cancel</button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
