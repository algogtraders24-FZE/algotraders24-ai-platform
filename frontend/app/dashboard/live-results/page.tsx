"use client";
// app/dashboard/live-results/page.tsx
// AT24 Live Results for every signed-in member:
//   - Watching: pages the member watches, refreshed automatically, with "since you started watching" numbers
//   - Your pages: the member's own pages (any visibility)
//   - Public pages: a "find a page" list. Deliberately NO ranking by performance (ranking by gain rewards risk-taking).
// Every page states that its data is terminal-reported and not independently verified.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import DirectoryExplorer from "@/components/live-results/DirectoryExplorer";
import type { ResultsSummary } from "@/services/live-results/summary";

interface Item {
  slug: string;
  title: string;
  description: string;
  mode: string;
  daysSinceFirstSync: number;
  lastSyncAt: number;
  stale: boolean;
  oneEa: boolean;
}

interface Mine {
  slug: string;
  title: string;
  visibility: string;
  magicFilter: string | null;
  showAmounts: boolean;
}

interface Watched {
  slug: string;
  available: boolean;
  title: string;
  mode: string | null;
  followedAt: number;
  daysSinceFirstSync: number | null;
  lastSyncAt: number | null;
  stale: boolean;
  sinceWatch: { trades: number; gainPct: number | null; winRatePct: number | null } | null;
  absoluteGainPct: number | null;
  maxDrawdownPct: number | null;
  todayGainPct: number | null;
  trades: number | null;
  liveTracked: { trades: number; gainPct: number | null } | null;
}

const POLL_MS = 60_000;
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const tone = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? "text-text" : n > 0 ? "text-emerald-400" : "text-red-400");
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const utc = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

