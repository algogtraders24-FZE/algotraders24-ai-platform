// app/dashboard/crypto-flow/page.tsx
// Crypto Flow - real buyer / seller aggressor delta for BTC and ETH from the public Binance spot
// 1-minute klines. Descriptive market context, not a signal. Binance spot only (other venues differ).
"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import { CRYPTO_FLOW_SYMBOLS, type CryptoFlowBias, type CryptoFlowResponse, type CryptoFlowSymbol, type CryptoFlowWindow } from "@/types/crypto-flow";

type SymbolState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: CryptoFlowResponse };

const REFRESH_MS = 60_000;
const LABEL: Record<CryptoFlowSymbol, string> = { BTCUSDT: "Bitcoin (BTC/USDT)", ETHUSDT: "Ethereum (ETH/USDT)" };
const UNIT: Record<CryptoFlowSymbol, string> = { BTCUSDT: "BTC", ETHUSDT: "ETH" };

function fmtPrice(v: number): string {
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDelta(v: number): string {
  const abs = Math.abs(v);
  const text = abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
  return `${v >= 0 ? "+" : "-"}${text}`;
}

function tone(v: number): string {
  return v > 0 ? "text-success" : v < 0 ? "text-danger" : "text-text-2";
}

function timeAgo(ms: number): string {
  const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (secs < 90) return "just now";
  return `${Math.floor(secs / 60)} min ago`;
}

/** Point on a circle, angle in degrees measured from the left end of the dial (0 = left, 180 = right), centre (cx, cy). */
function dialPoint(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (Math.PI * (180 - deg)) / 180;
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)];
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const [x1, y1] = dialPoint(cx, cy, r, fromDeg);
  const [x2, y2] = dialPoint(cx, cy, r, toDeg);
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Buy / sell meter: the needle shows the share of the volume bought by aggressive buyers (left = sellers, right = buyers). */
function BuySellGauge({ label, buyPct, big = false }: { label: string; buyPct: number; big?: boolean }) {
  const cx = 100;
  const cy = 100;
  const r = 78;
  const pct = Math.min(100, Math.max(0, buyPct));
  const [nx, ny] = dialPoint(cx, cy, r - 10, (180 * pct) / 100);
  const lean = pct >= 52 ? "text-success" : pct <= 48 ? "text-danger" : "text-text-2";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 118" className={big ? "w-full max-w-xs" : "w-full max-w-[11rem]"} role="img" aria-label={`${label}: buyers ${pct.toFixed(0)} percent, sellers ${(100 - pct).toFixed(0)} percent`}>
        <path d={arcPath(cx, cy, r, 0, 81)} fill="none" stroke="currentColor" strokeWidth="14" className="text-danger" opacity="0.85" />
        <path d={arcPath(cx, cy, r, 81, 99)} fill="none" stroke="currentColor" strokeWidth="14" className="text-text-3" opacity="0.6" />
        <path d={arcPath(cx, cy, r, 99, 180)} fill="none" stroke="currentColor" strokeWidth="14" className="text-success" opacity="0.85" />
        <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-text-1" />
        <circle cx={cx} cy={cy} r="6" fill="currentColor" className="text-text-1" />
        <text x="14" y="116" fontSize="9" fill="currentColor" className="text-danger">SELLERS</text>
        <text x="186" y="116" fontSize="9" textAnchor="end" fill="currentColor" className="text-success">BUYERS</text>
      </svg>
      <div className={`-mt-1 text-sm font-semibold ${lean}`}>
        Buyers {pct.toFixed(0)}% &middot; Sellers {(100 - pct).toFixed(0)}%
      </div>
      <div className="text-xs text-text-3">{label}</div>
    </div>
  );
}

const SIDE_TEXT: Record<CryptoFlowBias["side"], string> = { buyers: "Buyers in control", sellers: "Sellers in control", balanced: "Balanced flow" };

/** One-line summary of who has been the aggressor lately (descriptive, not a forecast). */
function BiasBadge({ bias }: { bias: CryptoFlowBias }) {
  const tone = bias.side === "buyers" ? "border-success/40 bg-success/10 text-success" : bias.side === "sellers" ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-surface-2 text-text-2";
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">Flow bias</div>
      <div className="mt-1 text-xl font-semibold">
        {SIDE_TEXT[bias.side]}
        {bias.strength ? <span className="ml-2 text-sm font-medium opacity-80">({bias.strength})</span> : null}
      </div>
      <div className="mt-1 text-xs opacity-80">
        {bias.side === "balanced"
          ? "Buyers and sellers have been about equal."
          : bias.consistent
            ? "The last 15 minutes, hour and 4 hours all lean the same way."
            : "The windows do not all lean the same way."}{" "}
        What has already traded, not a forecast.
      </div>
    </div>
  );
}

