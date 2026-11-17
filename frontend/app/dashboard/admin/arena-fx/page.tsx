// app/dashboard/admin/arena-fx/page.tsx
// AI Arena (forex, gold, energy, indices) - admin view. Paper only: AI contestants, a rule and 200 random decoys are scored from the same
// decision-time snapshots. The decoys are the honest yardstick: they show what luck alone does. No claim is made before enough days exist.
"use client";

import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import ErrorState from "@/components/ui/ErrorState";
import Skeleton from "@/components/ui/Skeleton";
import type { ArenaFxResponse } from "@/services/arena-fx/board.service";

type LoadState<T> = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: T };

const COLORS = ["#d4a017", "#4ea1ff", "#c084fc", "#34d399"];
const VERDICT_TONE: Record<string, string> = {
  "AHEAD OF LUCK ON THIS HISTORY": "text-success",
  "BEHIND LUCK ON THIS HISTORY": "text-danger",
  "INSIDE THE LUCK BAND": "text-text-2",
  COLLECTING: "text-text-3",
};

function f2(v: number | null, digits = 2): string {
  return v === null ? "-" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;
}

function EquityChart({ board }: { board: ArenaFxResponse }) {
  const W = 900;
  const H = 280;
  const n = board.dayKeys.length;
  if (n < 2) return <div className="mt-3 text-sm text-text-3">The chart appears after the second scored day.</div>;
  const all: number[] = [...board.band.p5, ...board.band.p95];
  for (const c of board.contestants) for (const v of c.cum) if (v !== null) all.push(v);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (n - 1)) * (W - 20) + 10;
  const y = (v: number) => H - 14 - ((v - lo) / span) * (H - 28);
  const line = (vals: Array<number | null>) => vals.map((v, i) => (v === null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  const area = `${board.band.p95.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} ${[...board.band.p5].reverse().map((v, i) => `${x(n - 1 - i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Running result of every contestant against the band of 200 random traders">
        <line x1={10} x2={W - 10} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-border" />
        <polygon points={area} fill="currentColor" className="text-text-3" opacity="0.18" />
        <polyline points={line(board.band.p50)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" className="text-text-3" />
        {board.contestants.map((c, i) => (
          <polyline key={c.id} points={line(c.cum)} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="2" />
        ))}
        <text x={12} y={12} fontSize="10" fill="currentColor" className="text-text-3">
          {f2(hi, 1)}
        </text>
        <text x={12} y={H - 3} fontSize="10" fill="currentColor" className="text-text-3">
          {f2(lo, 1)} (daily ATR units)
        </text>
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-3">
        <span>grey band: 90% of the {board.decoys} random traders, dashed: their median</span>
        {board.contestants.map((c, i) => (
          <span key={c.id}>
            <span style={{ color: COLORS[i % COLORS.length] }}>&mdash;</span> {c.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ArenaFxPage() {
  const [state, setState] = useState<LoadState<ArenaFxResponse>>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/admin/arena-fx");
      const json = (await res.json().catch(() => null)) as { status?: string; data?: ArenaFxResponse; error?: { message?: string } } | null;
      if (!res.ok || !json || json.status !== "ok" || !json.data) {
        setState({ status: "error", message: json?.error?.message || "Could not load the arena." });
        return;
      }
      setState({ status: "ready", data: json.data });
    } catch {
      setState({ status: "error", message: "Network error - could not reach the service." });
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 5 * 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  return (
    <div>
      <PageHeader eyebrow="Admin" title="AI Arena - forex, gold, energy, indices" description="A paper-trading test: two Claude models, a rule and 200 random traders decide on the same daily snapshot of 22 markets. Nothing here is a real order." />
      <Alert tone="info" title="How it is scored" className="mb-6">
        Once on each weekday (from 14:00 UTC) the map of every open market is frozen. Each contestant sets long, short or flat for the next day, using only that snapshot. The position is held to the next
        snapshot and scored in units of the market&apos;s daily range (ATR), minus 0.03 ATR every time it changes (an assumption, not a measurement). The 200 random traders decide by coin flip; a contestant is only
        judged against them: its rank is the share of random traders it beat over the same days. Under 30 days nothing is claimed. Paper only: no real fills, no swap, one decision a day.
      </Alert>
      {state.status === "loading" ? <Skeleton className="h-96 w-full" /> : null}
      {state.status === "error" ? (
        <ErrorState
          title="Could not load the arena"
          description={state.message}
          action={
            <Button variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : null}
      {state.status === "ready" ? (
        <>
          <Card className="mb-6">
            <div className="text-xs text-text-3">
              {state.data.snapshotDays} snapshot days, {state.data.markets} markets, {state.data.dayKeys.length} scored days. AI contestants are {state.data.aiEnabled ? "on" : `OFF (${state.data.aiEnv.switchedOff ? "switched off by ARENA_FX_AI_DISABLED" : "no ANTHROPIC_API_KEY in this deployment"}; environment: ${state.data.aiEnv.vercelEnv ?? "unknown"})`}. The first scores appear the day after the
              first snapshot.
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="text-xs text-text-3">
                    <th className="pb-2 pr-3 font-medium">Contestant</th>
                    <th className="pb-2 pr-3 font-medium">Days</th>
                    <th className="pb-2 pr-3 font-medium">Total (ATR)</th>
                    <th className="pb-2 pr-3 font-medium">Per day</th>
                    <th className="pb-2 pr-3 font-medium">Winning days</th>
                    <th className="pb-2 pr-3 font-medium">Beat of {state.data.decoys} random</th>
                    <th className="pb-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.contestants.map((c) => (
                    <tr key={c.id} className="border-t border-border">
                      <td className="py-2 pr-3 text-text-1">{c.label}</td>
                      <td className="py-2 pr-3 text-text-2">{c.days}</td>
                      <td className="py-2 pr-3 text-text-2">{f2(c.days ? c.total : null)}</td>
                      <td className="py-2 pr-3 text-text-2">{f2(c.meanPerDay, 3)}</td>
                      <td className="py-2 pr-3 text-text-2">{c.hitDaysPct === null ? "-" : `${c.hitDaysPct.toFixed(0)}%`}</td>
                      <td className="py-2 pr-3 text-text-2">{c.rankPct === null ? "-" : `${c.rankPct.toFixed(1)}%`}</td>
                      <td className={`py-2 font-medium ${VERDICT_TONE[c.verdict] ?? "text-text-2"}`}>{c.days < 30 ? `Collecting (${c.days}/30)` : c.verdict}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4">
              <EquityChart board={state.data} />
            </div>
          </Card>
          {state.data.latest.map((l) => (
            <Card key={l.contestant} className="mb-6">
              <h2 className="text-base font-semibold text-text-1">
                {state.data.contestants.find((c) => c.id === l.contestant)?.label} - latest decisions {l.dayKey ? `(${l.dayKey})` : ""}
              </h2>
              {l.decisions.length === 0 ? (
                <div className="mt-2 text-sm text-text-3">No decisions yet.</div>
              ) : (
                <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  {l.decisions.map((d) => (
                    <div key={d.symbol} className="flex gap-2">
                      <span className={`w-14 shrink-0 font-medium ${d.position === 1 ? "text-success" : d.position === -1 ? "text-danger" : "text-text-3"}`}>
                        {d.symbol} {d.position === 1 ? "long" : d.position === -1 ? "short" : "flat"}
                      </span>
                      <span className="text-text-3">{d.reason ?? ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
          {state.data.problems.length > 0 ? (
            <Alert tone="warning" title="Problems in the daily job" className="mb-4">
              {state.data.problems.map((p) => `${p.dayKey} ${p.contestant}: ${p.status}${p.error ? ` - ${p.error}` : ""}`).join(" | ")}
            </Alert>
          ) : null}
          <p className="text-xs text-text-3">
            Token use:{" "}
            {state.data.usage.map((u) => `${state.data.contestants.find((c) => c.id === u.contestant)?.label}: ${u.runs} runs (${u.failed} failed), ${u.inputTokens.toLocaleString()} in / ${u.outputTokens.toLocaleString()} out`).join("; ")}. A short
            history proves little: 200 random traders give a rank in steps of 0.5 points, and a contestant that looks ahead after a few weeks can still be luck.
          </p>
        </>
      ) : null}
    </div>
  );
}
