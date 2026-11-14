// app/dashboard/crypto-flow/page.tsx
// Crypto Flow - real buyer / seller aggressor delta from the public Binance 1-minute klines, for the ten largest
// coins and for gold / silver (perpetual futures) and the PAXG gold token. A buy/sell meter and a flow-bias badge
// per instrument, a data-quality badge (how many trades back the number), and a detail view with the 4-hour chart.
// Descriptive market context, not a signal. One venue (Binance) only.
"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import {
  CRYPTO_FLOW_INSTRUMENTS,
  CRYPTO_FLOW_LOOKBACKS,
  getCryptoFlowInstrument,
  getCryptoFlowLookback,
  type CryptoFlowLookback,
  type CryptoFlowZone,
  type CryptoFlowZones,
  type CryptoFlowBias,
  type CryptoFlowGroup,
  type CryptoFlowInstrument,
  type CryptoFlowOverview,
  type CryptoFlowQuality,
  type CryptoFlowResponse,
  type CryptoFlowWindow,
} from "@/types/crypto-flow";

type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const REFRESH_MS = 60_000;
const GROUP_TITLE: Record<CryptoFlowGroup, string> = { crypto: "Top 10 coins", gold: "Gold and metals" };
const GROUP_NOTE: Record<CryptoFlowGroup, string> = {
  crypto: "Binance spot, USDT pairs, ordered by market cap.",
  gold: "Gold and silver are Binance USDⓈ-M perpetual futures (leveraged, they also trade on weekends); PAXG is a gold-backed token on spot and trades thinly.",
};

