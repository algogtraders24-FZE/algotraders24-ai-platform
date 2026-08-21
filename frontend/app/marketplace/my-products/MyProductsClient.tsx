"use client";
// app/marketplace/my-products/MyProductsClient.tsx
// Sprint M9 - lists the caller's own listings (GET /api/private/marketplace/
// listings) and lets them trigger the one narrow submit transition (POST
// .../[id]/submit) for a DRAFT row. deriveSubmissionState is the same real
// function the backend uses (services/marketplace/factory/submissionState.ts,
// no server-only dependency) - not a reimplementation.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
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
  media: string[];
  publicationState: string;
  evidenceId: string | null;
  validationId: string | null;
  riskAnalysisId: string | null;
  trustState: string | null;
  trustReasonCode: string | null;
  updatedAt: string;
}

// media[0] = icon/logo (must be exactly 200x200, enforced server-side),
// media[1] = hero/banner, media[2+] = screenshot gallery - same convention
// ListingDetailView and MarketplaceListingCard render by.
type MediaKind = "icon" | "banner" | "screenshot";

async function uploadMedia(listingId: string, file: File, kind: MediaKind): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);
  const res = await fetch(`/api/private/marketplace/listings/${listingId}/media`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok || body.status !== "ok") throw new Error(body?.error?.message ?? `Upload failed (${res.status})`);
  return body.data.url as string;
}

async function patchMedia(listingId: string, media: string[]): Promise<void> {
  const res = await fetch(`/api/private/marketplace/listings/${listingId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ media }),
  });
  const body = await res.json();
  if (!res.ok || body.status !== "ok") throw new Error(body?.error?.message ?? `Save failed (${res.status})`);
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
  const [mediaUploadingKey, setMediaUploadingKey] = useState<string | null>(null);
  const [mediaErrors, setMediaErrors] = useState<Record<string, string>>({});

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

  async function handleMediaChange(item: ListingRow, slot: 0 | 1, kind: MediaKind, file: File | null) {
    if (!file) return;
    const key = `${item.id}:${slot}`;
    setMediaErrors((prev) => ({ ...prev, [key]: "" }));
    setMediaUploadingKey(key);
    try {
      const url = await uploadMedia(item.id, file, kind);
      const nextMedia = [...item.media];
      nextMedia[slot] = url;
      await patchMedia(item.id, nextMedia);
      await load();
    } catch (err) {
      setMediaErrors((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : "Upload failed." }));
    } finally {
      setMediaUploadingKey(null);
    }
  }

  async function handleScreenshotAdd(item: ListingRow, file: File | null) {
    if (!file) return;
    const key = `${item.id}:screenshot`;
    setMediaErrors((prev) => ({ ...prev, [key]: "" }));
    setMediaUploadingKey(key);
    try {
      const url = await uploadMedia(item.id, file, "screenshot");
      const nextMedia = [...item.media];
      while (nextMedia.length < 2) nextMedia.push(""); // keep icon/banner slots stable even if unset
      nextMedia.push(url);
      await patchMedia(item.id, nextMedia);
      await load();
    } catch (err) {
      setMediaErrors((prev) => ({ ...prev, [key]: err instanceof Error ? err.message : "Upload failed." }));
    } finally {
      setMediaUploadingKey(null);
    }
  }

  async function handleScreenshotRemove(item: ListingRow, index: number) {
    const nextMedia = item.media.filter((_, i) => i !== index);
    await patchMedia(item.id, nextMedia);
    await load();
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

            <div className="mt-4 rounded-control border border-border/60 bg-ink-3 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Branding</p>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([0, 1] as const).map((slot) => {
                  const kind: MediaKind = slot === 0 ? "icon" : "banner";
                  const key = `${item.id}:${slot}`;
                  const label = slot === 0 ? "Icon / logo — 200 x 200px required" : "Banner / hero (wide)";
                  const current = item.media[slot];
                  return (
                    <div key={slot}>
                      <p className="mb-1 text-[11px] text-text-3">{label}</p>
                      {current && (
                        <Image
                          src={current}
                          alt=""
                          width={slot === 0 ? 40 : 160}
                          height={40}
                          unoptimized
                          className="mb-2 rounded-lg border border-border object-cover"
                        />
                      )}
                      <input
                        type="file"
                        accept="image/svg+xml,image/png,image/jpeg,image/webp"
                        disabled={mediaUploadingKey === key}
                        onChange={(e) => handleMediaChange(item, slot, kind, e.target.files?.[0] ?? null)}
                        className="block w-full text-xs text-text-3 file:mr-3 file:rounded-control file:border-0 file:bg-ink-4 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-text-2 hover:file:bg-border disabled:opacity-50"
                      />
                      {mediaErrors[key] && <p className="mt-1 text-xs text-danger">{mediaErrors[key]}</p>}
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 border-t border-border/60 pt-3">
                <p className="mb-1 text-[11px] text-text-3">Screenshots (as many as you like — strategy tester results, chart setups, etc.)</p>
                <div className="flex flex-wrap gap-2">
                  {item.media.slice(2).map((url, i) =>
                    url ? (
                      <div key={i} className="relative">
                        <Image src={url} alt="" width={96} height={64} unoptimized className="rounded-lg border border-border object-cover" />
                        <button
                          type="button"
                          onClick={() => handleScreenshotRemove(item, i + 2)}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-white"
                          aria-label="Remove screenshot"
                        >
                          ×
                        </button>
                      </div>
                    ) : null,
                  )}
                </div>
                <input
                  type="file"
                  accept="image/svg+xml,image/png,image/jpeg,image/webp"
                  disabled={mediaUploadingKey === `${item.id}:screenshot`}
                  onChange={(e) => {
                    handleScreenshotAdd(item, e.target.files?.[0] ?? null);
                    e.target.value = "";
                  }}
                  className="mt-2 block w-full text-xs text-text-3 file:mr-3 file:rounded-control file:border-0 file:bg-ink-4 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-text-2 hover:file:bg-border disabled:opacity-50"
                />
                {mediaErrors[`${item.id}:screenshot`] && <p className="mt-1 text-xs text-danger">{mediaErrors[`${item.id}:screenshot`]}</p>}
              </div>
            </div>

            <div className="mt-4">
              <Link href={`/marketplace/preview/${item.id}`} className="text-xs font-medium text-gold hover:underline">
                Preview this listing →
              </Link>
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
