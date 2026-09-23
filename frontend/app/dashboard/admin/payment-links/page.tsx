"use client";
// app/dashboard/admin/payment-links/page.tsx
// Shareable Payment Links - admin management. Generate a shareable
// checkout URL for a marketplace listing (by slug - the human-readable
// identifier visible on the public listing page), see existing links with
// their real usage/status, and revoke one. No listing-search/autocomplete
// UI - out of scope for "small dedicated Payment Links admin page, no
// broader billing redesign" (the locked brief's own wording); an admin
// reads the slug off the listing's public URL.
import { useCallback, useEffect, useState } from "react";
import { AdminApi, type PaymentLinkRow } from "@/services/api/AdminApi";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import Alert from "@/components/ui/Alert";
import EmptyState from "@/components/ui/EmptyState";
import Skeleton from "@/components/ui/Skeleton";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";

const PAGE_SIZE = 20;

function statusTone(status: string): "success" | "danger" | "neutral" {
  if (status === "ACTIVE") return "success";
  if (status === "REVOKED" || status === "EXPIRED") return "danger";
  return "neutral";
}

export default function AdminPaymentLinksPage() {
  const [rows, setRows] = useState<PaymentLinkRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [listingSlug, setListingSlug] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listPaymentLinks({ page, pageSize: PAGE_SIZE });
      setRows(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load payment links");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setCreateError(null);
    setCreatedUrl(null);
    if (!listingSlug.trim()) {
      setCreateError("Listing slug is required.");
      return;
    }
    setCreating(true);
    try {
      const parsedMaxUses = maxUses.trim() ? Number(maxUses) : undefined;
      const result = await AdminApi.createPaymentLink({
        listingSlug: listingSlug.trim(),
        expiresAt: expiresAt || undefined,
        maxUses: parsedMaxUses,
      });
      setCreatedUrl(result.url);
      setListingSlug("");
      setExpiresAt("");
      setMaxUses("");
      await load();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the payment link");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      await AdminApi.revokePaymentLink(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke this link");
    } finally {
      setBusyId(null);
    }
  };

  const copyUrl = async (id: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 2000);
    } catch {
      // best-effort - clipboard permission may be denied
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-3">Generate a link</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-xs text-text-3" htmlFor="pl-slug">
              Listing slug
            </label>
            <Input id="pl-slug" value={listingSlug} onChange={(e) => setListingSlug(e.target.value)} placeholder="pdhpdl-gold" disabled={creating} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-3" htmlFor="pl-expires">
              Expires (optional)
            </label>
            <Input id="pl-expires" type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} disabled={creating} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-text-3" htmlFor="pl-maxuses">
              Max uses (optional)
            </label>
            <Input id="pl-maxuses" type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="Unlimited" disabled={creating} />
          </div>
          <Button onClick={handleCreate} loading={creating}>
            Generate Link
          </Button>
        </div>
        {createError && <Alert tone="danger" className="mt-3">{createError}</Alert>}
        {createdUrl && (
          <Alert tone="success" className="mt-3">
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-control bg-ink px-2 py-1 text-xs text-text">{createdUrl}</code>
              <Button size="sm" variant="secondary" onClick={() => copyUrl("just-created", createdUrl)}>
                {copiedId === "just-created" ? "Copied" : "Copy"}
              </Button>
            </div>
          </Alert>
        )}
      </Card>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No payment links yet." description="Generate one above for a real marketplace listing." />
      ) : (
        <Table>
          <Thead>
            <tr>
              <Th>Listing</Th>
              <Th>Status</Th>
              <Th>Usage</Th>
              <Th>Expires</Th>
              <Th>Created</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="font-medium text-text">{r.listingTitle ?? r.marketplaceListingId}</Td>
                <Td>
                  <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                </Td>
                <Td>
                  {r.usageCount}
                  {r.maxUses !== null ? ` / ${r.maxUses}` : ""}
                </Td>
                <Td>{r.expiresAt ? new Date(r.expiresAt).toLocaleString() : "Never"}</Td>
                <Td>{new Date(r.createdAt).toLocaleDateString()}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => copyUrl(r.id, r.url)}>
                      {copiedId === r.id ? "Copied" : "Copy URL"}
                    </Button>
                    {r.status === "ACTIVE" && (
                      <Button size="sm" variant="danger" onClick={() => handleRevoke(r.id)} loading={busyId === r.id}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}

      {!loading && rows.length > 0 && (
        <div className="flex items-center justify-between text-sm text-text-3">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
