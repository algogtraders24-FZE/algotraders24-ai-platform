"use client";

// app/dashboard/automation - AT24 Automation (MVP) list + dashboard metrics.
// LOCKED: AUTOMATION_DECISION_LOCK.md. Pure view over /api/private/automations
// - every metric is a sum of real AutomationRun stats returned by the server.
// No client-computed run status, no fabricated numbers, no "Workflow" naming.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AutomationListItem } from "@/types/automation";
import { AutomationApi } from "@/services/api/AutomationApi";
import { AutomationStatusPill, RunStatusPill, describeTrigger } from "@/components/automation/ui";

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

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Automation</h1>
            <p className="text-sm text-text-3">
              Build workflows that automatically run AT24 intelligence, research and AI agents.
            </p>
          </div>
          <Link
            href="/dashboard/automation/new"
            className="rounded-lg border border-gold bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition hover:bg-gold/20"
          >
            + Create Automation
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-danger/40 bg-danger/10 p-6 text-sm text-danger">{error}</div>
        ) : items === null ? (
          <div className="rounded-xl border border-border bg-ink-2 p-8 text-center text-sm text-text-3">Loading…</div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(
                [
                  ["Active Automations", m.active],
                  ["Runs Today", m.runsToday],
                  ["Successful Runs (30d)", m.succeeded],
                  ["Failed Runs (30d)", m.failed],
                  ["Credits Used (30d)", m.credits],
                ] as [string, number][]
              ).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-ink-2 p-4">
                  <p className="text-xs text-text-3">{label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
                </div>
              ))}
            </section>

            {items.length === 0 ? (
              <EmptyState />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-ink-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-text-3">
                      <th className="p-3">Name</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Trigger</th>
                      <th className="p-3">Last run</th>
                      <th className="p-3">Next run</th>
                      <th className="p-3 text-right">Credits 30d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id} className="border-t border-border hover:bg-ink-3/50">
                        <td className="p-3">
                          <Link href={`/dashboard/automation/${a.id}`} className="font-medium text-text hover:text-gold">
                            {a.name}
                          </Link>
                        </td>
                        <td className="p-3">
                          <AutomationStatusPill status={a.status} />
                        </td>
                        <td className="p-3 text-text-2">{describeTrigger(a)}</td>
                        <td className="p-3">
                          {a.lastRun ? <RunStatusPill status={a.lastRun.status} /> : <span className="text-text-3">—</span>}
                        </td>
                        <td className="p-3 text-text-2">
                          {a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : "—"}
                        </td>
                        <td className="p-3 text-right tabular-nums text-text-2">{a.stats30d.creditsUsed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-border bg-ink-2 p-10 text-center">
      <p className="text-lg font-semibold">No automations yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-3">
        Automate recurring market research, intelligence and AI agent tasks. Create your first workflow to get started.
      </p>
      <Link
        href="/dashboard/automation/new"
        className="mt-4 inline-block rounded-lg border border-gold bg-gold/10 px-4 py-2 text-sm font-medium text-gold transition hover:bg-gold/20"
      >
        Create your first workflow
      </Link>
    </div>
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
