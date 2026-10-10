"use client";
// app/marketplace/sell/SelfServeSellClient.tsx
// Seller self-serve (Phase 1): ONE page, MQL5-Market style. Product file + details + logo/banner + price -> Publish.
// Behind the SELLER_SELF_SERVE_MODE flag (see lib/marketplace/selfServe.ts); the evidence-based form (SellClient) stays
// for everyone else. The page runs a small resumable sequence so a failure on step N can be retried without redoing 1..N-1.
import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { PLATFORM_FILTERS, ASSET_FILTERS, STRATEGY_FILTERS } from "@/types/marketplace";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ALLOWED_REPORT_EXTENSIONS, MAX_REPORT_BYTES, isAllowedReportFile } from "@/lib/marketplace/reportCheck";
import { ALLOWED_PRODUCT_EXTENSIONS, BLOCKED_EXTENSIONS, BUILDS_BUCKET, MAX_BUILD_BYTES, MIN_DESCRIPTION_CHARS, extensionOf } from "@/lib/marketplace/selfServe";

type StepKey = "draft" | "icon" | "banner" | "details" | "file" | "report" | "publish";
const STEP_LABEL: Record<StepKey, string> = {
  draft: "Creating your listing",
  icon: "Uploading the logo",
  banner: "Uploading the banner",
  details: "Saving details and price",
  file: "Uploading your product file",
  report: "Attaching your backtest report",
  publish: "Publishing",
};

async function api<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.status !== "ok") throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
  return body.data as T;
}

