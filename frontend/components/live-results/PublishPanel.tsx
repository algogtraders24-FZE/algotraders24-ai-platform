"use client";
// components/live-results/PublishPanel.tsx
// Owner controls for Live Results pages of ONE synced account (create / edit / link / delete).
// Pages start PRIVATE. The server validates everything again; this is only the form.
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";

interface PageRow {
  id: string;
  accountId: string;
  slug: string;
  title: string;
  description: string;
  visibility: "private" | "unlisted" | "public";
  unlistedKey: string;
  magicFilter: string | null;
  showAmounts: boolean;
  showBroker: boolean;
  positionDelayMin: number;
  listingSlug: string | null;
}
interface AccountInfo {
  id: string;
  broker: string | null;
  magics: { magic: string; trades: number }[];
}

const DELAYS: [number, string][] = [[0, "No delay"], [15, "15 minutes"], [60, "1 hour"], [240, "4 hours"], [1440, "24 hours"]];

function linkOf(p: PageRow): string {
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}/results/${p.slug}${p.visibility === "unlisted" ? `?k=${p.unlistedKey}` : ""}`;
}

/** Copy-paste snippets for a PUBLIC page: a badge image (PNG, works on forums and Telegram) that links back to the page. */
function ShareBox({ page }: { page: PageRow }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const base = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${base}/results/${page.slug}`;
  const img = `${url}/badge`;
  const alt = `${page.title} - Live Results`.replace(/[&<>"]/g, " ");
  const rows: [string, string, string][] = [
    ["link", "Page link", url],
    ["html", "HTML (website, blog)", `<a href="${url}"><img src="${img}" alt="${alt}" width="360"></a>`],
    ["bbcode", "BBCode (forums such as MQL5)", `[url=${url}][img]${img}[/img][/url]`],
    ["md", "Markdown (GitHub, Telegram channels with Markdown)", `[![${alt}](${img})](${url})`],
    ["img", "Badge image only", img],
  ];
  return (
    <div className="space-y-2 rounded-md border border-border p-2.5">
      <p className="text-xs text-text-2">Share a badge that always shows the current live forward record and links to the page. It updates by itself (about every 5 minutes).</p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a plain PNG preview of the shareable badge */}
      <img src={img} alt={alt} width={360} className="max-w-full rounded-lg border border-border" />
      {rows.map(([key, label, text]) => (
        <div key={key} className="space-y-1">
          <p className="text-[11px] uppercase tracking-wide text-text-3">{label}</p>
          <div className="flex gap-2">
            <input readOnly value={text} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-border bg-ink-2 px-2 py-1 text-xs text-text" aria-label={label} />
            <button className="shrink-0 text-xs font-semibold text-gold hover:underline" onClick={() => { void navigator.clipboard.writeText(text); setCopiedKey(key); }}>{copiedKey === key ? "Copied" : "Copy"}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PublishPanel({ accountId }: { accountId: string }) {
  const [pages, setPages] = useState<PageRow[]>([]);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [off, setOff] = useState(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [magic, setMagic] = useState("");
  const [visibility, setVisibility] = useState<PageRow["visibility"]>("private");
  const [showAmounts, setShowAmounts] = useState(false);
  const [showBroker, setShowBroker] = useState(false);
  const [delay, setDelay] = useState(15);
  const [listing, setListing] = useState("");
  const [listings, setListings] = useState<{ slug: string; title: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/private/live-results/pages", { cache: "no-store" });
      if (r.status === 503) {
        setOff(true);
        return;
      }
      const j = await r.json();
      if (!r.ok) return;
      setOff(false);
      setPages((j.data.pages as PageRow[]).filter((p) => p.accountId === accountId));
      setAccount((j.data.accounts as AccountInfo[]).find((a) => a.id === accountId) ?? null);
      setListings((j.data.listings as { slug: string; title: string }[]) ?? []);
    } catch {
      setOff(true);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  function startNew() {
    setEditing(null);
    setTitle("");
    setDescription("");
    setMagic(account && account.magics.length === 1 ? account.magics[0].magic : "");
    setVisibility("private");
    setShowAmounts(false);
    setShowBroker(false);
    setDelay(15);
    setListing("");
    setErr(null);
    setOpen(true);
  }
  function startEdit(p: PageRow) {
    setEditing(p.id);
    setTitle(p.title);
    setDescription(p.description);
    setMagic(p.magicFilter ?? "");
    setVisibility(p.visibility);
    setShowAmounts(p.showAmounts);
    setShowBroker(p.showBroker);
    setDelay(p.positionDelayMin);
    setListing(p.listingSlug ?? "");
    setErr(null);
    setOpen(true);
  }

  async function call(url: string, init: RequestInit, fallback: string): Promise<boolean> {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(url, init);
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.error?.message ?? fallback);
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : fallback);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const body = JSON.stringify({ accountId, title, description, visibility, magicFilter: magic === "" ? null : magic, showAmounts, showBroker, positionDelayMin: delay, listingSlug: listing === "" ? null : listing });
    const url = editing ? `/api/private/live-results/pages?id=${encodeURIComponent(editing)}` : "/api/private/live-results/pages";
    if (await call(url, { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body }, "Could not save the page")) {
      setOpen(false);
      await load();
    }
  }

  if (off) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text">Live Results page</p>
        {!open && <Button size="sm" variant="secondary" onClick={startNew}>{pages.length ? "Add another page" : "Create results page"}</Button>}
      </div>
      {pages.length === 0 && !open && <p className="text-xs text-text-3">Share this account&apos;s results as a page. It starts private; you choose who can see it and whether amounts are shown.</p>}

      {pages.map((p) => (
        <div key={p.id} className="space-y-1.5 rounded-md bg-white/[0.03] p-2.5 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-text">
              {p.title} <Badge tone={p.visibility === "public" ? "warning" : "neutral"} className="normal-case">{p.visibility}</Badge>{" "}
              <span className="text-xs text-text-3">{p.listingSlug ? `on listing ${p.listingSlug} · ` : ""}{p.magicFilter ? `EA magic ${p.magicFilter}` : "whole account"} · {p.showAmounts ? "amounts shown" : "percent only"} · positions delayed {p.positionDelayMin} min</span>
            </p>
            <div className="flex gap-2">
              <a className="text-xs font-semibold text-gold hover:underline" href={linkOf(p)} target="_blank" rel="noreferrer">Open</a>
              <a className="text-xs font-semibold text-gold hover:underline" href={`/api/private/live-results/export?pageId=${encodeURIComponent(p.id)}`}>My trades CSV</a>
              {p.visibility !== "private" && (
                <button className="text-xs font-semibold text-gold hover:underline" onClick={() => { void navigator.clipboard.writeText(linkOf(p)); setCopied(p.id); }}>{copied === p.id ? "Copied" : "Copy link"}</button>
              )}
              {p.visibility === "public" && (<button className="text-xs font-semibold text-gold hover:underline" onClick={() => setShareFor(shareFor === p.id ? null : p.id)}>{shareFor === p.id ? "Hide badge" : "Share badge"}</button>)}
              <button className="text-xs font-semibold text-text-2 hover:underline" onClick={() => startEdit(p)}>Edit</button>
              {p.visibility === "unlisted" && (
                <button className="text-xs font-semibold text-text-2 hover:underline" disabled={busy} onClick={async () => { if (await call(`/api/private/live-results/pages?id=${encodeURIComponent(p.id)}&rotate=1`, { method: "PATCH" }, "Could not change the link")) await load(); }}>New link</button>
              )}
              <button className="text-xs font-semibold text-red-400 hover:underline" disabled={busy} onClick={async () => { if (window.confirm("Delete this results page? The link stops working.") && (await call(`/api/private/live-results/pages?id=${encodeURIComponent(p.id)}`, { method: "DELETE" }, "Could not delete"))) await load(); }}>Delete</button>
            </div>
          </div>
          {shareFor === p.id && p.visibility === "public" && <ShareBox page={p} />}
        </div>
      ))}

      {open && (
        <div className="space-y-3 rounded-md border border-border p-3">
          <label className="block space-y-1 text-xs text-text-2">Title
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. XXXUS30 - Live Forward Test (Demo)" aria-label="Page title" />
          </label>
          <label className="block space-y-1 text-xs text-text-2">Short description (optional)
            <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={400} placeholder="What does this EA do?" aria-label="Description" />
          </label>
          <label className="block space-y-1 text-xs text-text-2">What to show
            <select className="w-full rounded-md border border-border bg-ink-2 px-3 py-2 text-sm text-text" value={magic} onChange={(e) => setMagic(e.target.value)}>
              <option value="">Whole account (all EAs and manual trades)</option>
              {(account?.magics ?? []).map((m) => <option key={m.magic} value={m.magic}>{`One EA: magic ${m.magic} (${m.trades} trades)`}</option>)}
            </select>
          </label>
          <label className="block space-y-1 text-xs text-text-2">Who can see it
            <select className="w-full rounded-md border border-border bg-ink-2 px-3 py-2 text-sm text-text" value={visibility} onChange={(e) => setVisibility(e.target.value as PageRow["visibility"])}>
              <option value="private">Private - only me</option>
              <option value="unlisted">Anyone with the secret link</option>
              <option value="public">Public - anyone with the page address</option>
            </select>
          </label>
          <label className="block space-y-1 text-xs text-text-2">Open positions are shown after
            <select className="w-full rounded-md border border-border bg-ink-2 px-3 py-2 text-sm text-text" value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
              {DELAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {listings.length > 0 && (
            <label className="block space-y-1 text-xs text-text-2">Show on a marketplace listing (only works when the page is Public)
              <select className="w-full rounded-md border border-border bg-ink-2 px-3 py-2 text-sm text-text" value={listing} onChange={(e) => setListing(e.target.value)}>
                <option value="">Not on any listing</option>
                {listings.map((l) => <option key={l.slug} value={l.slug}>{l.title}</option>)}
              </select>
            </label>
          )}
          <label className="flex items-start gap-2 text-xs text-text-2">
            <input type="checkbox" className="mt-0.5" checked={showAmounts} onChange={(e) => setShowAmounts(e.target.checked)} />
            <span>Show money amounts and lot sizes. Leave this off to show percentages only (recommended).</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-text-2">
            <input type="checkbox" className="mt-0.5" checked={showBroker} disabled={!account?.broker} onChange={(e) => setShowBroker(e.target.checked)} />
            <span>
              Show my broker name{account?.broker ? <> (<b className="text-text">{account.broker}</b>, as reported by your terminal, not verified)</> : ": your EA is not sending it. In the EA inputs set ShareBrokerName = true (needs the v1.1 EA) and wait for the next sync."}
            </span>
          </label>
          {visibility === "public" && <Alert tone="warning">Public means anyone who has the page address can see these results. The page always says the data is terminal-reported and not independently verified.</Alert>}
          {err && <Alert tone="danger">{err}</Alert>}
          <div className="flex gap-2">
            <Button size="sm" onClick={save} loading={busy} disabled={title.trim().length < 2}>{editing ? "Save changes" : "Create page"}</Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {!open && err && <Alert tone="danger">{err}</Alert>}
    </div>
  );
}