function fmtPrice(v: number): string {
  const digits = v >= 100 ? 2 : v >= 1 ? 3 : 5;
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtDelta(v: number): string {
  const abs = Math.abs(v);
  const text = abs >= 1000 ? abs.toFixed(0) : abs >= 100 ? abs.toFixed(0) : abs >= 10 ? abs.toFixed(1) : abs.toFixed(2);
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
function BuySellGauge({ label, buyPct, size = "md" }: { label: string; buyPct: number; size?: "sm" | "md" | "lg" }) {
  const cx = 100;
  const cy = 100;
  const r = 78;
  const pct = Math.min(100, Math.max(0, buyPct));
  const [nx, ny] = dialPoint(cx, cy, r - 10, (180 * pct) / 100);
  const lean = pct >= 52 ? "text-success" : pct <= 48 ? "text-danger" : "text-text-2";
  const width = size === "lg" ? "max-w-xs" : size === "md" ? "max-w-[11rem]" : "max-w-[9rem]";
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 118" className={`w-full ${width}`} role="img" aria-label={`${label}: buyers ${pct.toFixed(0)} percent, sellers ${(100 - pct).toFixed(0)} percent`}>
        <path d={arcPath(cx, cy, r, 0, 81)} fill="none" stroke="currentColor" strokeWidth="14" className="text-danger" opacity="0.85" />
        <path d={arcPath(cx, cy, r, 81, 99)} fill="none" stroke="currentColor" strokeWidth="14" className="text-text-3" opacity="0.6" />
        <path d={arcPath(cx, cy, r, 99, 180)} fill="none" stroke="currentColor" strokeWidth="14" className="text-success" opacity="0.85" />
        <line x1={cx} y1={cy} x2={nx.toFixed(2)} y2={ny.toFixed(2)} stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="text-text-1" />
        <circle cx={cx} cy={cy} r="6" fill="currentColor" className="text-text-1" />
        <text x="14" y="116" fontSize="9" fill="currentColor" className="text-danger">
          SELLERS
        </text>
        <text x="186" y="116" fontSize="9" textAnchor="end" fill="currentColor" className="text-success">
          BUYERS
        </text>
      </svg>
      <div className={`-mt-1 text-sm font-semibold ${lean}`}>
        Buyers {pct.toFixed(0)}% &middot; Sellers {(100 - pct).toFixed(0)}%
      </div>
      <div className="text-xs text-text-3">{label}</div>
    </div>
  );
}

const SIDE_TEXT: Record<CryptoFlowBias["side"], string> = { buyers: "Buyers in control", sellers: "Sellers in control", balanced: "Balanced flow" };

function biasTone(side: CryptoFlowBias["side"]): string {
  return side === "buyers" ? "border-success/40 bg-success/10 text-success" : side === "sellers" ? "border-danger/40 bg-danger/10 text-danger" : "border-border bg-surface-2 text-text-2";
}

/** One-line summary of who has been the aggressor lately (descriptive, not a forecast). */
function BiasBadge({ bias, compact = false }: { bias: CryptoFlowBias; compact?: boolean }) {
  return (
    <div className={`rounded-lg border ${compact ? "p-2" : "p-3"} ${biasTone(bias.side)}`}>
      {compact ? null : <div className="text-xs uppercase tracking-wide opacity-80">Flow bias</div>}
      <div className={`${compact ? "text-sm" : "mt-1 text-xl"} font-semibold`}>
        {SIDE_TEXT[bias.side]}
        {bias.strength ? <span className="ml-2 text-xs font-medium opacity-80">({bias.strength})</span> : null}
      </div>
      {compact ? null : (
        <div className="mt-1 text-xs opacity-80">
          {bias.side === "balanced"
            ? "Buyers and sellers have been about equal."
            : bias.consistent
              ? "The last 15 minutes, hour and 4 hours all lean the same way."
              : "The windows do not all lean the same way."}{" "}
          What has already traded, not a forecast.
        </div>
      )}
    </div>
  );
}

const QUALITY_TEXT: Record<CryptoFlowQuality["level"], string> = { high: "High liquidity", medium: "Medium liquidity", thin: "Thin: few trades" };
const QUALITY_TONE: Record<CryptoFlowQuality["level"], string> = {
  high: "border-success/30 bg-success/10 text-success",
  medium: "border-warning/30 bg-warning/10 text-warning",
  thin: "border-danger/30 bg-danger/10 text-danger",
};

function QualityBadge({ q }: { q: CryptoFlowQuality }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${QUALITY_TONE[q.level]}`} title={`${q.medianTradesPerMinute} trades per minute (median, last 4 h), ${q.emptyMinutes} empty minutes`}>
      {QUALITY_TEXT[q.level]} &middot; {q.medianTradesPerMinute}/min
    </span>
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
  const pts = data.series ?? [];
  const n = pts.length;
  if (n < 2) return null;
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

/** Overview card: price, liquidity, the 1-hour meter, the bias and the three buyers' shares. */
function InstrumentCard({ inst, row, selected, onSelect }: { inst: CryptoFlowInstrument; row: LoadState<CryptoFlowOverview["rows"][number]>; selected: boolean; onSelect: () => void }) {
  const ring = selected ? "ring-2 ring-gold/70" : "";
  if (row.status === "loading") return <Skeleton className="h-64 w-full" />;
  if (row.status === "error" || (row.status === "ready" && row.data.status === "unavailable")) {
    return (
      <Card className={ring}>
        <div className="text-sm font-semibold text-text-1">
          {inst.label} <span className="text-text-3">{inst.short}</span>
        </div>
        <div className="mt-3 text-sm text-text-3">Temporarily unavailable. It is retried every minute.</div>
      </Card>
    );
  }
  if (row.status !== "ready" || row.data.status !== "ok") return null;
  const d = row.data.data;
  const thin = d.quality.level === "thin";
  return (
    <button type="button" onClick={onSelect} className="block w-full text-left" aria-pressed={selected}>
      <Card className={`h-full transition-colors hover:border-gold/40 ${ring}`}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-sm font-semibold text-text-1">
            {inst.label} <span className="text-text-3">{inst.short}</span>
          </div>
          <div className="text-sm text-text-2">{fmtPrice(d.lastPrice)}</div>
        </div>
        <div className="mt-2">
          <QualityBadge q={d.quality} />
        </div>
        <div className="mt-3">
          <BuySellGauge label="last hour" buyPct={d.windows.h1.buyPct} size="sm" />
        </div>
        <div className="mt-3">
          {thin ? (
            <div className="rounded-lg border border-border bg-surface-2 p-2 text-xs text-text-3">Too few trades for a reliable bias. Treat the meter as noise.</div>
          ) : (
            <BiasBadge bias={d.bias} compact />
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1 text-center text-xs text-text-2">
          <div>
            <div className="text-text-3">15 min</div>
            {d.windows.m15.buyPct.toFixed(0)}% buy
          </div>
          <div>
            <div className="text-text-3">1 hour</div>
            {d.windows.h1.buyPct.toFixed(0)}% buy
          </div>
          <div>
            <div className="text-text-3">4 hours</div>
            {d.windows.h4.buyPct.toFixed(0)}% buy
          </div>
        </div>
        {inst.note ? <div className="mt-3 text-xs text-text-3">{inst.note}</div> : null}
      </Card>
    </button>
  );
}

/** Detail view of the selected instrument: three meters, the bias, delta per window and the 4-hour chart. */
function DetailPanel({ inst, state, onRetry }: { inst: CryptoFlowInstrument; state: LoadState<CryptoFlowResponse>; onRetry: () => void }) {
  if (state.status === "loading") return <Skeleton className="h-96 w-full" />;
  if (state.status === "error") {
    return (
      <ErrorState
        title={`${inst.label} - could not load the detail`}
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
  const thin = d.quality.level === "thin";
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-text-1">
          {inst.label} <span className="text-text-3">&middot; {d.venue}</span>
        </h2>
        <div className="text-sm text-text-2">
          {fmtPrice(d.lastPrice)} USDT &middot; <span className="text-text-3">bar {timeAgo(d.asOf)}</span>
        </div>
      </div>
      <div className="mt-2">
        <QualityBadge q={d.quality} />
      </div>
      {thin ? <Alert tone="warning" title="Thin market" className="mt-4">Only a few trades per minute back this number, so the meter and the delta are noisy. Do not read a bias into them.</Alert> : null}
      <div className="mt-4 grid grid-cols-1 items-center gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {thin ? <div /> : <BiasBadge bias={d.bias} />}
        <div className="grid grid-cols-3 gap-2">
          <BuySellGauge label="15 min" buyPct={d.windows.m15.buyPct} />
          <BuySellGauge label="1 hour" buyPct={d.windows.h1.buyPct} />
          <BuySellGauge label="4 hours" buyPct={d.windows.h4.buyPct} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <WindowCell label="Last 15 min" w={d.windows.m15} unit={inst.unit} />
        <WindowCell label="Last hour" w={d.windows.h1} unit={inst.unit} />
        <WindowCell label="Last 4 hours" w={d.windows.h4} unit={inst.unit} />
      </div>
      <div className="mt-5">
        <FlowChart data={d} />
      </div>
    </Card>
  );
}

const STATE_TEXT: Record<NonNullable<CryptoFlowZones["state"]>, string> = {
  inside: "Price is inside the value area, where most of the volume traded.",
  above: "Price is above the value area: it has moved away from where most volume traded.",
  below: "Price is below the value area: it has moved away from where most volume traded.",
};

function fmtUsd(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
}

function pct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

/** Butterfly volume profile: sellers extend left, buyers right, one row per price bucket, highest price on top. */
function ZoneChart({ z }: { z: CryptoFlowZones }) {
  const W = 640;
  const H = 360;
  const centre = 250;
  const half = 230;
  const rows = z.profile;
  const n = rows.length;
  if (n < 2) return null;
  const step = rows[1].price - rows[0].price;
  const top = rows[n - 1].price + step / 2;
  const bottom = rows[0].price - step / 2;
  // keep the price line and nearby walls on the chart even when they are outside the traded range
  const wallPrices = [...(z.book?.bids ?? []), ...(z.book?.asks ?? [])].map((w) => w.price);
  const hi = Math.max(top, z.lastPrice, ...wallPrices.filter((p) => p < top + (top - bottom) * 0.3));
  const lo = Math.min(bottom, z.lastPrice, ...wallPrices.filter((p) => p > bottom - (top - bottom) * 0.3));
  const y = (p: number) => 10 + ((hi - p) / (hi - lo || 1)) * (H - 20);
  const rowH = Math.max(1.5, (step / (hi - lo || 1)) * (H - 20) - 0.6);
  const maxSide = Math.max(...rows.map((r) => Math.max(r.buy, r.sell))) || 1;
  const band = (p: number, cls: string) => <rect x={0} y={y(p) - rowH / 2} width={W} height={Math.max(rowH, 3)} fill="currentColor" className={cls} opacity="0.18" />;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-80 w-full" role="img" aria-label={`${z.symbol} buyer and seller volume by price, last ${z.lookback}`}>
      {z.valueAreaLow !== null && z.valueAreaHigh !== null ? (
        <rect
          x={0}
          y={y(z.valueAreaHigh + step / 2)}
          width={W}
          height={Math.max(2, y(z.valueAreaLow - step / 2) - y(z.valueAreaHigh + step / 2))}
          fill="currentColor"
          className="text-text-3"
          opacity="0.1"
        />
      ) : null}
      {z.buyerZone ? band(z.buyerZone.price, "text-success") : null}
      {z.sellerZone ? band(z.sellerZone.price, "text-danger") : null}
      <line x1={centre} y1={8} x2={centre} y2={H - 8} stroke="currentColor" className="text-border" />
      {rows.map((r) => {
        const yy = y(r.price) - rowH / 2;
        const sw = (r.sell / maxSide) * half;
        const bw = (r.buy / maxSide) * half;
        return (
          <g key={r.price}>
            <rect x={centre - sw} y={yy} width={sw} height={rowH} fill="currentColor" className="text-danger" opacity="0.8" />
            <rect x={centre} y={yy} width={bw} height={rowH} fill="currentColor" className="text-success" opacity="0.8" />
          </g>
        );
      })}
      {z.poc ? (
        <g>
          <line x1={0} y1={y(z.poc.price)} x2={centre + half} y2={y(z.poc.price)} stroke="currentColor" strokeDasharray="4 3" className="text-gold" />
          <text x={4} y={y(z.poc.price) - 3} fontSize="10" fill="currentColor" className="text-gold">
            POC {fmtPrice(z.poc.price)}
          </text>
        </g>
      ) : null}
      {(z.book?.bids ?? []).map((w) => (
        <g key={`b${w.price}`}>
          <line x1={centre + half + 6} y1={y(w.price)} x2={W - 2} y2={y(w.price)} stroke="currentColor" strokeWidth="3" className="text-success" opacity="0.9" />
          <text x={W - 4} y={y(w.price) + 11} fontSize="9" textAnchor="end" fill="currentColor" className="text-success">
            bids {fmtUsd(w.notional)}
          </text>
        </g>
      ))}
      {(z.book?.asks ?? []).map((w) => (
        <g key={`a${w.price}`}>
          <line x1={centre + half + 6} y1={y(w.price)} x2={W - 2} y2={y(w.price)} stroke="currentColor" strokeWidth="3" className="text-danger" opacity="0.9" />
          <text x={W - 4} y={y(w.price) - 3} fontSize="9" textAnchor="end" fill="currentColor" className="text-danger">
            asks {fmtUsd(w.notional)}
          </text>
        </g>
      ))}
      <line x1={0} y1={y(z.lastPrice)} x2={W} y2={y(z.lastPrice)} stroke="currentColor" strokeWidth="1.5" className="text-text-1" />
      <text x={4} y={y(z.lastPrice) - 3} fontSize="10" fill="currentColor" className="text-text-1">
        price {fmtPrice(z.lastPrice)}
      </text>
      <text x={centre - 6} y={H - 1} fontSize="9" textAnchor="end" fill="currentColor" className="text-danger">
        sellers
      </text>
      <text x={centre + 6} y={H - 1} fontSize="9" fill="currentColor" className="text-success">
        buyers
      </text>
    </svg>
  );
}

function ZoneRow({ label, zone, tone: t, note }: { label: string; zone: CryptoFlowZone | null; tone: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="text-xs uppercase tracking-wide text-text-3">{label}</div>
      {zone ? (
        <>
          <div className={`mt-1 text-lg font-semibold ${t}`}>{fmtPrice(zone.price)}</div>
          <div className="text-xs text-text-2">
            {pct(zone.distancePct)} from price &middot; {zone.netSharePct.toFixed(2)}% of volume
          </div>
        </>
      ) : (
        <div className="mt-1 text-sm text-text-3">None found</div>
      )}
      <div className="mt-1 text-xs text-text-3">{note}</div>
    </div>
  );
}

/** Flow Zones: where aggressive buyers and sellers have traded, plus the resting orders in the book. Descriptive. */
function ZonesCard({
  inst,
  lookback,
  onLookback,
  state,
  onRetry,
}: {
  inst: CryptoFlowInstrument;
  lookback: CryptoFlowLookback;
  onLookback: (l: CryptoFlowLookback) => void;
  state: LoadState<CryptoFlowZones>;
  onRetry: () => void;
}) {
  const lb = getCryptoFlowLookback(lookback);
  return (
    <Card className="mt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-text-1">Flow Zones &middot; where buyers and sellers traded</h3>
        <div className="inline-flex rounded-lg border border-border p-0.5" role="group" aria-label="Lookback">
          {CRYPTO_FLOW_LOOKBACKS.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onLookback(l.id)}
              aria-pressed={l.id === lookback}
              className={`rounded-md px-3 py-1 text-xs font-medium ${l.id === lookback ? "bg-gold/20 text-gold" : "text-text-2 hover:text-text-1"}`}
            >
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-xs text-text-3">
        Volume by price, built from {lb?.interval} bars of the last {lb?.label}. Left bars: sold by aggressive sellers. Right bars: bought by aggressive buyers.
      </p>
      {state.status === "loading" ? <Skeleton className="mt-4 h-80 w-full" /> : null}
      {state.status === "error" ? (
        <div className="mt-4">
          <ErrorState
            title={`${inst.label} - could not load the zones`}
            description={state.message}
            action={
              <Button variant="secondary" onClick={onRetry}>
                Try again
              </Button>
            }
          />
        </div>
      ) : null}
      {state.status === "ready" && state.data.thin ? (
        <Alert tone="warning" title="Thin market" className="mt-4">
          Only {state.data.tradesPerMinute} trades per minute on average over this lookback, too few for a reliable volume profile. No zones are shown.
        </Alert>
      ) : null}
      {state.status === "ready" && !state.data.thin ? (
        <div className="mt-4">
          {state.data.state ? <div className="mb-3 rounded-lg border border-border bg-surface-2 p-3 text-sm text-text-1">{STATE_TEXT[state.data.state]}</div> : null}
          <ZoneChart z={state.data} />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-3">
            <span>
              <span className="text-gold">- -</span> POC (most volume)
            </span>
            <span>grey band: value area (70% of volume)</span>
            <span>
              <span className="text-success">green band</span> buyer zone
            </span>
            <span>
              <span className="text-danger">red band</span> seller zone
            </span>
            <span>thick lines at the right: order-book walls</span>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ZoneRow label="Buyer zone (below price)" zone={state.data.buyerZone} tone="text-success" note="Where buyers outweighed sellers the most." />
            <ZoneRow label="Point of control" zone={state.data.poc} tone="text-gold" note="Price with the most volume traded." />
            <ZoneRow label="Seller zone (above price)" zone={state.data.sellerZone} tone="text-danger" note="Where sellers outweighed buyers the most." />
          </div>
          {state.data.valueAreaLow !== null && state.data.valueAreaHigh !== null ? (
            <div className="mt-3 text-xs text-text-2">
              Value area {fmtPrice(state.data.valueAreaLow)} to {fmtPrice(state.data.valueAreaHigh)}.
            </div>
          ) : null}
          {state.data.book ? (
            <div className="mt-3 rounded-lg border border-border bg-surface-2 p-3 text-xs text-text-2">
              <div className="font-semibold text-text-1">Resting orders (order book, +/-{state.data.book.coveragePct.toFixed(2)}% around the price)</div>
              <div className="mt-1">
                Bids {state.data.book.imbalancePct >= 0 ? "outweigh" : "are outweighed by"} asks by {Math.abs(state.data.book.imbalancePct).toFixed(0)}% in that range.
              </div>
              <div className="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                <div>
                  {state.data.book.bids.map((w) => (
                    <div key={w.price} className="text-success">
                      Bid wall {fmtPrice(w.price)} ({pct(w.distancePct)}): {fmtUsd(w.notional)} USDT
                    </div>
                  ))}
                </div>
                <div>
                  {state.data.book.asks.map((w) => (
                    <div key={w.price} className="text-danger">
                      Ask wall {fmtPrice(w.price)} ({pct(w.distancePct)}): {fmtUsd(w.notional)} USDT
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-1 text-text-3">Walls are orders that can be pulled at any time, and a large book reaches only a small distance from the price.</div>
            </div>
          ) : (
            <div className="mt-3 text-xs text-text-3">The order book could not be loaded, so walls are not shown.</div>
          )}
        </div>
      ) : null}
      <p className="mt-3 text-xs text-text-3">
        Context, not a signal. The profile puts each bar&apos;s volume at its typical price, uses one venue (Binance) and shows what already traded. Flow does not predict the
        next move, and a zone can fail.
      </p>
    </Card>
  );
}

export default function CryptoFlowPage() {
  const [overview, setOverview] = useState<LoadState<CryptoFlowOverview>>({ status: "loading" });
  const [selected, setSelected] = useState<string>("BTCUSDT");
  const [detail, setDetail] = useState<LoadState<CryptoFlowResponse>>({ status: "loading" });
  const [lookback, setLookback] = useState<CryptoFlowLookback>("24h");
  const [zones, setZones] = useState<LoadState<CryptoFlowZones>>({ status: "loading" });

  const loadOverview = useCallback(async () => {
    try {
      const res = await fetch("/api/private/crypto-flow?symbol=ALL");
      const json = (await res.json().catch(() => null)) as { status?: string; data?: CryptoFlowOverview; error?: { message?: string } } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setOverview({ status: "error", message: json?.error?.message || "Could not load the market data." });
        return;
      }
      setOverview({ status: "ready", data: json.data });
    } catch {
      setOverview({ status: "error", message: "Network error - could not reach the service." });
    }
  }, []);

  const loadDetail = useCallback(async (symbol: string) => {
    try {
      const res = await fetch(`/api/private/crypto-flow?symbol=${encodeURIComponent(symbol)}`);
      const json = (await res.json().catch(() => null)) as { status?: string; data?: CryptoFlowResponse; error?: { message?: string } } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setDetail({ status: "error", message: json?.error?.message || "Could not load this instrument." });
        return;
      }
      setDetail({ status: "ready", data: json.data });
    } catch {
      setDetail({ status: "error", message: "Network error - could not reach the service." });
    }
  }, []);

  const loadZones = useCallback(async (symbol: string, lb: CryptoFlowLookback) => {
    try {
      const res = await fetch(`/api/private/crypto-flow/zones?symbol=${encodeURIComponent(symbol)}&lookback=${lb}`);
      const json = (await res.json().catch(() => null)) as { status?: string; data?: CryptoFlowZones; error?: { message?: string } } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setZones({ status: "error", message: json?.error?.message || "Could not load the zones." });
        return;
      }
      setZones({ status: "ready", data: json.data });
    } catch {
      setZones({ status: "error", message: "Network error - could not reach the service." });
    }
  }, []);

  useEffect(() => {
    void loadOverview();
    const id = window.setInterval(() => void loadOverview(), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadOverview]);

  useEffect(() => {
    void loadDetail(selected);
    const id = window.setInterval(() => void loadDetail(selected), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadDetail, selected]);

  useEffect(() => {
    void loadZones(selected, lookback);
    const id = window.setInterval(() => void loadZones(selected, lookback), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadZones, selected, lookback]);

  const changeLookback = (lb: CryptoFlowLookback) => {
    if (lb === lookback) return;
    setZones({ status: "loading" });
    setLookback(lb);
  };

  const select = (symbol: string) => {
    if (symbol === selected) return;
    setDetail({ status: "loading" });
    setZones({ status: "loading" });
    setSelected(symbol);
  };

  const rowFor = (symbol: string): LoadState<CryptoFlowOverview["rows"][number]> => {
    if (overview.status !== "ready") return overview.status === "error" ? { status: "error", message: overview.message } : { status: "loading" };
    const row = overview.data.rows.find((r) => r.symbol === symbol);
    return row ? { status: "ready", data: row } : { status: "error", message: "Missing" };
  };

  const selectedInst = getCryptoFlowInstrument(selected) ?? CRYPTO_FLOW_INSTRUMENTS[0];

  return (
    <div>
      <PageHeader
        eyebrow="Intelligence"
        title="Crypto Flow"
        description="Who is hitting the market right now? A buy/sell meter for the ten largest coins and for gold and silver: real buyer and seller aggressor volume on Binance, over the last 15 minutes, hour and 4 hours."
      />
      <Alert tone="info" title="How to read it" className="mb-6">
        The meter shows what share of the traded volume was bought by aggressive buyers (needle right) or sold by aggressive sellers (needle left); the bias line
        summarises the 15 minute, 1 hour and 4 hour windows. It comes from the exchange&apos;s own taker-buy volume, not an estimate. The liquidity badge shows
        how many trades back the number: a thin market is noisy. It describes what has already traded on Binance; other exchanges can differ. It is context,
        not a signal or a forecast, and past flow does not predict future prices.
      </Alert>
      {overview.status === "error" ? (
        <ErrorState
          title="Could not load the market data"
          description={overview.message}
          action={
            <Button variant="secondary" onClick={() => void loadOverview()}>
              Try again
            </Button>
          }
        />
      ) : null}
      {(["crypto", "gold"] as CryptoFlowGroup[]).map((group) => (
        <section key={group} className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2">{GROUP_TITLE[group]}</h2>
          <p className="mb-3 mt-1 text-xs text-text-3">{GROUP_NOTE[group]}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {CRYPTO_FLOW_INSTRUMENTS.filter((i) => i.group === group).map((inst) => (
              <InstrumentCard key={inst.symbol} inst={inst} row={rowFor(inst.symbol)} selected={inst.symbol === selected} onSelect={() => select(inst.symbol)} />
            ))}
          </div>
        </section>
      ))}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-text-2">Detail: {selectedInst.label}</h2>
        <DetailPanel inst={selectedInst} state={detail} onRetry={() => void loadDetail(selected)} />
        <ZonesCard inst={selectedInst} lookback={lookback} onLookback={changeLookback} state={zones} onRetry={() => void loadZones(selected, lookback)} />
      </section>
      <p className="mt-6 text-xs text-text-3">Source: Binance public market data (bars and order book), refreshed every minute. Click a card for its detail. Not financial advice.</p>
    </div>
  );
}
