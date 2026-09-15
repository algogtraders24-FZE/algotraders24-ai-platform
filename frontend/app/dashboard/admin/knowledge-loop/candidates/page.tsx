"use client";
// app/dashboard/admin/knowledge-loop/candidates/page.tsx
// Sprint K4.2-C Phase 1 - the candidate review queue. Every row is a real
// KnowledgeCandidate; "Review" opens the detail page where an admin
// approves/rejects (GovernanceService.approve/reject, K4.2-B).
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AdminApi, type AdminCandidateRow } from "@/services/api/AdminApi";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";
import Badge from "@/components/ui/Badge";

const PAGE_SIZE = 20;
const STATUSES = ["candidate", "under_review", "approved", "rejected", "duplicate", "superseded"];

function statusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (status === "approved") return "success";
  if (status === "rejected" || status === "duplicate" || status === "superseded") return "danger";
  if (status === "under_review") return "warning";
  return "neutral";
}

export default function AdminGovernanceCandidatesPage() {
  const [items, setItems] = useState<AdminCandidateRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("candidate");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listGovernanceCandidates({ page, pageSize: PAGE_SIZE, status: status || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text">Knowledge Candidates ({total})</h2>
          <p className="text-sm text-text-3">
            Proposed by the AI Assistant / admins for review. Never retrievable until approved.{" "}
            <Link href="/dashboard/admin/knowledge-loop/knowledge" className="text-gold hover:underline">
              View active Knowledge →
            </Link>
          </p>
        </div>
        <Select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All statuses</option>
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
              <Th>Question</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Confidence</Th>
              <Th>Created</Th>
              <Th />
            </tr>
          </Thead>
          <Tbody>
            {items.map((c) => (
              <Tr key={c.id} className="align-top">
                <Td className="max-w-[360px] truncate text-text-2">{c.canonicalQuestion}</Td>
                <Td className="text-text-3">{c.reasonForCandidate}</Td>
                <Td>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  {c.duplicateOfId && <span className="ml-1 text-xs text-text-3">(dup: {c.similarityScore?.toFixed(2)})</span>}
                </Td>
                <Td className="text-text-3">{c.confidence.toFixed(2)}</Td>
                <Td className="text-text-3">{new Date(c.createdAt).toLocaleString()}</Td>
                <Td>
                  <Link href={`/dashboard/admin/knowledge-loop/candidates/${c.id}`}>
                    <Button size="sm" variant="secondary">
                      Review
                    </Button>
                  </Link>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      {!loading && items.length === 0 && <p className="p-6 text-center text-sm text-text-3">No candidates found.</p>}

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
