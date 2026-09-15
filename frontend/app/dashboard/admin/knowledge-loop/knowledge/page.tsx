"use client";
// app/dashboard/admin/knowledge-loop/knowledge/page.tsx
// Sprint K4.2-C Phase 1 - active/deprecated loop Knowledge. "Deprecate"
// calls GovernanceService.deprecate() (K4.2-B, unmodified). Distinct from
// /dashboard/admin/knowledge (Sprint L2.6, unrelated legacy surface).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminApi, type AdminGovernanceKnowledgeRow } from "@/services/api/AdminApi";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";
import Badge from "@/components/ui/Badge";

const PAGE_SIZE = 20;
const STATUSES = ["active", "deprecated", "archived"];

function statusTone(status: string | null): "success" | "warning" | "neutral" {
  if (status === "active") return "success";
  if (status === "deprecated") return "warning";
  return "neutral";
}

export default function AdminGovernanceKnowledgePage() {
  const [items, setItems] = useState<AdminGovernanceKnowledgeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [lifecycleStatus, setLifecycleStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listGovernanceKnowledge({ page, pageSize: PAGE_SIZE, lifecycleStatus: lifecycleStatus || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load knowledge");
    } finally {
      setLoading(false);
    }
  }, [page, lifecycleStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDeprecate = async (id: string) => {
    const reason = window.prompt("Reason for deprecation (optional):") ?? undefined;
    setBusyId(id);
    setError(null);
    try {
      await AdminApi.deprecateGovernanceKnowledge(id, reason || undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deprecate failed");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Knowledge Loop — Knowledge ({total})</h2>
          <p className="text-sm text-text-3">
            Rows promoted through governance approval.{" "}
            <Link href="/dashboard/admin/knowledge-loop/candidates" className="text-gold hover:underline">
              ← Candidate queue
            </Link>
          </p>
        </div>
        <Select
          value={lifecycleStatus}
          onChange={(e) => {
            setPage(1);
            setLifecycleStatus(e.target.value);
          }}
        >
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <Skeleton className="h-40" />
      ) : (
        <Table className="min-w-[820px]">
          <Thead>
            <tr>
              <Th>Title</Th>
              <Th>Scope</Th>
              <Th>Status</Th>
              <Th>Version</Th>
              <Th>Retrievals</Th>
              <Th>Approved</Th>
              <Th />
            </tr>
          </Thead>
          <Tbody>
            {items.map((k) => (
              <Tr key={k.id} className="align-top">
                <Td className="max-w-[320px] truncate text-text-2">{k.title}</Td>
                <Td className="text-text-3">{k.scope}</Td>
                <Td>
                  <Badge tone={statusTone(k.lifecycleStatus)}>{k.lifecycleStatus ?? "—"}</Badge>
                </Td>
                <Td className="text-text-3">v{k.version}</Td>
                <Td className="text-text-3">{k.retrievalCount}</Td>
                <Td className="text-text-3">{k.approvedAt ? new Date(k.approvedAt).toLocaleDateString() : "—"}</Td>
                <Td>
                  {k.lifecycleStatus === "active" && (
                    <Button size="sm" variant="danger" onClick={() => onDeprecate(k.id)} disabled={busyId === k.id}>
                      Deprecate
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      {!loading && items.length === 0 && <p className="p-6 text-center text-sm text-text-3">No knowledge rows found.</p>}

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
    </div>
  );
}
