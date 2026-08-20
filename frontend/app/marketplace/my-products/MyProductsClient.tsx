"use client";
// app/marketplace/my-products/MyProductsClient.tsx
// Sprint M9 - lists the caller's own listings (GET /api/private/marketplace/
// listings) and lets them trigger the one narrow submit transition (POST
// .../[id]/submit) for a DRAFT row. deriveSubmissionState is the same real
// function the backend uses (services/marketplace/factory/submissionState.ts,
// no server-only dependency) - not a reimplementation.
import { useCallback, useEffect, useState } from "react";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Skeleton from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { deriveSubmissionState } from "@/services/marketplace/factory/submissionState";
import { publicationStateTone, trustStateLabel, trustStateTone } from "@/lib/marketplace";

interface ListingRow {
  id: string;
  slug: string;
  title: string;
  publicationState: string;
  evidenceId: string | null;
  validationId: string | null;
  riskAnalysisId: string | null;
  trustState: string | null;
  trustReasonCode: string | null;
  updatedAt: string;
}

interface SubmitOutcome {
  publicationState: string;
  trustState: string | null;
  ingestion: { stages: { stage: string; status: string; detail: string }[]; failedAt: string | null };
  eligibility: { eligible: boolean; reasons: { code: string; detail: string }[] };
}

export default function MyProductsClient() {
  const [items, setItems] = useState<ListingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, SubmitOutcome>>({});
  const [submitErrors, setSubmitErrors] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/private/marketplace/listings");
      const body = await res.json();
      if (!res.ok || body.status !== "ok") throw new Error(body?.error?.message ?? "Failed to load your products.");
      setItems(body.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your products.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSubmit(id: string) {
    setSubmittingId(id);
    setSubmitErrors((prev) => ({ ...prev, [id]: "" }));
    try {
      const res = await fetch(`/api/private/marketplace/listings/${id}/submit`, { method: "POST" });
      const body = await res.json();
      if (!res.ok || body.status !== "ok") throw new Error(body?.error?.message ?? `Submit failed (${res.status})`);
      setOutcomes((prev) => ({ ...prev, [id]: body.data }));
      await load();
    } catch (err) {
      setSubmitErrors((prev) => ({ ...prev, [id]: err instanceof Error ? err.message : "Submit failed." }));
    } finally {
      setSubmittingId(null);
    }
  }

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (items === null) return <Skeleton className="h-40 w-full" />;
  if (items.length === 0) {
    return <EmptyState title="No submissions yet" description="Create your first draft to get started." />;
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const submissionState = deriveSubmissionState(item);
        const outcome = outcomes[item.id];
        return (
          <div key={item.id} className="rounded-card border border-border bg-ink-2 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-text">{item.title}</h2>
                <p className="mt-1 text-xs uppercase tracking-wide text-text-3">Seller content</p>
              </div>
              <Badge tone={publicationStateTone(item.publicationState as never)}>{submissionState.replace(/_/g, " ")}</Badge>
            </div>

            <div className="mt-4 rounded-control border border-border/60 bg-ink-3 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-3">AT24 verified</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={trustStateTone(item.trustState as never)}>{trustStateLabel(item.trustState as never)}</Badge>
                {item.trustReasonCode && <span className="text-xs text-text-3">{item.trustReasonCode}</span>}
              </div>
            </div>

            {item.publicationState === "DRAFT" && (
              <div className="mt-4">
                <Button size="sm" loading={submittingId === item.id} onClick={() => handleSubmit(item.id)}>
                  Submit for review
                </Button>
                {submitErrors[item.id] && <Alert tone="danger" className="mt-2">{submitErrors[item.id]}</Alert>}
              </div>
            )}

            {outcome && (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Ingestion result</p>
                <ul className="space-y-1 text-xs text-text-2">
                  {outcome.ingestion.stages.map((s) => (
                    <li key={s.stage}>
                      <span className={s.status === "PASS" ? "text-success" : "text-danger"}>{s.status}</span> - {s.stage}: {s.detail}
                    </li>
                  ))}
                </ul>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Eligibility</p>
                {outcome.eligibility.eligible ? (
                  <p className="text-xs text-success">Eligible for publication.</p>
                ) : (
                  <ul className="space-y-1 text-xs text-warning">
                    {outcome.eligibility.reasons.map((r) => (
                      <li key={r.code}>{r.code}: {r.detail}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
