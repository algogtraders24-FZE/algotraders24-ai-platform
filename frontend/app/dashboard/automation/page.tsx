"use client";

// app/dashboard/automation - AT24 Automation (MVP) list + dashboard metrics.
// LOCKED: AUTOMATION_DECISION_LOCK.md. Pure view over /api/private/automations
// - every metric is a sum of real AutomationRun stats returned by the server.
// No client-computed run status, no fabricated numbers, no "Workflow" naming.
//
// Sprint UI-02.3 - visual-only pass: self min-h-screen/max-w-6xl wrapper
// removed (AppShell already provides the centered content column), <h1> ->
// PageHeader, the 5 hand-rolled metric tiles -> StatCard (all 5 are real
// AutomationRun-derived sums, same summarise() logic, unchanged), the raw
// <table> -> DataTable, the local duplicate EmptyState() -> the shared
// EmptyState primitive, "+ Create Automation" link -> ButtonLink. Same
// AutomationApi.list() call, same summarise() math, same states.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AutomationListItem } from "@/types/automation";
import { AutomationApi } from "@/services/api/AutomationApi";
import { AutomationStatusPill, RunStatusPill, describeTrigger } from "@/components/automation/ui";
import ErrorState from "@/components/ui/ErrorState";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import PageHeader from "@/components/ui/PageHeader";
import ButtonLink from "@/components/ui/ButtonLink";
import StatCard from "@/components/ui/StatCard";
import DataTable, { type DataTableColumn } from "@/components/ui/DataTable";
import { Zap, Calendar, CheckCircle2, XCircle, CreditCard } from "lucide-react";

export default function AutomationPage() {
  const [items, setItems] = useState<AutomationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    AutomationApi.list()
      .then((d) => live && setItems(d.items))
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Failed to load automations"));
    return () => {
      live = false;
    };
  }, []);

  const m = summarise(items ?? []);

  const columns: DataTableColumn<AutomationListItem>[] = [
    { key: "name", header: "Name", render: (a) => <NameLink item={a} /> },
    { key: "status", header: "Status", render: (a) => <AutomationStatusPill status={a.status} /> },
    { key: "trigger", header: "Trigger", render: (a) => describeTrigger(a) },
    { key: "lastRun", header: "Last run", render: (a) => (a.lastRun ? <RunStatusPill status={a.lastRun.status} /> : "—") },
    { key: "nextRun", header: "Next run", render: (a) => (a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : "—") },
    { key: "credits", header: "Credits 30d", align: "right", render: (a) => a.stats30d.creditsUsed },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Automation"
        title="Automation"
        description="Build automations that run AT24 intelligence, research and AI agents on a schedule."
        action={<ButtonLink href="/dashboard/automation/new">+ Create Automation</ButtonLink>}
      />

      {error ? (
        <ErrorState title="Could not load automations" description={error} />
      ) : items === null ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5" aria-busy="true" aria-live="polite">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Active Automations" value={m.active} icon={Zap} />
            <StatCard label="Runs Today" value={m.runsToday} icon={Calendar} />
            <StatCard label="Successful Runs (30d)" value={m.succeeded} icon={CheckCircle2} />
            <StatCard label="Failed Runs (30d)" value={m.failed} icon={XCircle} />
            <StatCard label="Credits Used (30d)" value={m.credits} icon={CreditCard} />
          </div>

          {items.length === 0 ? (
            <EmptyState
              title="No automations yet"
              description="Automate recurring market research, intelligence and AI agent tasks. Create your first automation to get started."
              action={<ButtonLink href="/dashboard/automation/new">Create your first automation</ButtonLink>}
            />
          ) : (
            <DataTable columns={columns} rows={items} getRowKey={(a) => a.id} />
          )}
        </>
      )}
    </div>
  );
}

function NameLink({ item }: { item: AutomationListItem }) {
  return (
    <Link href={`/dashboard/automation/${item.id}`} className="font-medium text-text hover:text-gold">
      {item.name}
    </Link>
  );
}

function summarise(items: AutomationListItem[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  let active = 0;
  let runsToday = 0;
  let succeeded = 0;
  let failed = 0;
  let credits = 0;
  for (const a of items) {
    if (a.status === "ACTIVE") active += 1;
    succeeded += a.stats30d.succeeded;
    failed += a.stats30d.failed;
    credits += a.stats30d.creditsUsed;
    if (a.lastRun?.startedAt && new Date(a.lastRun.startedAt) >= startOfToday) runsToday += 1;
  }
  return { active, runsToday, succeeded, failed, credits: Math.round(credits * 100) / 100 };
}
