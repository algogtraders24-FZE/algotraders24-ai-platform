"use client";
// app/dashboard/admin/support-handoffs/[id]/page.tsx
// AT24 Support Human Handoff MVP - D12/D14 "Case detail". Shows the ticket
// state, the LIVE conversation trace (re-fetched, never duplicated - D6),
// evidence references, human-reply thread, assignment, lifecycle actions,
// and audit-visible fields. No unrestricted raw account dump - only the
// evidence the escalating run itself already retrieved (§14).
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminHandoffDetail } from "@/services/support/handoff-service";
import Card from "@/components/ui/Card";
import Badge, { type BadgeTone } from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";

const STATUS_TONE: Record<string, BadgeTone> = {
  OPEN: "warning",
  ASSIGNED: "info",
  IN_PROGRESS: "info",
  RESOLVED: "success",
  CANCELLED: "neutral",
};

// The locked D4 transition matrix, mirrored client-side for the button
// list only - the server (transitionSupportHandoffAsAdmin) is the real,
// authoritative validator; an invalid attempt here still gets rejected
// server-side (defense in depth, not the only check).
const NEXT_STATUSES: Record<string, string[]> = {
  OPEN: ["CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["RESOLVED", "CANCELLED"],
  RESOLVED: ["OPEN"],
  CANCELLED: [],
};

export default function AdminSupportHandoffDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [detail, setDetail] = useState<AdminHandoffDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await AdminApi.getSupportHandoff(id));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load support ticket");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = async () => {
    setBusy(true);
    try {
      await AdminApi.assignSupportHandoff(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign");
    } finally {
      setBusy(false);
    }
  };

  const transition = async (status: string) => {
    setBusy(true);
    try {
      await AdminApi.transitionSupportHandoff(id, status);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy(true);
    try {
      await AdminApi.replyToSupportHandoff(id, reply.trim());
      setReply("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton className="h-96" />;
  if (error && !detail) return <Alert tone="danger">{error}</Alert>;
  if (!detail) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[detail.status] ?? "neutral"}>{detail.status}</Badge>
          <Badge>{detail.triggerSource === "AI_ESCALATION" ? "AI escalation" : "User requested"}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          {!detail.assignedAdminUserId && detail.status !== "RESOLVED" && detail.status !== "CANCELLED" && (
            <Button size="sm" onClick={assign} disabled={busy}>
              Assign to me
            </Button>
          )}
          {(NEXT_STATUSES[detail.status] ?? []).map((s) => (
            <Button key={s} size="sm" variant="secondary" onClick={() => transition(s)} disabled={busy}>
              {s === "OPEN" ? "Reopen" : `Mark ${s}`}
            </Button>
          ))}
        </div>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      <Card padding="sm">
        <h3 className="text-sm font-semibold text-text">Ticket</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-2">
          <dt className="text-text-3">Reason</dt>
          <dd>{detail.reason.replace(/-/g, " ")}</dd>
          <dt className="text-text-3">User</dt>
          <dd>{detail.userId}</dd>
          <dt className="text-text-3">Assigned to</dt>
          <dd>{detail.assignedAdminUserId ?? "Unassigned"}</dd>
          <dt className="text-text-3">Created</dt>
          <dd>{new Date(detail.createdAt).toLocaleString()}</dd>
          {detail.resolvedAt && (
            <>
              <dt className="text-text-3">Resolved</dt>
              <dd>{new Date(detail.resolvedAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      </Card>

      <Card padding="sm">
        <h3 className="text-sm font-semibold text-text">Conversation</h3>
        <ul className="mt-2 space-y-3">
          {detail.conversationTurns.map((t) => (
            <li key={t.runId} className="rounded-lg border border-border bg-ink p-3">
              <p className="text-sm text-text">{t.question}</p>
              {t.generatedAnswer && <p className="mt-1 text-sm text-text-2">{t.generatedAnswer}</p>}
              {t.citations.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {t.citations.map((c, i) => (
                    <li key={i} className="text-xs text-text-2">
                      <span className="text-text-3">[{c.topic}]</span> {c.claim}
                    </li>
                  ))}
                </ul>
              )}
              {t.accountFindings.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {t.accountFindings.map((f, i) => (
                    <li key={i} className="text-xs text-text-2">
                      <span className="text-text-3">[account: {f.domain}]</span> {f.claim}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11px] text-text-3">
                {t.coverage ?? "no-coverage"} {t.escalate ? "· escalated" : ""} · {new Date(t.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
          {detail.conversationTurns.length === 0 && <p className="text-xs text-text-3">No conversation turns found.</p>}
        </ul>
      </Card>

      <Card padding="sm">
        <h3 className="text-sm font-semibold text-text">Evidence referenced</h3>
        <p className="mt-2 text-xs text-text-3">
          {detail.evidenceIds.length > 0 ? `${detail.evidenceIds.length} evidence row(s) referenced from the escalating run.` : "No evidence was retrieved for this escalation."}
        </p>
      </Card>

      <Card padding="sm">
        <h3 className="text-sm font-semibold text-text">Support reply</h3>
        <ul className="mt-2 space-y-2">
          {detail.messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-lg p-3 text-sm ${m.authorType === "HUMAN" ? "border border-gold/40 bg-gold/5 text-text" : "bg-ink-3 text-text-2"}`}
            >
              {m.content}
              <div className="mt-1 text-[11px] text-text-3">
                {m.authorType === "HUMAN" ? `Support (${m.authorUserId ?? "admin"})` : "User"} · {new Date(m.createdAt).toLocaleString()}
              </div>
            </li>
          ))}
          {detail.messages.length === 0 && <p className="text-xs text-text-3">No messages yet.</p>}
        </ul>
        {detail.status !== "RESOLVED" && detail.status !== "CANCELLED" && (
          <div className="mt-3 flex items-center gap-2">
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              placeholder="Reply to the user…"
              className="w-full rounded-lg border border-border bg-ink px-3 py-2 text-sm text-text outline-none focus:border-gold"
            />
            <Button size="sm" onClick={sendReply} disabled={busy || !reply.trim()}>
              Send
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
