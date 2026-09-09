"use client";

// app/dashboard/automation - AT24 Automation (MVP).
// LOCKED: AUTOMATION_DECISION_LOCK.md. This page shows ONLY real data from
// /api/private/automations (no client-computed or mock metrics). The guided
// builder and run-detail views are separate routes.
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AutomationListItem } from "@/types/automation";

interface ApiEnvelope {
  status: "ok" | "error";
  data?: { items: AutomationListItem[]; total: number };
  error?: { message: string };
}

export default function AutomationPage() {
  const [items, setItems] = useState<AutomationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    fetch("/api/private/automations", { signal: ac.signal })
      .then((r) => r.json() as Promise<ApiEnvelope>)
      .then((j) => {
        if (j.status === "ok" && j.data) setItems(j.data.items);
        else setError(j.error?.message ?? "Failed to load automations");
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Failed to load automations");
      });
    return () => ac.abort();
  }, []);

  const metrics = deriveMetrics(items ?? []);

  return (
    <div className="min-h-screen bg-ink p-6 text-text">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Automation</h1>
            <p className="text-sm text-text-3">
              Build workflows that automatically run AT24 intelligence, research and AI agents.
            </p>
          </div>
          <Link
            href="/dashboard/automation/new"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink"
          >
            + Create Automation
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-danger/50 bg-danger/20 p-6 text-sm text-danger">{error}</div>
        ) : items === null ? (
          <div className="rounded-xl border border-border bg-ink-2 p-8 text-center text-sm text-text-3">Loading…</div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-4 md:grid-cols-5">
              {(
                [
                  ["Active Automations", metrics.active],
                  ["Runs Today", metrics.runsToday],
                  ["Successful Runs", metrics.succeeded30d],
                  ["Failed Runs", metrics.failed30d],
                  ["Credits Used", metrics.credits30d],
                ] as [string, number][]
              ).map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border bg-ink-2 p-4">
                  <p className="text-xs text-text-3">{label}</p>
                  <p className="mt-1 text-2xl font-bold">{value}</p>
                </div>
              ))}
            </section>

            {items.length === 0 ? (
              <div className="rounded-xl border border-border bg-ink-2 p-10 text-center">
                <p className="text-lg font-semibold">No automations yet</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-text-3">
                  Automate recurring market research, intelligence and AI agent tasks. Create your first
                  workflow to get started.
                </p>
                <Link
                  href="/dashboard/automation/new"
                  className="mt-4 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink"
                >
                  Create your first workflow
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-ink-2">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-text-3">
                    <tr>
                      <th className="p-3">Name</th>
                      <th className="p-3">Status</th>
                      <th className="p-3">Trigger</th>
                      <th className="p-3">Last run</th>
                      <th className="p-3">Next run</th>
                      <th className="p-3">Credits (30d)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="p-3">
                          <Link href={`/dashboard/automation/${a.id}`} className="font-medium hover:underline">
                            {a.name}
                          </Link>
                        </td>
                        <td className="p-3">{a.status}</td>
                        <td className="p-3">{describeTrigger(a)}</td>
                        <td className="p-3">{a.lastRun ? a.lastRun.status : "—"}</td>
                        <td className="p-3">{a.nextRunAt ? new Date(a.nextRunAt).toLocaleString() : "—"}</td>
                        <td className="p-3">{a.stats30d.creditsUsed}</td>
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

function describeTrigger(a: AutomationListItem): string {
  const t = a.trigger;
  if (t.type === "manual") return "Manual";
  if (t.type === "once") return `Once${t.runAt ? ` · ${new Date(t.runAt).toLocaleDateString()}` : ""}`;
  if (t.type === "daily") return `Daily · ${t.slot ?? ""}`;
  return `Weekly · ${t.daysOfWeek.join(", ")}`;
}

function deriveMetrics(items: AutomationListItem[]) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  let runsToday = 0;
  let succeeded30d = 0;
  let failed30d = 0;
  let credits30d = 0;
  let active = 0;
  for (const a of items) {
    if (a.status === "ACTIVE") active += 1;
    succeeded30d += a.stats30d.succeeded;
    failed30d += a.stats30d.failed;
    credits30d += a.stats30d.creditsUsed;
    if (a.lastRun?.startedAt && new Date(a.lastRun.startedAt) >= startOfToday) runsToday += 1;
  }
  return {
    active,
    runsToday,
    succeeded30d,
    failed30d,
    credits30d: Math.round(credits30d * 100) / 100,
  };
}
