"use client";
// app/dashboard/admin/knowledge-loop/candidates/[id]/page.tsx
// Sprint K4.2-C Phase 1 - one candidate's review action. Approve/reject
// call GovernanceService.approve()/reject() (K4.2-B, unmodified) via the
// admin routes; the candidate row itself was created by
// CandidateService.propose() (K4.2-A, unmodified).
import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AdminApi, type AdminCandidateRow } from "@/services/api/AdminApi";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";
import Textarea from "@/components/ui/Textarea";

export default function AdminGovernanceCandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [candidate, setCandidate] = useState<AdminCandidateRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editedAnswer, setEditedAnswer] = useState("");
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const c = await AdminApi.getGovernanceCandidate(id);
      setCandidate(c);
      setEditedAnswer(c.proposedAnswer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidate");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const canDecide = candidate?.status === "candidate" || candidate?.status === "under_review";

  const onApprove = async () => {
    if (!candidate) return;
    setBusy(true);
    setError(null);
    try {
      const opts: { editedAnswer?: string; reviewerNotes?: string } = {};
      if (editedAnswer !== candidate.proposedAnswer) opts.editedAnswer = editedAnswer;
      if (reviewerNotes.trim()) opts.reviewerNotes = reviewerNotes.trim();
      const result = await AdminApi.approveGovernanceCandidate(id, opts);
      if (result.outcome === "blocked-privacy") {
        setError(`Blocked by privacy re-scan: ${(result.blockedReasons ?? []).join("; ")}`);
        setBusy(false);
        return;
      }
      router.push("/dashboard/admin/knowledge-loop/candidates");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
      setBusy(false);
    }
  };

  const onReject = async () => {
    if (!rejectReason.trim()) {
      setError("A rejection reason is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await AdminApi.rejectGovernanceCandidate(id, rejectReason.trim());
      router.push("/dashboard/admin/knowledge-loop/candidates");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
      setBusy(false);
    }
  };

  if (loading) return <Skeleton className="h-64" />;
  if (!candidate) return <Alert tone="danger">{error ?? "Candidate not found"}</Alert>;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/admin/knowledge-loop/candidates" className="text-sm text-gold hover:underline">
        ← Back to candidates
      </Link>

      {error && <Alert tone="danger">{error}</Alert>}

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2">
          <Badge>{candidate.status}</Badge>
          <span className="text-xs text-text-3">
            {candidate.sourceType} · {candidate.reasonForCandidate} · confidence {candidate.confidence.toFixed(2)}
          </span>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-text-3">Canonical question</div>
          <div className="text-text">{candidate.canonicalQuestion}</div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-text-3">Proposed answer (editable before approval)</div>
          <Textarea value={editedAnswer} onChange={(e) => setEditedAnswer(e.target.value)} rows={6} disabled={!canDecide} />
        </div>

        <div>
          <div className="text-xs font-semibold uppercase text-text-3">Evidence</div>
          <pre className="max-h-40 overflow-auto rounded-control bg-surface-2 p-2 text-xs text-text-3">
            {JSON.stringify(candidate.evidence, null, 2)}
          </pre>
        </div>

        {candidate.duplicateOfId && (
          <Alert tone="warning">
            Possible duplicate of Knowledge <span className="font-mono">{candidate.duplicateOfId}</span> (similarity{" "}
            {candidate.similarityScore?.toFixed(3)}).
          </Alert>
        )}

        {candidate.finalKnowledgeId && (
          <Alert tone="info">
            Already resolved → Knowledge <span className="font-mono">{candidate.finalKnowledgeId}</span>
          </Alert>
        )}
      </Card>

      {canDecide && (
        <Card className="space-y-4 p-5">
          <div>
            <div className="text-xs font-semibold uppercase text-text-3">Reviewer notes (optional, carried into provenance)</div>
            <Textarea value={reviewerNotes} onChange={(e) => setReviewerNotes(e.target.value)} rows={2} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={onApprove} disabled={busy}>
              Approve
            </Button>
            <div className="flex flex-1 items-center gap-2">
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={1}
                placeholder="Reason for rejection (required to reject)"
                className="flex-1"
              />
              <Button variant="danger" onClick={onReject} disabled={busy}>
                Reject
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
