"use client";
// app/marketplace/sell/SellClient.tsx
// Sprint M9 - Draft-creation form. POSTs to the new
// POST /api/private/marketplace/listings endpoint (services/marketplace/
// factory's evaluateListingMutation guard runs server-side on this exact
// body - this form cannot set trustState/evidenceId/etc, it doesn't even
// offer inputs for them). tradingSystemId/versionId are optional and
// separate from the guarded fields (see that route's own comment on why) -
// left blank for a seller with no existing AT24-tracked system yet.
import { useState } from "react";
import { useRouter } from "next/navigation";
import Alert from "@/components/ui/Alert";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import { PLATFORM_FILTERS, ASSET_FILTERS, STRATEGY_FILTERS } from "@/types/marketplace";

export default function SellClient() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [platformTag, setPlatformTag] = useState<string>(PLATFORM_FILTERS[0]);
  const [assetTag, setAssetTag] = useState<string>(ASSET_FILTERS[0]);
  const [category, setCategory] = useState<string>(STRATEGY_FILTERS[0]);
  const [tradingSystemId, setTradingSystemId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !description.trim()) {
      setError("Title and description are both required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/private/marketplace/listings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          platformTag,
          assetTag,
          category,
          ...(tradingSystemId.trim() && versionId.trim() ? { tradingSystemId: tradingSystemId.trim(), versionId: versionId.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok || body.status !== "ok") {
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }
      router.push("/marketplace/my-products");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong creating this draft.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-card border border-border bg-ink-2 p-6">
      {error && <Alert tone="danger">{error}</Alert>}

      <div>
        <label htmlFor="title" className="mb-1.5 block text-sm font-medium text-text">
          Title
        </label>
        <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Gold Liquidity Sweep EA" required />
      </div>

      <div>
        <label htmlFor="description" className="mb-1.5 block text-sm font-medium text-text">
          Description
        </label>
        <Textarea id="description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Describe your trading system. This is your own text - it is never treated as a verified fact." required />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="platformTag" className="mb-1.5 block text-sm font-medium text-text">Platform</label>
          <Select id="platformTag" value={platformTag} onChange={(e) => setPlatformTag(e.target.value)} className="w-full">
            {PLATFORM_FILTERS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="assetTag" className="mb-1.5 block text-sm font-medium text-text">Asset</label>
          <Select id="assetTag" value={assetTag} onChange={(e) => setAssetTag(e.target.value)} className="w-full">
            {ASSET_FILTERS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-text">Category</label>
          <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)} className="w-full">
            {STRATEGY_FILTERS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>
        </div>
      </div>

      <details className="rounded-control border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium text-text-2">Advanced: link to an existing AT24-tracked system</summary>
        <p className="mt-2 text-xs text-text-3">
          Only fill these in if AT24 has already independently generated Evidence for a specific TradingSystem/Version of
          yours. Leave both blank otherwise - you can request AT24 evidence ingestion later.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="tradingSystemId" className="mb-1.5 block text-sm font-medium text-text">TradingSystem ID</label>
            <Input id="tradingSystemId" value={tradingSystemId} onChange={(e) => setTradingSystemId(e.target.value)} placeholder="e.g. G01" />
          </div>
          <div>
            <label htmlFor="versionId" className="mb-1.5 block text-sm font-medium text-text">Version ID</label>
            <Input id="versionId" value={versionId} onChange={(e) => setVersionId(e.target.value)} placeholder="e.g. G01-v0.1-FROZEN-BASELINE" />
          </div>
        </div>
      </details>

      <Button type="submit" loading={submitting} fullWidth>
        Save draft
      </Button>
    </form>
  );
}
