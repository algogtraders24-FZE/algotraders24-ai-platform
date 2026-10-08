"use client";
// app/dashboard/live-results/page.tsx
// AT24 Live Results - the list of public results pages, for every signed-in user.
// Deliberately NO performance numbers and NO ranking here: this is a "find a page" list. Each page states
// that its data is terminal-reported and not independently verified.
import { useEffect, useState } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import ButtonLink from "@/components/ui/ButtonLink";

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

export default function LiveResultsDirectoryPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [off, setOff] = useState(false);

  useEffect(() => {
    fetch("/api/private/live-results/directory", { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 503) return setOff(true);
        const j = await r.json();
        if (r.ok) setItems(j.data.pages as Item[]);
        else setOff(true);
      })
      .catch(() => setOff(true));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="INTELLIGENCE"
        title="Live Results"
        description="Real-time results of trading accounts, reported by the account owners' own MetaTrader terminals. See how Expert Advisors behave on a live feed before you choose one."
      />
      <Alert tone="info">
        Every page is terminal-reported by its owner and is <b>not independently verified</b> by a broker or by AT24. Past results do not predict future results. This is not investment advice.{" "}
        <Link href="/dashboard/live-sync" className="font-semibold text-gold hover:underline">Publish your own results →</Link>
      </Alert>

      {off && <Alert tone="warning">Live Results is not available yet.</Alert>}
      {!off && items === null && <p className="text-sm text-text-3">Loading…</p>}
      {items && items.length === 0 && (
        <Card className="space-y-2">
          <p className="text-sm font-semibold text-text">No public pages yet</p>
          <p className="text-sm text-text-2">When an account owner makes a results page public it appears here. You can create yours from the Live Sync page.</p>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {(items ?? []).map((p) => (
          <Card key={p.slug} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-bold text-text">{p.title}</p>
              <Badge tone={p.mode === "real" ? "warning" : "neutral"} className="normal-case">{p.mode === "real" ? "REAL" : p.mode === "contest" ? "CONTEST" : "DEMO"}</Badge>
              {p.oneEa && <Badge tone="neutral" className="normal-case">one EA</Badge>}
              <Badge tone={p.stale ? "warning" : "success"} className="normal-case">{p.stale ? "not reporting" : "live"}</Badge>
            </div>
            {p.description && <p className="text-sm text-text-2">{p.description}</p>}
            <p className="text-xs text-text-3">Tracked for {p.daysSinceFirstSync} day{p.daysSinceFirstSync === 1 ? "" : "s"} · last update {new Date(p.lastSyncAt).toISOString().slice(0, 16).replace("T", " ")} UTC</p>
            <ButtonLink size="sm" href={`/results/${p.slug}`}>Open results</ButtonLink>
          </Card>
        ))}
      </div>
    </div>
  );
}
