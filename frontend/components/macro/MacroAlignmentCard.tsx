"use client";

// components/macro/MacroAlignmentCard.tsx
// Gauge card for the Macro Alignment score, one asset at a time (Gold, EUR/USD,
// USD/JPY, Bitcoin, Crude oil). A pure view over /api/private/macro-alignment:
// every number, label and driver line comes from the server
// (services/macro/macro-alignment.ts). Nothing is computed here, and the formula,
// caveat and what the score does NOT cover are always visible, so the score is
// never a black box.
import { useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import type { MacroAlignmentSnapshot } from "@/services/macro/macro-service";

type Lean = MacroAlignmentSnapshot["alignment"]["lean"];

const ASSET_TABS: { id: string; label: string }[] = [
  { id: "gold", label: "Gold" },
  { id: "silver", label: "Silver" },
  { id: "copper", label: "Copper" },
  { id: "eurusd", label: "EUR/USD" },
  { id: "gbpusd", label: "GBP/USD" },
  { id: "usdjpy", label: "USD/JPY" },
  { id: "btcusd", label: "Bitcoin" },
  { id: "ethusd", label: "Ethereum" },
  { id: "oil", label: "Crude oil" },
];

const LEAN_TEXT: Record<Lean, string> = {
  supportive: "text-success",
  headwind: "text-danger",
  mixed: "text-warning",
  insufficient: "text-text-2",
};

async function load(asset: string): Promise<MacroAlignmentSnapshot> {
  const res = await fetch(`/api/private/macro-alignment?asset=${encodeURIComponent(asset)}`);
  const json = (await res.json().catch(() => null)) as { status: "ok"; data: MacroAlignmentSnapshot } | { status: "error"; error: { message: string } } | null;
  if (!json || json.status !== "ok") throw new Error(json && json.status === "error" ? json.error.message : `Request failed (${res.status})`);
  return json.data;
}

function Gauge({ score, lean }: { score: number | null; lean: Lean }) {
  const pct = score ?? 0;
  return (
    <div className={`relative mx-auto w-52 ${LEAN_TEXT[lean]}`} role="img" aria-label={score === null ? "Macro alignment: not enough data" : `Macro alignment ${score} percent`}>
      <svg viewBox="0 0 120 70" className="w-full">
        <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="10" strokeLinecap="round" pathLength={100} />
        {score !== null && (
          <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="currentColor" strokeWidth="10" strokeLinecap="round" pathLength={100} strokeDasharray={`${pct} 100`} />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-3xl font-semibold leading-none">{score === null ? "—" : `${score}%`}</div>
      </div>
    </div>
  );
}

function signMark(sign: number): { glyph: string; cls: string } {
  if (sign > 0) return { glyph: "▲", cls: "text-success" };
  if (sign < 0) return { glyph: "▼", cls: "text-danger" };
  return { glyph: "●", cls: "text-text-2" };
}

function asOfText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function MacroAlignmentCard() {
  const [asset, setAsset] = useState("gold");
  const [snap, setSnap] = useState<MacroAlignmentSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSnap(null);
    setError(null);
    load(asset)
      .then((d) => live && setSnap(d))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load macro alignment"));
    return () => {
      live = false;
    };
  }, [asset]);

  const tabs = (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Asset">
      {ASSET_TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={asset === t.id}
          onClick={() => setAsset(t.id)}
          className={`rounded-control border px-3 py-1 text-sm ${asset === t.id ? "border-gold text-gold" : "border-border text-text-2 hover:text-text"}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (error) {
    return (
      <Card padding="md" className="space-y-3">
        {tabs}
        <p className="text-sm text-text-2">Macro alignment is unavailable right now ({error}).</p>
      </Card>
    );
  }
  if (!snap) {
    return (
      <Card padding="md" className="space-y-3">
        {tabs}
        <Skeleton className="h-64 w-full" />
      </Card>
    );
  }

  const { alignment: a } = snap;
  return (
    <Card padding="md" className="space-y-4">
      {tabs}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-2">Macro Alignment · {snap.title}</h2>
          <p className={`text-lg font-semibold ${LEAN_TEXT[a.lean]}`}>{a.label}</p>
        </div>
        {snap.price && (
          <div className="text-right text-sm text-text-2">
            <div className="text-xs">{snap.price.label}</div>
            <div className="text-base font-semibold text-text">{snap.price.text}</div>
            <div className={snap.price.changePct >= 0 ? "text-success" : "text-danger"}>
              {snap.price.changePct >= 0 ? "+" : ""}
              {snap.price.changePct.toFixed(2)}% today
            </div>
          </div>
        )}
      </div>

      <Gauge score={a.score} lean={a.lean} />
      <p className="text-center text-xs text-text-2">
        {a.lean === "mixed" ? "No clear lean - the drivers point different ways. " : ""}
        {a.availableDrivers} of {a.totalDrivers} drivers have data · share of driver weight pointing the same way
      </p>

      <ul className="divide-y divide-border">
        {a.drivers.map((d) => {
          const m = signMark(d.sign);
          const when = asOfText(d.asOf);
          return (
            <li key={d.id} className="flex items-start gap-3 py-2 text-sm">
              <span className={`mt-0.5 w-4 shrink-0 text-center ${d.available ? m.cls : "text-text-2"}`} aria-hidden>
                {d.available ? m.glyph : "–"}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-text">{d.label}</span>
                  <span className="shrink-0 text-xs text-text-2">weight {d.weight}</span>
                </div>
                <p className="text-text-2">{d.detail}</p>
                <p className="text-xs text-text-2/70">
                  {d.source}
                  {d.available && when ? ` · as of ${when}` : ""}
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="space-y-1 border-t border-border pt-3 text-xs text-text-2">
        <p>{a.formula}</p>
        <p>{a.caveat}</p>
        {a.notCovered.length > 0 && <p>Not covered by this score: {a.notCovered.join("; ")}.</p>}
        {snap.attribution && <p>{snap.attribution}</p>}
      </div>
    </Card>
  );
}
