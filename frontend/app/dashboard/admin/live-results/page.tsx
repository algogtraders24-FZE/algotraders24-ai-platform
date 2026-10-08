"use client";
// app/dashboard/admin/live-results/page.tsx
// Admin: every Live Results page of every user, with take-down (make private) and delete.
// Each action is audit-logged server-side. Admins can open any page, including private ones.
import { useCallback, useEffect, useState } from "react";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";

interface Row {
  id: string;
  slug: string;
  title: string;
  visibility: string;
  ownerEmail: string;
  accountLabel: string;
  mode: string;
  magicFilter: string | null;
  showAmounts: boolean;
  createdAt: number;
  lastSyncAt: number | null;
}

export default function AdminLiveResultsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/private/admin/live-results", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error?.message ?? "Could not load");
      setRows(j.data.pages as Row[]);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not load");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, init: RequestInit, label: string) {
    setBusy(id);
    try {
      const r = await fetch(`/api/private/admin/live-results/${encodeURIComponent(id)}`, init);
      if (!r.ok) throw new Error(`${label} failed`);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Alert tone="info">All Live Results pages of all users. Open shows the page exactly as visitors see it (admins can open private pages). Take down makes a page private; Delete removes it. Both are audit-logged.</Alert>
      {err && <Alert tone="danger">{err}</Alert>}
      <Card padding="sm">
        {rows === null ? (
          <p className="p-3 text-sm text-text-3">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-3 text-sm text-text-2">No Live Results pages yet.</p>
        ) : (
          <Table>
            <Thead>
              <tr><Th>Title</Th><Th>Owner</Th><Th>Account</Th><Th>Visibility</Th><Th>Shows</Th><Th>Last sync</Th><Th>Actions</Th></tr>
            </Thead>
            <Tbody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.title}</Td>
                  <Td>{p.ownerEmail}</Td>
                  <Td>{p.accountLabel} <Badge tone={p.mode === "real" ? "warning" : "neutral"} className="normal-case">{p.mode}</Badge></Td>
                  <Td><Badge tone={p.visibility === "public" ? "warning" : "neutral"} className="normal-case">{p.visibility}</Badge></Td>
                  <Td className="text-xs text-text-3">{p.magicFilter ? `EA ${p.magicFilter}` : "whole account"} · {p.showAmounts ? "amounts" : "percent only"}</Td>
                  <Td className="text-xs text-text-3">{p.lastSyncAt ? new Date(p.lastSyncAt).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "-"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-2">
                      <a className="text-xs font-semibold text-gold hover:underline" href={`/results/${p.slug}`} target="_blank" rel="noreferrer">Open</a>
                      {p.visibility !== "private" && (
                        <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => void act(p.id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "make_private" }) }, "Take down")}>Take down</Button>
                      )}
                      <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => { if (window.confirm(`Delete "${p.title}"? The link stops working.`)) void act(p.id, { method: "DELETE" }, "Delete"); }}>Delete</Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
