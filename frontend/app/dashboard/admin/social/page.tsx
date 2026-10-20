"use client";
// app/dashboard/admin/social/page.tsx
// Social outbox: the posts AT24 prepares for its own accounts. Each shows the real card, the caption (editable before approval) and
// where it went. Approve = it is sent on the next 15-minute pass (or press "Run now"). Nothing is posted twice.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

interface Post {
  id: string;
  kind: string;
  title: string;
  text: string;
  imagePath: string;
  status: string;
  attempts: number;
  results: Record<string, string> | null;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
}
interface Payload {
  channels: { telegram: boolean; webhook: boolean; autoApprove: boolean | "daily" };
  posts: Post[];
}

const TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = { DRAFT: "warning", APPROVED: "neutral", SENT: "success", FAILED: "danger", SKIPPED: "neutral" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body.data as T;
}

export default function AdminSocialPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await call<Payload>("/api/private/admin/social"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: "approve" | "skip" | "retry" | "edit", text?: string) {
    setBusy(id);
    setError(null);
    try {
      await call("/api/private/admin/social", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action, text }) });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy("run");
    setNote(null);
    try {
      const r = await call<{ drafted: number; sent: number; failed: number; waiting: number }>("/api/private/social/cron/run", { method: "POST" });
      setNote(`Drafted ${r.drafted}, sent ${r.sent}, failed ${r.failed}, waiting ${r.waiting}.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Social outbox"
        description="Daily range card, weekly scoreboard and new analyses, prepared for AT24's own accounts. Approve a draft and it is sent on the next 15-minute pass. Telegram is posted directly; Instagram, LinkedIn and X go through your automation webhook."
        action={
          <Button variant="secondary" size="sm" loading={busy === "run"} onClick={runNow}>
            Run now
          </Button>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {note && <p className="text-sm text-text-2">{note}</p>}
      {data && (
        <Card padding="md" className="flex flex-wrap items-center gap-4 text-sm">
          <span>Telegram channel: <Badge tone={data.channels.telegram ? "success" : "neutral"}>{data.channels.telegram ? "connected" : "not set"}</Badge></span>
          <span>Automation webhook (Instagram / LinkedIn / X): <Badge tone={data.channels.webhook ? "success" : "neutral"}>{data.channels.webhook ? "connected" : "not set"}</Badge></span>
          <span>Auto-approve: <Badge tone={data.channels.autoApprove ? "warning" : "neutral"}>{data.channels.autoApprove === "daily" ? "daily card + scoreboard only" : data.channels.autoApprove ? "ON (everything)" : "off (you approve each post)"}</Badge></span>
        </Card>
      )}
      {!data && !error && <p className="text-sm text-text-3">Loading...</p>}
      {data && data.posts.length === 0 && <p className="text-sm text-text-3">Nothing yet. The first daily card is prepared on a weekday after 05:30 UTC.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.posts.map((p) => {
          const text = drafts[p.id] ?? p.text;
          const editable = p.status === "DRAFT" || p.status === "FAILED" || p.status === "APPROVED";
          return (
            <Card key={p.id} padding="md" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-text">{p.title}</p>
                <Badge tone={TONE[p.status] ?? "neutral"}>{p.status}</Badge>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imagePath} alt={p.title} className="max-h-72 w-auto rounded-control border border-border" />
              <textarea
                className="h-44 w-full rounded-control border border-border bg-ink-2 p-3 text-xs text-text"
                value={text}
                disabled={!editable}
                onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
              />
              {p.results && <p className="text-xs text-text-3">Sent to: {Object.entries(p.results).map(([k, v]) => `${k}: ${v}`).join(" | ")}</p>}
              {p.error && <p className="text-xs text-danger">{p.error}</p>}
              <div className="flex flex-wrap gap-2">
                {editable && drafts[p.id] !== undefined && drafts[p.id] !== p.text && (
                  <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => act(p.id, "edit", drafts[p.id])}>Save caption</Button>
                )}
                {(p.status === "DRAFT") && <Button size="sm" loading={busy === p.id} onClick={() => act(p.id, "approve")}>Approve</Button>}
                {p.status === "FAILED" && <Button size="sm" loading={busy === p.id} onClick={() => act(p.id, "retry")}>Retry</Button>}
                {(p.status === "DRAFT" || p.status === "APPROVED" || p.status === "FAILED") && <Button size="sm" variant="secondary" loading={busy === p.id} onClick={() => act(p.id, "skip")}>Skip</Button>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
