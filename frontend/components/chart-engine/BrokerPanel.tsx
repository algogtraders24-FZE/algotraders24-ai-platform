"use client";
// components/chart-engine/BrokerPanel.tsx
// Trade tab of the Pro Chart (Phase 1, admin only): the connected MetaTrader account (balance, equity, positions) and an order ticket filled from the
// current plan. An order is sent only after the user presses "Confirm and send" in the review step; live accounts and read-only mode are blocked
// server-side as well. Non-admin users see the "coming soon" card (the status route answers 401/403 for them).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { TradePlan } from "@/lib/chart-engine/annotations/plan";

interface StatusPosition { id: string; type?: string; symbol: string; volume: number; openPrice?: number; currentPrice?: number; profit?: number; stopLoss?: number; takeProfit?: number }
interface Status {
  configured: boolean;
  tradingEnabled?: boolean;
  live?: boolean;
  liveAllowed?: boolean;
  maxLots?: number;
  symbolSuffix?: string;
  account?: { broker?: string; server?: string; currency?: string; balance?: number; equity?: number; freeMargin?: number; leverage?: number; login?: string };
  positions?: StatusPosition[];
}

type Load = { kind: "loading" } | { kind: "denied" } | { kind: "error"; message: string } | { kind: "ok"; data: Status };

const money = (n: number | undefined, cur?: string) => (n === undefined ? "n/a" : `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}${cur ? ` ${cur}` : ""}`);

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data?: T; message?: string }> {
  try {
    const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" }, cache: "no-store" });
    const json = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, status: res.status, message: json?.error?.message ?? `Request failed (${res.status})` };
    return { ok: true, status: res.status, data: (json?.data ?? json) as T };
  } catch {
    return { ok: false, status: 0, message: "Network error" };
  }
}

