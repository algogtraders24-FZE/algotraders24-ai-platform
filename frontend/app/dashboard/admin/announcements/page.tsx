"use client";
// app/dashboard/admin/announcements/page.tsx
// Product announcements: write the "what is new" email once, send a real test to your own inbox, then send it to every user who has
// not opted out. It is sent from support@ and every email has an unsubscribe link. Nothing here ever sends by itself.
import { useCallback, useEffect, useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";

interface Announcement {
  id: string;
  subject: string;
  preheader: string | null;
  bodyText: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  status: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  createdAt: string;
  sentAt: string | null;
}
interface Payload {
  announcements: Announcement[];
  audienceCount: number;
  optOutCount: number;
  emailConfigured: boolean;
  fromAddress: string;
}
interface Draft {
  subject: string;
  preheader: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
}

const EMPTY: Draft = { subject: "", preheader: "", bodyText: "", ctaLabel: "", ctaUrl: "https://www.algotraders24.ai/marketplace" };
const TONE: Record<string, "neutral" | "success" | "warning" | "danger"> = { DRAFT: "warning", SENDING: "neutral", SENT: "success" };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body.data as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function AdminAnnouncementsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Draft>(EMPTY);
  const [edits, setEdits] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    try {
      setData(await call<Payload>("/api/private/admin/announcements"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run("create", async () => {
      await call("/api/private/admin/announcements", json("POST", form));
      setForm(EMPTY);
      setNote("Draft saved. Send yourself a test before sending to everyone.");
    });

  const save = (a: Announcement) =>
    run(a.id, async () => {
      await call("/api/private/admin/announcements", json("PATCH", { id: a.id, action: "edit", ...edits[a.id] }));
      setEdits((e) => {
        const { [a.id]: _drop, ...rest } = e;
        void _drop;
        return rest;
      });
      setNote("Draft updated.");
    });

  const test = (a: Announcement) =>
    run(a.id, async () => {
      const r = await call<{ to: string }>("/api/private/admin/announcements", json("PATCH", { id: a.id, action: "test" }));
      setNote(`Test email sent to ${r.to}. Check how it looks (also in spam) before sending to everyone.`);
    });

  const remove = (a: Announcement) =>
    run(a.id, async () => {
      if (!window.confirm("Delete this draft?")) return;
      await call("/api/private/admin/announcements", json("PATCH", { id: a.id, action: "delete" }));
    });

  const send = (a: Announcement) =>
    run(a.id, async () => {
      const n = data?.audienceCount ?? 0;
      if (a.status === "DRAFT" && !window.confirm(`Send "${a.subject}" to ${n} users from ${data?.fromAddress}? This cannot be undone.`)) return;
      let total = { sent: 0, failed: 0 };
      for (let i = 0; i < 50; i++) {
        const r = await call<{ sent: number; failed: number; remaining: number; done: boolean }>("/api/private/admin/announcements", json("PATCH", { id: a.id, action: "send", confirmCount: n }));
        total = { sent: total.sent + r.sent, failed: total.failed + r.failed };
        setNote(`Sending... ${total.sent} sent, ${total.failed} failed, ${r.remaining} left.`);
        if (r.done || r.sent + r.failed === 0) break;
      }
      setNote(`Finished this pass: ${total.sent} sent, ${total.failed} failed. ${total.failed ? 'Press "Retry failed" to try the failed ones again.' : ""}`);
    });

  const field = "w-full rounded-control border border-border bg-ink-2 p-2.5 text-sm text-text";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Product announcements"
        description="Tell users about new products and features. Write it once, send yourself a test, then send to everyone who has not unsubscribed. Sent from support@ - replies reach the support inbox."
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {note && <Alert tone="info">{note}</Alert>}
      {data && (
        <Card padding="md" className="flex flex-wrap items-center gap-4 text-sm">
          <span>Will reach: <Badge tone="success">{data.audienceCount} users</Badge></span>
          <span>Unsubscribed: <Badge tone="neutral">{data.optOutCount}</Badge></span>
          <span>Sender: <Badge tone="neutral">{data.fromAddress}</Badge></span>
          <span>Email sending: <Badge tone={data.emailConfigured ? "success" : "danger"}>{data.emailConfigured ? "configured" : "RESEND_API_KEY missing"}</Badge></span>
        </Card>
      )}

      <Card padding="md" className="space-y-3">
        <p className="text-sm font-semibold text-text">New announcement</p>
        <input className={field} placeholder="Subject (e.g. New on the marketplace: Gold Sniper)" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        <input className={field} placeholder="Preview line shown in the inbox (optional)" value={form.preheader} onChange={(e) => setForm({ ...form, preheader: e.target.value })} />
        <textarea
          className={`${field} h-48`}
          placeholder={"Write like a person. Blank line = new paragraph. Start lines with '- ' for bullets. **bold** works.\n\nSay what is new, who it is for, and the honest caveats. No buy/sell calls, targets or guarantees."}
          value={form.bodyText}
          onChange={(e) => setForm({ ...form, bodyText: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <input className={field} placeholder="Button label (e.g. View Gold Sniper)" value={form.ctaLabel} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} />
          <input className={field} placeholder="Button link (https://www.algotraders24.ai/...)" value={form.ctaUrl} onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} />
        </div>
        <Button size="sm" loading={busy === "create"} onClick={create}>Save draft</Button>
      </Card>

      {data?.announcements.length === 0 && <p className="text-sm text-text-3">No announcements yet.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {data?.announcements.map((a) => {
          const e = edits[a.id];
          const draftable = a.status === "DRAFT";
          const cur: Draft = e ?? { subject: a.subject, preheader: a.preheader ?? "", bodyText: a.bodyText, ctaLabel: a.ctaLabel ?? "", ctaUrl: a.ctaUrl ?? "" };
          return (
            <Card key={a.id} padding="md" className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-text">{a.subject}</p>
                <Badge tone={TONE[a.status] ?? "neutral"}>{a.status}</Badge>
              </div>
              {draftable ? (
                <>
                  <input className={field} value={cur.subject} onChange={(ev) => setEdits((s) => ({ ...s, [a.id]: { ...cur, subject: ev.target.value } }))} />
                  <textarea className={`${field} h-40 text-xs`} value={cur.bodyText} onChange={(ev) => setEdits((s) => ({ ...s, [a.id]: { ...cur, bodyText: ev.target.value } }))} />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className={field} value={cur.ctaLabel} onChange={(ev) => setEdits((s) => ({ ...s, [a.id]: { ...cur, ctaLabel: ev.target.value } }))} />
                    <input className={field} value={cur.ctaUrl} onChange={(ev) => setEdits((s) => ({ ...s, [a.id]: { ...cur, ctaUrl: ev.target.value } }))} />
                  </div>
                </>
              ) : (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-control border border-border bg-ink-2 p-3 text-xs text-text-2">{a.bodyText}</pre>
              )}
              <p className="text-xs text-text-3">
                {a.status === "DRAFT" ? "Not sent yet." : `Sent ${a.sentCount} of ${a.recipientCount}${a.failedCount ? `, ${a.failedCount} failed` : ""}${a.sentAt ? ` - finished ${new Date(a.sentAt).toLocaleString()}` : ""}.`}
              </p>
              <div className="flex flex-wrap gap-2">
                {draftable && e && <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => save(a)}>Save changes</Button>}
                <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => test(a)}>Send test to me</Button>
                {draftable && <Button size="sm" loading={busy === a.id} disabled={!data?.emailConfigured || !!e} onClick={() => send(a)}>Send to {data?.audienceCount ?? 0} users</Button>}
                {a.status === "SENDING" && <Button size="sm" loading={busy === a.id} onClick={() => send(a)}>{a.failedCount ? "Retry failed" : "Continue sending"}</Button>}
                {draftable && <Button size="sm" variant="secondary" loading={busy === a.id} onClick={() => remove(a)}>Delete</Button>}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