export default function SelfServeSellClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [platformTag, setPlatformTag] = useState<string>(PLATFORM_FILTERS[0]);
  const [assetTag, setAssetTag] = useState<string>(ASSET_FILTERS[0]);
  const [category, setCategory] = useState<string>(STRATEGY_FILTERS[0]);
  const [price, setPrice] = useState("");
  const [icon, setIcon] = useState<File | null>(null);
  const [banner, setBanner] = useState<File | null>(null);
  const [product, setProduct] = useState<File | null>(null);
  const [report, setReport] = useState<File | null>(null);
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<StepKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  // resumable state
  const listingId = useRef<string | null>(null);
  const slug = useRef<string | null>(null);
  const done = useRef<Set<StepKey>>(new Set());
  const mediaUrls = useRef<{ icon?: string; banner?: string }>({});

  function validateLocal(): string | null {
    if (!title.trim()) return "Please enter a title.";
    if (description.trim().length < MIN_DESCRIPTION_CHARS) return `The description needs at least ${MIN_DESCRIPTION_CHARS} characters.`;
    const amount = Number(price);
    if (!(amount > 0)) return "Please enter a price in USD.";
    if (!icon) return "Please add a logo (exactly 200x200 px: SVG, PNG, JPEG or WebP).";
    if (!product) return "Please choose your product file.";
    const ext = extensionOf(product.name);
    if (BLOCKED_EXTENSIONS.includes(ext)) return `Files of type ${ext} cannot be sold here.`;
    if (!ALLOWED_PRODUCT_EXTENSIONS.includes(ext)) return `Unsupported product file type "${ext}". Allowed: ${ALLOWED_PRODUCT_EXTENSIONS.join(" ")}`;
    if (product.size > MAX_BUILD_BYTES) return `The product file is larger than ${MAX_BUILD_BYTES / (1024 * 1024)} MB.`;
    if (report) {
      if (!isAllowedReportFile(report.name)) return `The backtest report must be the MT5 Strategy Tester export (${ALLOWED_REPORT_EXTENSIONS.join(" ")}).`;
      if (report.size > MAX_REPORT_BYTES) return `The report is larger than ${MAX_REPORT_BYTES / (1024 * 1024)} MB - test a shorter period.`;
    }
    if (!accept) return "Please accept the seller terms.";
    return null;
  }

  async function uploadMedia(file: File, kind: "icon" | "banner"): Promise<string> {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    const data = await api<{ url: string }>(`/api/private/marketplace/listings/${listingId.current}/media`, { method: "POST", body: form });
    return data.url;
  }

  async function run() {
    const problem = validateLocal();
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    let step: StepKey = "draft";
    try {
      step = "draft";
      if (!done.current.has("draft")) {
        setCurrent("draft");
        const created = await api<{ id: string; slug: string }>("/api/private/marketplace/listings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim(), description: description.trim(), platformTag, assetTag, category }),
        });
        listingId.current = created.id;
        slug.current = created.slug;
        done.current.add("draft");
      }
      step = "icon";
      if (!done.current.has("icon")) {
        setCurrent("icon");
        mediaUrls.current.icon = await uploadMedia(icon!, "icon");
        done.current.add("icon");
      }
      step = "banner";
      if (!done.current.has("banner")) {
        setCurrent("banner");
        if (banner) mediaUrls.current.banner = await uploadMedia(banner, "banner");
        done.current.add("banner");
      }
      step = "details";
      if (!done.current.has("details")) {
        setCurrent("details");
        const media = [mediaUrls.current.icon!, ...(mediaUrls.current.banner ? [mediaUrls.current.banner] : [])];
        await api(`/api/private/marketplace/listings/${listingId.current}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ media, pricing: { model: "one_time", amount: Number(price), currency: "USD" } }),
        });
        done.current.add("details");
      }
      step = "file";
      if (!done.current.has("file")) {
        setCurrent("file");
        const signed = await api<{ path: string; token: string }>(`/api/private/marketplace/listings/${listingId.current}/builds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "upload-url", fileName: product!.name, size: product!.size }),
        });
        const supabase = createSupabaseBrowserClient();
        const up = await supabase.storage.from(BUILDS_BUCKET).uploadToSignedUrl(signed.path, signed.token, product!, { contentType: product!.type || "application/octet-stream" });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
        await api(`/api/private/marketplace/listings/${listingId.current}/builds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "finalize", path: signed.path }),
        });
        done.current.add("file");
      }
      step = "report";
      if (!done.current.has("report")) {
        setCurrent("report");
        if (report) {
          const signed = await api<{ path: string; token: string }>(`/api/private/marketplace/listings/${listingId.current}/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "upload-url", fileName: report.name, size: report.size }),
          });
          const supabase = createSupabaseBrowserClient();
          const up = await supabase.storage.from(BUILDS_BUCKET).uploadToSignedUrl(signed.path, signed.token, report, { contentType: report.type || "application/octet-stream" });
          if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
          await api(`/api/private/marketplace/listings/${listingId.current}/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "finalize", path: signed.path, size: report.size }),
          });
        }
        done.current.add("report");
      }
      step = "publish";
      setCurrent("publish");
      await api(`/api/private/marketplace/listings/${listingId.current}/publish-self-serve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acceptTerms: accept }),
      });
      router.push(`/marketplace/${slug.current}`);
    } catch (err) {
      setError(`${STEP_LABEL[step]} failed: ${err instanceof Error ? err.message : "something went wrong"}. Fix it and press Publish again - finished steps are not repeated.`);
      setBusy(false);
      setCurrent(null);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
      className="space-y-6 rounded-card border border-border bg-ink-2 p-6"
    >
      {error && <Alert tone="danger">{error}</Alert>}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text">1. Your product</h2>
        <div>
          <label htmlFor="ss-file" className="mb-1.5 block text-sm font-medium text-text">Product file</label>
          <input id="ss-file" type="file" disabled={busy} onChange={(e) => setProduct(e.target.files?.[0] ?? null)} className="block w-full text-sm text-text-2 file:mr-3 file:rounded-control file:border-0 file:bg-gold file:px-4 file:py-2 file:font-semibold file:text-ink" />
          <p className="mt-1 text-xs text-text-3">.ex5 / .ex4 / .zip (and .mq5 .mq4 .pine .cs .py .set .tpl .pdf), up to {MAX_BUILD_BYTES / (1024 * 1024)} MB. Put several files in one .zip. No .dll / .exe / scripts.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="ss-platform" className="mb-1.5 block text-sm font-medium text-text">Platform</label>
            <Select id="ss-platform" value={platformTag} disabled={busy} onChange={(e) => setPlatformTag(e.target.value)} className="w-full">
              {PLATFORM_FILTERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="ss-asset" className="mb-1.5 block text-sm font-medium text-text">Asset</label>
            <Select id="ss-asset" value={assetTag} disabled={busy} onChange={(e) => setAssetTag(e.target.value)} className="w-full">
              {ASSET_FILTERS.map((a) => <option key={a} value={a}>{a}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="ss-category" className="mb-1.5 block text-sm font-medium text-text">Style</label>
            <Select id="ss-category" value={category} disabled={busy} onChange={(e) => setCategory(e.target.value)} className="w-full">
              {STRATEGY_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <label htmlFor="ss-report" className="mb-1.5 block text-sm font-medium text-text">Backtest report (optional)</label>
          <input id="ss-report" type="file" accept=".xlsx,.html,.htm" disabled={busy} onChange={(e) => setReport(e.target.files?.[0] ?? null)} className="block w-full text-sm text-text-2 file:mr-3 file:rounded-control file:border file:border-gold file:bg-transparent file:px-4 file:py-2 file:font-semibold file:text-gold" />
          <p className="mt-1 text-xs text-text-3">The MT5 Strategy Tester report (Save as Report: Excel .xlsx or HTML), up to {MAX_REPORT_BYTES / (1024 * 1024)} MB, with the Deals section. AT24 reads it automatically after you publish and shows its figures on your listing as &quot;Checked from the seller&apos;s report&quot;. No report? The listing simply stays &quot;Not checked&quot;.</p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-text">2. Listing</h2>
        <div>
          <label htmlFor="ss-title" className="mb-1.5 block text-sm font-medium text-text">Title</label>
          <Input id="ss-title" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gold Liquidity Sweep EA" />
        </div>
        <div>
          <label htmlFor="ss-desc" className="mb-1.5 block text-sm font-medium text-text">Description</label>
          <Textarea id="ss-desc" rows={6} value={description} disabled={busy} onChange={(e) => setDescription(e.target.value)} placeholder="What it does, which symbols/timeframes, how to set it up, what to expect. This is your own text - it is shown as the seller's claim, not as a verified fact." />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="ss-icon" className="mb-1.5 block text-sm font-medium text-text">Logo (200x200)</label>
            <input id="ss-icon" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => setIcon(e.target.files?.[0] ?? null)} className="block w-full text-sm text-text-2 file:mr-3 file:rounded-control file:border-0 file:bg-gold file:px-4 file:py-2 file:font-semibold file:text-ink" />
          </div>
          <div>
            <label htmlFor="ss-banner" className="mb-1.5 block text-sm font-medium text-text">Banner (optional)</label>
            <input id="ss-banner" type="file" accept="image/svg+xml,image/png,image/jpeg,image/webp" disabled={busy} onChange={(e) => setBanner(e.target.files?.[0] ?? null)} className="block w-full text-sm text-text-2 file:mr-3 file:rounded-control file:border file:border-gold file:bg-transparent file:px-4 file:py-2 file:font-semibold file:text-gold" />
          </div>
          <div>
            <label htmlFor="ss-price" className="mb-1.5 block text-sm font-medium text-text">Price (USD)</label>
            <Input id="ss-price" type="number" min="1" step="1" value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} placeholder="99" />
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded-control border border-border p-4 text-sm text-text-2">
        <h2 className="text-lg font-semibold text-text">Real-time proof (optional, after publishing)</h2>
        <p>
          Buyers trust live numbers most. Run your product on a demo or live account, connect that MetaTrader 5 terminal with the free AT24 Live Sync EA,
          publish the results page as Public and pick this listing in the &quot;Show on a marketplace listing&quot; box. Your page then shows the real,
          ongoing record next to your report. Set it up any time at{" "}
          <Link href="/dashboard/live-sync" className="font-semibold text-gold hover:underline">Dashboard → Live Sync</Link>.
        </p>
      </section>

      <section className="space-y-2 rounded-control border border-border p-4 text-sm text-text-2">
        <h2 className="text-lg font-semibold text-text">3. What buyers will see</h2>
        <p>
          Your listing goes live right away with the label <strong className="text-text">Not checked</strong>: AT24 has not tested it, and your
          description is shown as your own claim. If you attached a backtest report, AT24 reads it within minutes and adds a &quot;Checked from the
          seller&apos;s report&quot; box to your page (it confirms the report&apos;s numbers agree with each other; it is not the independent Validated badge). Want a stronger listing? Attach your demo or live account later (free Live Sync EA) to show real,
          ongoing results on your listing page.
        </p>
        <label className="mt-2 flex items-start gap-2 text-text">
          <input type="checkbox" checked={accept} disabled={busy} onChange={(e) => setAccept(e.target.checked)} className="mt-1" />
          <span>
            I own this product or have the right to sell it, it contains no malware or hidden code, and my description is truthful. I understand AT24 does
            not check it, may remove it at any time, and that AT24 keeps a 10% commission plus the payment-gateway fee on each sale; each sale is held for 7 days, then paid out in USDT
            on request (minimum 50 USD, see Dashboard → Earnings).
          </span>
        </label>
      </section>

      {busy && current && <p className="text-sm text-gold">{STEP_LABEL[current]}...</p>}
      <Button type="submit" loading={busy} fullWidth>
        Publish
      </Button>
    </form>
  );
}