function WindowCell({ label, w, unit }: { label: string; w: CryptoFlowWindow; unit: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="text-xs uppercase tracking-wide text-text-3">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone(w.delta)}`}>
        {fmtDelta(w.delta)} {unit}
      </div>
      <div className="mt-1 text-xs text-text-2">
        {w.deltaPct >= 0 ? "+" : ""}
        {w.deltaPct.toFixed(1)}% of volume &middot; buyers {w.buyPct.toFixed(0)}%
      </div>
      <div className="text-xs text-text-3">
        price {w.priceChangePct >= 0 ? "+" : ""}
        {w.priceChangePct.toFixed(2)}%
      </div>
    </div>
  );
}

/** Cumulative delta (gold) and price (grey), each scaled to its own range so the two shapes can be compared. */
function FlowChart({ data }: { data: CryptoFlowResponse }) {
  const W = 640;
  const H = 150;
  const pts = data.series;
  const n = pts.length;
  const scale = (vals: number[]) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const span = hi - lo || 1;
    return vals.map((v) => H - 8 - ((v - lo) / span) * (H - 16));
  };
  const price = scale(pts.map((p) => p.close));
  const cum = scale(pts.map((p) => p.cum));
  const line = (ys: number[]) => ys.map((y, i) => `${((i / (n - 1)) * W).toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label={`${data.symbol} price and cumulative delta, last 4 hours`}>
        <polyline points={line(price)} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-3" />
        <polyline points={line(cum)} fill="none" stroke="currentColor" strokeWidth="2" className="text-gold" />
      </svg>
      <div className="mt-1 flex gap-4 text-xs text-text-3">
        <span>
          <span className="text-gold">&mdash;</span> cumulative delta (4 h)
        </span>
        <span>
          <span className="text-text-3">&mdash;</span> price (4 h)
        </span>
      </div>
    </div>
  );
}

function SymbolCard({ symbol, state, onRetry }: { symbol: CryptoFlowSymbol; state: SymbolState; onRetry: () => void }) {
  if (state.status === "loading") return <Skeleton className="h-72 w-full" />;
  if (state.status === "error") {
    return (
      <ErrorState
        title={`${LABEL[symbol]} - could not load`}
        description={state.message}
        action={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }
  const d = state.data;
  const unit = UNIT[symbol];
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-text-1">{LABEL[symbol]}</h2>
        <div className="text-sm text-text-2">
          {fmtPrice(d.lastPrice)} USDT &middot; <span className="text-text-3">bar {timeAgo(d.asOf)}</span>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <BiasBadge bias={d.bias} />
        <div className="grid grid-cols-3 gap-2">
          <BuySellGauge label="15 min" buyPct={d.windows.m15.buyPct} />
          <BuySellGauge label="1 hour" buyPct={d.windows.h1.buyPct} />
          <BuySellGauge label="4 hours" buyPct={d.windows.h4.buyPct} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <WindowCell label="Last 15 min" w={d.windows.m15} unit={unit} />
        <WindowCell label="Last hour" w={d.windows.h1} unit={unit} />
        <WindowCell label="Last 4 hours" w={d.windows.h4} unit={unit} />
      </div>
      <div className="mt-5">
        <FlowChart data={d} />
      </div>
    </Card>
  );
}

export default function CryptoFlowPage() {
  const [states, setStates] = useState<Record<CryptoFlowSymbol, SymbolState>>({
    BTCUSDT: { status: "loading" },
    ETHUSDT: { status: "loading" },
  });

  const loadOne = useCallback(async (symbol: CryptoFlowSymbol) => {
    try {
      const res = await fetch(`/api/private/crypto-flow?symbol=${symbol}`);
      const json = (await res.json().catch(() => null)) as { status?: string; data?: CryptoFlowResponse; error?: { message?: string } } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setStates((s) => ({ ...s, [symbol]: { status: "error", message: json?.error?.message || "Could not load the market data." } }));
        return;
      }
      const data = json.data;
      setStates((s) => ({ ...s, [symbol]: { status: "ready", data } }));
    } catch {
      setStates((s) => ({ ...s, [symbol]: { status: "error", message: "Network error - could not reach the service." } }));
    }
  }, []);

  useEffect(() => {
    const run = () => {
      for (const symbol of CRYPTO_FLOW_SYMBOLS) void loadOne(symbol);
    };
    run();
    const id = window.setInterval(run, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadOne]);

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Crypto Flow"
        description="Who is hitting the market right now? Real buyer and seller aggressor volume for Bitcoin and Ethereum on Binance spot, summed over the last 15 minutes, hour and 4 hours."
      />
      <Alert tone="info" title="How to read it" className="mb-6">
        The meter shows what share of the traded volume was bought by aggressive buyers (needle right) or sold by aggressive sellers (needle left); the bias line summarises the 15 minute, 1 hour and 4 hour windows. Delta = volume bought by aggressive buyers minus volume sold by aggressive sellers (from the exchange&apos;s own taker-buy volume, not an estimate). It
        describes what has already traded on one venue (Binance spot); other exchanges and derivatives can differ. It is context, not a signal or a forecast,
        and past flow does not predict future prices.
      </Alert>
      <div className="grid gap-6">
        {CRYPTO_FLOW_SYMBOLS.map((symbol) => (
          <SymbolCard key={symbol} symbol={symbol} state={states[symbol]} onRetry={() => void loadOne(symbol)} />
        ))}
      </div>
      <p className="mt-6 text-xs text-text-3">Source: Binance public market data (1-minute bars), refreshed every minute. Not financial advice.</p>
    </div>
  );
}
