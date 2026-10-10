"use client";
// components/marketplace/SelfServeFilesPanel.tsx
// My Products > a self-serve listing: upload a NEW VERSION of the product file, and attach (or replace) the MT5 backtest report.
// Same direct-to-storage flow as the sell wizard (browser -> private bucket with a one-time signed URL, then finalize).
import { useCallback, useEffect, useState } from "react";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ALLOWED_PRODUCT_EXTENSIONS, BLOCKED_EXTENSIONS, BUILDS_BUCKET, MAX_BUILD_BYTES, extensionOf } from "@/lib/marketplace/selfServe";
import { ALLOWED_REPORT_EXTENSIONS, MAX_REPORT_BYTES, isAllowedReportFile } from "@/lib/marketplace/reportCheck";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body.data as T;
}

const FILE_BTN = "block w-full text-sm text-text-2 file:mr-3 file:rounded-control file:border file:border-gold file:bg-transparent file:px-4 file:py-2 file:font-semibold file:text-gold";

async function uploadToBucket(listingId: string, route: "builds" | "report", file: File): Promise<string> {
  const signed = await api<{ path: string; token: string }>(`/api/private/marketplace/listings/${listingId}/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upload-url", fileName: file.name, size: file.size }),
  });
  const up = await createSupabaseBrowserClient().storage.from(BUILDS_BUCKET).uploadToSignedUrl(signed.path, signed.token, file, { contentType: file.type || "application/octet-stream" });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  return signed.path;
}

export default function SelfServeFilesPanel({ listingId }: { listingId: string }) {
  const [product, setProduct] = useState<File | null>(null);
  const [report, setReport] = useState<File | null>(null);
  const [busy, setBusy] = useState<"product" | "report" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<{ status: string; reason: string | null; fileName: string } | null>(null);

  const loadCheck = useCallback(async () => {
    try {
      const d = await api<{ check: { status: string; reason: string | null; fileName: string } | null }>(`/api/private/marketplace/listings/${listingId}/report`);
      setCheck(d.check);
    } catch {
      /* status line simply stays empty */
    }
  }, [listingId]);
  useEffect(() => { void loadCheck(); }, [loadCheck]);

  async function sendProduct() {
    if (!product) return;
    const ext = extensionOf(product.name);
    if (BLOCKED_EXTENSIONS.includes(ext)) return setError(`Files of type ${ext} cannot be sold here.`);
    if (!ALLOWED_PRODUCT_EXTENSIONS.includes(ext)) return setError(`Unsupported file type "${ext}". Allowed: ${ALLOWED_PRODUCT_EXTENSIONS.join(" ")}`);
    if (product.size > MAX_BUILD_BYTES) return setError(`The file is larger than ${MAX_BUILD_BYTES / (1024 * 1024)} MB.`);
    setBusy("product");
    setError(null);
    setNotice(null);
    try {
      const path = await uploadToBucket(listingId, "builds", product);
      const r = await api<{ versionId: string }>(`/api/private/marketplace/listings/${listingId}/builds`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize", path }),
      });
      setNotice(`New version ${r.versionId} uploaded. New buyers get it; people who already bought keep working with their version.`);
      setProduct(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  async function sendReport() {
    if (!report) return;
    if (!isAllowedReportFile(report.name)) return setError(`The report must be the MT5 Strategy Tester export (${ALLOWED_REPORT_EXTENSIONS.join(" ")}).`);
    if (report.size > MAX_REPORT_BYTES) return setError(`The report is larger than ${MAX_REPORT_BYTES / (1024 * 1024)} MB - test a shorter period.`);
    setBusy("report");
    setError(null);
    setNotice(null);
    try {
      const path = await uploadToBucket(listingId, "report", report);
      await api(`/api/private/marketplace/listings/${listingId}/report`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "finalize", path, size: report.size }),
      });
      setNotice("Report received. AT24 reads it within a few minutes and adds the \"Checked from the seller's report\" box to your listing.");
      setReport(null);
      await loadCheck();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  const checkText = !check ? null
    : check.status === "DONE" ? `Latest report "${check.fileName}": checked - shown on your listing.`
    : check.status === "FAILED" ? `Latest report "${check.fileName}" could not be used: ${check.reason ?? "unreadable"}`
    : `Latest report "${check.fileName}": waiting to be read (${check.status.toLowerCase()}).`;

  return (
    <div className="mt-4 space-y-4 rounded-control border border-border/60 bg-ink-3 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-3">Product file and backtest report</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="space-y-2">
        <p className="text-sm font-medium text-text">Upload a new version of the product file</p>
        <input type="file" disabled={busy !== null} onChange={(e) => setProduct(e.target.files?.[0] ?? null)} className={FILE_BTN} />
        <Button size="sm" onClick={() => void sendProduct()} loading={busy === "product"} disabled={!product || busy !== null}>Upload new version</Button>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-text">MT5 backtest report</p>
        <input type="file" accept=".xlsx,.html,.htm" disabled={busy !== null} onChange={(e) => setReport(e.target.files?.[0] ?? null)} className={FILE_BTN} />
        <p className="text-xs text-text-3">Strategy Tester &gt; Save as Report (Excel .xlsx or HTML), with the Deals section, up to {MAX_REPORT_BYTES / (1024 * 1024)} MB.</p>
        <Button size="sm" onClick={() => void sendReport()} loading={busy === "report"} disabled={!report || busy !== null}>Attach report</Button>
        {checkText && <p className="text-xs text-text-2">{checkText}</p>}
      </div>
    </div>
  );
}