function Stat({ label, value, cls = "" }: { label: string; value: string; cls?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-text-3">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

export default function LiveResultsDirectoryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [summaries, setSummaries] = useState<ResultsSummary[] | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [following, setFollowing] = useState<string[]>([]);
  const [watched, setWatched] = useState<Watched[] | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const loadWatching = useCallback(async () => {
    try {
      const r = await fetch("/api/private/live-results/follow", { cache: "no-store" });
      if (!r.ok) return;
      const j = await r.json();
      setWatched((j.data.items as Watched[]) ?? []);
    } catch {
      // keep the last list
    }
  }, []);

  useEffect(() => {
    fetch("/api/private/live-results/directory", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 503) return setOff(true);
        const j = await r.json();
        if (r.ok) {
          setItems(j.data.pages as Item[]);
          setSummaries((j.data.summaries as ResultsSummary[]) ?? []);
          setMine((j.data.mine as Mine[]) ?? []);
          setFollowing((j.data.following as string[]) ?? []);
        } else setOff(true);
      })
      .catch(() => setOff(true));
    void loadWatching();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadWatching();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [loadWatching]);

  async function stop(slug: string) {
    setBusy(slug);
    try {
      await fetch(`/api/private/live-results/follow?slug=${encodeURIComponent(slug)}`, { method: "DELETE" });
      setFollowing((f) => f.filter((s) => s !== slug));
    } finally {
      setBusy(null);
      await loadWatching();
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="INTELLIGENCE"
        title="Live Results"
        description="Real-time results of trading accounts, reported by the account owners' own MetaTrader terminals. Watch a page and it updates in your dashboard by itself, so you can see how an Expert Advisor behaves on a live feed before you choose one."
        action={<ButtonLink href="/dashboard/live-sync/portfolio" size="sm" variant="secondary">My portfolio</ButtonLink>}
      />
      <Alert tone="info">
        Every page is terminal-reported by its owner and is <b>not independently verified</b> by a broker or by AT24. Past results do not predict future results. This is not investment advice.{" "}
        <Link href="/dashboard/live-sync" className="font-semibold text-gold hover:underline">Publish your own results →</Link>
      </Alert>

      {off && <Alert tone="warning">Live Results is not available yet.</Alert>}
      {!off && items === null && <p className="text-sm text-text-3">Loading…</p>}

      {!off && watched !== null && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text">Watching {watched.length > 0 && <span className="ml-1 text-xs font-normal text-text-3">updates every minute</span>}</h2>
          {watched.length === 0 ? (
            <Card className="space-y-1">
              <p className="text-sm font-semibold text-text">You are not watching anything yet</p>
              <p className="text-sm text-text-2">Press <b>Watch this page</b> on any public page below. It then appears here and keeps updating, with the numbers since the day you started watching.</p>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {watched.map((w) => (
                <Card key={w.slug || w.title} className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-lg font-bold text-text">{w.title}</p>
                    {w.mode && <Badge tone={w.mode === "real" ? "warning" : "neutral"} className="normal-case">{w.mode === "real" ? "REAL" : w.mode === "contest" ? "CONTEST" : "DEMO"}</Badge>}
                    {w.available ? <Badge tone={w.stale ? "warning" : "success"} className="normal-case">{w.stale ? "not reporting" : "live"}</Badge> : <Badge tone="warning" className="normal-case">no longer public</Badge>}
                  </div>
                  {w.available ? (
                    <>
                      <div className="rounded-md bg-white/[0.04] p-2.5">
                        <p className="text-[11px] uppercase tracking-wide text-text-3">Since you started watching ({day(w.followedAt)})</p>
                        {w.sinceWatch && w.sinceWatch.trades > 0 ? (
                          <p className="text-sm text-text"><b className={tone(w.sinceWatch.gainPct)}>{pct(w.sinceWatch.gainPct)}</b> over {w.sinceWatch.trades} closed trade{w.sinceWatch.trades === 1 ? "" : "s"}{w.sinceWatch.winRatePct !== null ? ` · win rate ${w.sinceWatch.winRatePct.toFixed(1)}%` : ""}</p>
                        ) : (
                          <p className="text-sm text-text-2">No trade has closed since you started watching.</p>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <Stat label="Today" value={pct(w.todayGainPct)} cls={tone(w.todayGainPct)} />
                        <Stat label="Max drawdown" value={w.maxDrawdownPct === null ? "-" : `${w.maxDrawdownPct.toFixed(1)}%`} cls="text-red-400" />
                        <Stat label="Live forward" value={w.liveTracked && w.liveTracked.trades > 0 ? pct(w.liveTracked.gainPct) : "no trades yet"} cls={tone(w.liveTracked?.gainPct)} />
                      </div>
                      <p className="text-xs text-text-3">
                        Tracked {w.daysSinceFirstSync ?? 0} day{w.daysSinceFirstSync === 1 ? "" : "s"} · {w.trades ?? 0} trades in the reported history{w.lastSyncAt ? ` · last update ${utc(w.lastSyncAt)}` : ""}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm text-text-2">The owner made this page private or removed it. You can stop watching it.</p>
                  )}
                  <div className="flex gap-2">
                    {w.available && <ButtonLink size="sm" href={`/results/${w.slug}`}>Open results</ButtonLink>}
                    <Button size="sm" variant="secondary" loading={busy === w.slug} onClick={() => void stop(w.slug)} disabled={!w.slug}>Stop watching</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {mine.length > 0 && (
        <Card className="space-y-3">
          <p className="text-sm font-semibold text-text">Your pages</p>
          <ul className="divide-y divide-border">
            {mine.map((p) => (
              <li key={p.slug} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="text-text">
                  {p.title}{" "}
                  <Badge tone={p.visibility === "public" ? "warning" : "neutral"} className="normal-case">{p.visibility}</Badge>{" "}
                  <span className="text-xs text-text-3">{p.magicFilter ? `EA magic ${p.magicFilter}` : "whole account"} · {p.showAmounts ? "amounts shown" : "percent only"}</span>
                </span>
                <span className="flex gap-3">
                  <ButtonLink size="sm" href={`/results/${p.slug}`}>Open</ButtonLink>
                  <Link href="/dashboard/live-sync" className="self-center text-xs font-semibold text-gold hover:underline">Edit on Live Sync</Link>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-text-3">Only pages set to <b>Public</b> appear in the list below for other members. Private pages and secret-link pages are visible to you only (and to anyone you share the secret link with).</p>
        </Card>
      )}

      <h2 className="text-sm font-semibold text-text">Public pages</h2>
      {summaries !== null && summaries.length === 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold text-text">No public pages yet</p>
          <p className="text-sm text-text-2">When an account owner makes a results page public it appears here. You can create yours from the Live Sync page.</p>
        </Card>
      )}
      {summaries !== null && summaries.length > 0 && <DirectoryExplorer items={summaries} following={following} onFollowChange={() => void loadWatching()} />}
    </div>
  );
}