export default function BrokerPanel({ active, symbol, plan, formatPrice, fallback }: { active: boolean; symbol: string; plan: TradePlan | null; formatPrice: (n: number) => string; fallback: ReactNode }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [lots, setLots] = useState("0.01");
  const [brokerSymbol, setBrokerSymbol] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await api<Status>("/api/private/broker/status");
    if (r.status === 401 || r.status === 403) setLoad({ kind: "denied" });
    else if (!r.ok || !r.data) setLoad({ kind: "error", message: r.message ?? "Could not read the account." });
    else setLoad({ kind: "ok", data: r.data });
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [active, refresh]);

  const suffix = load.kind === "ok" ? load.data.symbolSuffix ?? "" : "";
  useEffect(() => { setBrokerSymbol(`${symbol.replace(/[^A-Za-z0-9]/g, "")}${suffix}`); setReview(false); }, [symbol, suffix]);

  if (load.kind === "denied") return <>{fallback}</>;
  if (load.kind === "loading") return <p className="px-2 pt-10 text-center text-[13px] text-text-3">Reading the account…</p>;
  if (load.kind === "error") {
    return (
      <div className="flex flex-col items-center gap-3 px-2 pt-10 text-center">
        <p className="text-[14px] font-semibold text-text">Broker connection unavailable</p>
        <p className="text-[13px] text-text-3">{load.message}</p>
        <button type="button" onClick={() => void refresh()} className="rounded-lg border border-border bg-ink-3 px-4 py-2 text-[13px] text-text-2 hover:bg-ink-4">Retry</button>
      </div>
    );
  }
  const s = load.data;
  if (!s.configured) {
    return <p className="px-2 pt-10 text-center text-[13px] text-text-3">The MetaTrader connection is not configured on this server yet.</p>;
  }
  const acc = s.account ?? {};
  const live = s.live === true;
  const canSend = s.tradingEnabled === true && (!live || s.liveAllowed === true);
  const blockReason = !s.tradingEnabled ? "Read-only mode: order sending is switched off on the server." : live && !s.liveAllowed ? "This is a live account and live orders are not enabled." : null;
  const p = plan && plan.state === "plan" ? plan : null;
  const lotsNum = Number(lots);
  const lotsOk = Number.isFinite(lotsNum) && lotsNum >= 0.01 && lotsNum <= (s.maxLots ?? 0.1) && Math.round(lotsNum * 100) / 100 === lotsNum;

  const send = async () => {
    if (!p) return;
    setBusy(true);
    setNotice(null);
    const r = await api<{ message?: string }>("/api/private/broker/order", {
      method: "POST",
      body: JSON.stringify({ symbol: brokerSymbol, side: p.dir === "long" ? "buy" : "sell", kind: p.entryType, volume: lotsNum, price: p.entryType === "limit" ? p.entry : undefined, stopLoss: p.stop, takeProfit: p.target, confirm: true }),
    });
    setBusy(false);
    setReview(false);
    setNotice(r.ok ? { ok: true, text: r.data?.message ?? "Order sent." } : { ok: false, text: r.message ?? "The order was not sent." });
    void refresh();
  };
  const close = async (id: string) => {
    if (!window.confirm("Close this position now?")) return;
    setBusy(true);
    const r = await api<{ message?: string }>("/api/private/broker/close", { method: "POST", body: JSON.stringify({ positionId: id, confirm: true }) });
    setBusy(false);
    setNotice(r.ok ? { ok: true, text: "Close request sent." } : { ok: false, text: r.message ?? "Could not close the position." });
    void refresh();
  };

  return (
    <div className="flex flex-col gap-3 text-[13px] text-text-2">
      <div className="rounded-lg border border-border bg-ink-3/60 p-3">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-text">{acc.broker ?? "MetaTrader account"}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${live ? "bg-red-500/15 text-red-400" : "bg-green-500/15 text-green-400"}`}>{live ? "Live" : "Demo"}</span>
        </div>
        <p className="mt-0.5 text-text-3">{acc.server} · {acc.login}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 tabular-nums">
          <div><p className="text-[11px] uppercase text-text-3">Balance</p><p className="text-text">{money(acc.balance, acc.currency)}</p></div>
          <div><p className="text-[11px] uppercase text-text-3">Equity</p><p className="text-text">{money(acc.equity, acc.currency)}</p></div>
        </div>
      </div>

      {blockReason && <p className="rounded-lg border border-border bg-ink-3/60 p-2.5 text-[12.5px] text-text-3">{blockReason}</p>}

      {p ? (
        <div className="rounded-lg border border-border bg-ink-3/60 p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">Order from the current plan</p>
          <p className="text-text">{p.dir === "long" ? "BUY" : "SELL"} {p.entryType === "limit" ? "LIMIT" : "MARKET"} · entry {formatPrice(p.entry)} · stop {formatPrice(p.stop)} · target {formatPrice(p.target)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[11px] uppercase text-text-3">Broker symbol
              <input value={brokerSymbol} onChange={(e) => { setBrokerSymbol(e.target.value.trim()); setReview(false); }} className="rounded-md border border-border bg-ink-3 px-2 py-1.5 text-[13px] normal-case text-text focus:border-gold focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] uppercase text-text-3">Lots (max {s.maxLots})
              <input value={lots} inputMode="decimal" onChange={(e) => { setLots(e.target.value); setReview(false); }} className="rounded-md border border-border bg-ink-3 px-2 py-1.5 text-[13px] text-text focus:border-gold focus:outline-none" />
            </label>
          </div>
          {!review ? (
            <button type="button" disabled={!canSend || !lotsOk || brokerSymbol.length < 3} onClick={() => setReview(true)} className="mt-3 w-full rounded-lg bg-gold py-2.5 text-[14px] font-semibold text-ink hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">Review order</button>
          ) : (
            <div className="mt-3 rounded-lg border border-gold/40 bg-gold/5 p-3">
              <p className="font-semibold text-text">{live ? "LIVE ACCOUNT" : "Demo account"}: review</p>
              <p className="mt-1">{p.dir === "long" ? "Buy" : "Sell"} {lotsNum} lot {brokerSymbol} ({p.entryType}). Entry {formatPrice(p.entry)}, stop {formatPrice(p.stop)}, target {formatPrice(p.target)}.</p>
              <p className="mt-1 text-[12px] text-text-3">The order is sent only when you press Confirm. A stop loss protects the position but is not a guarantee, and you can lose the amount at risk.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={busy} onClick={() => void send()} className="flex-1 rounded-lg bg-gold py-2 text-[14px] font-semibold text-ink hover:brightness-110 disabled:opacity-50">{busy ? "Sending…" : "Confirm and send"}</button>
                <button type="button" disabled={busy} onClick={() => setReview(false)} className="rounded-lg border border-border bg-ink-3 px-4 py-2 text-text-2 hover:bg-ink-4">Cancel</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border p-3 text-text-3">No trade plan on this chart right now. Run Analyze on the Chat tab; when a plan appears, its order ticket shows here.</p>
      )}

      {notice && <p className={`rounded-lg border p-2.5 text-[12.5px] ${notice.ok ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>{notice.text}</p>}

      <div className="rounded-lg border border-border bg-ink-3/60 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-3">Open positions ({s.positions?.length ?? 0})</p>
        {(s.positions ?? []).length === 0 ? <p className="text-text-3">None.</p> : (
          <ul className="flex flex-col gap-2">
            {(s.positions ?? []).map((pos) => (
              <li key={pos.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium text-text">{pos.symbol}</span> <span className="text-text-3">{(pos.type ?? "").replace("POSITION_TYPE_", "").toLowerCase()} {pos.volume}</span>
                  <span className={`block tabular-nums ${(pos.profit ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>{money(pos.profit, acc.currency)}</span>
                </span>
                <button type="button" disabled={busy || !canSend} onClick={() => void close(pos.id)} className="shrink-0 rounded-md border border-border px-2.5 py-1 text-text-2 hover:bg-ink-4 disabled:opacity-40">Close</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
