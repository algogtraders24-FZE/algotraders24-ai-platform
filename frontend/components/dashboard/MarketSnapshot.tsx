"use client";

// components/dashboard/MarketSnapshot.tsx
// The dashboard's "Market snapshot": five mini Macro Alignment gauges, the next
// high-impact USD event with a live countdown (IST), and the latest automation
// result. A pure view over three read-only endpoints; every number and sentence
// comes from the server. Each block loads on its own and fails on its own - a
// slow quote feed never blanks the countdown or the latest result.
import { useEffect, useState } from "react";
import Link from "next/link";
import Card from "@/components/ui/Card";
import Skeleton from "@/components/ui/Skeleton";
import { AutomationApi, type ResultItem } from "@/services/api/AutomationApi";
import { countdown } from "@/services/automation/brief-extras";
import type { MacroOverviewItem } from "@/services/macro/macro-overview";
import type { NextEvent } from "@/services/calendar/next-event";

const LEAN_TEXT: Record<MacroOverviewItem["lean"], string> = {
  supportive: "text-success",
  headwind: "text-danger",
  mixed: "text-warning",
  insufficient: "text-text-2",
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = (await res.json().catch(() => null)) as { status: "ok"; data: T } | { status: "error"; error: { message: string } } | null;
  if (!json || json.status !== "ok") throw new Error(json && json.status === "error" ? json.error.message : `Request failed (${res.status})`);
  return json.data;
}

function MiniGauge({ score, lean }: { score: number | null; lean: MacroOverviewItem["lean"] }) {
  return (
    <div className={`relative mx-auto w-24 ${LEAN_TEXT[lean]}`} role="img" aria-label={score === null ? "not enough data" : `${score} percent`}>
      <svg viewBox="0 0 120 70" className="w-full">
        <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="12" strokeLinecap="round" pathLength={100} />
        {score !== null && <path d="M10 62 A50 50 0 0 1 110 62" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" pathLength={100} strokeDasharray={`${score} 100`} />}
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center text-lg font-semibold leading-none">{score === null ? "—" : `${score}%`}</div>
    </div>
  );
}

function MacroMiniCards() {
  const [items, setItems] = useState<MacroOverviewItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    getJson<{ items: MacroOverviewItem[] }>("/api/private/macro-alignment/overview")
      .then((d) => live && setItems(d.items))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p className="text-sm text-text-3">Macro snapshot is unavailable right now.</p>;
  if (!items) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
      {items.map((it) => (
        <Link key={it.asset} href="/dashboard/automation" className="block rounded-card focus:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <Card padding="sm" className="h-full space-y-2 transition-colors hover:border-gold/40">
            <p className="text-xs font-semibold text-text-2">{it.title}</p>
            <MiniGauge score={it.score} lean={it.lean} />
            <p className={`text-center text-sm font-semibold ${LEAN_TEXT[it.lean]}`}>{it.label}</p>
            {it.price ? (
              <p className="text-center text-xs text-text-2">
                {it.price.text} ·{" "}
                <span className={it.price.changePct >= 0 ? "text-success" : "text-danger"}>
                  {it.price.changePct >= 0 ? "+" : ""}
                  {it.price.changePct.toFixed(2)}%
                </span>
              </p>
            ) : (
              <p className="text-center text-xs text-text-3">price unavailable</p>
            )}
          </Card>
        </Link>
      ))}
    </div>
  );
}

function istText(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

function NextRiskEvent() {
  const [state, setState] = useState<{ available: boolean; event: NextEvent | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    getJson<{ available: boolean; event: NextEvent | null }>("/api/private/dashboard/next-event")
      .then((d) => live && setState(d))
      .catch(() => live && setFailed(true));
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  return (
    <Card padding="md" className="space-y-2">
      <h3 className="text-sm font-semibold text-text-2">Next risk event</h3>
      {failed || (state && !state.available) ? (
        <p className="text-sm text-text-3">The economic calendar is unavailable right now.</p>
      ) : !state ? (
        <Skeleton className="h-16 w-full" />
      ) : !state.event ? (
        <p className="text-sm text-text-3">No more high-impact USD events this week.</p>
      ) : (
        <>
          <p className="text-lg font-semibold text-text">{state.event.title}</p>
          <p className="text-sm text-text-2">
            {state.event.currency} · {istText(state.event.eventTime)} IST ·{" "}
            <span className="font-semibold text-gold">{countdown(new Date(state.event.eventTime).getTime() - now)}</span>
          </p>
          {(state.event.forecast || state.event.previous) && (
            <p className="text-xs text-text-3">
              {[state.event.forecast ? `forecast ${state.event.forecast}` : null, state.event.previous ? `previous ${state.event.previous}` : null].filter(Boolean).join(" · ")}
            </p>
          )}
        </>
      )}
      <Link href="/dashboard/calendar" className="inline-block text-xs text-gold hover:underline">
        Open the economic calendar →
      </Link>
    </Card>
  );
}

function LatestResult() {
  const [item, setItem] = useState<ResultItem | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    AutomationApi.results(1)
      .then((d) => live && setItem(d.items[0] ?? null))
      .catch(() => live && setItem(null));
    return () => {
      live = false;
    };
  }, []);

  return (
    <Card padding="md" className="space-y-2">
      <h3 className="text-sm font-semibold text-text-2">Latest automation result</h3>
      {item === undefined ? (
        <Skeleton className="h-16 w-full" />
      ) : item === null ? (
        <>
          <p className="text-sm text-text-3">No result yet. Set up an automation and its result shows up here.</p>
          <Link href="/dashboard/automation" className="inline-block text-xs text-gold hover:underline">
            Open Automation →
          </Link>
        </>
      ) : (
        <>
          <p className="text-xs text-text-3">
            {item.automationName ?? "Automation"} · {new Date(item.createdAt).toLocaleString()}
          </p>
          <p className="text-lg font-semibold text-text">{item.brief.headline}</p>
          {item.brief.changeNote && <p className="text-sm text-text-2">{item.brief.changeNote}</p>}
          <Link href={`/dashboard/automation/runs/${item.runId}`} className="inline-block text-xs text-gold hover:underline">
            Open run →
          </Link>
        </>
      )}
    </Card>
  );
}

export function MarketSnapshot() {
  return (
    <section className="space-y-3" aria-label="Market snapshot">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-2">Market snapshot</h2>
        <p className="text-xs text-text-3">Macro alignment: rule-based agreement of drivers, not a forecast.</p>
      </div>
      <MacroMiniCards />
      <div className="grid gap-4 lg:grid-cols-2">
        <NextRiskEvent />
        <LatestResult />
      </div>
    </section>
  );
}
