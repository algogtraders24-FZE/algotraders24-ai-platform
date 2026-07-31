"use client";
// app/dashboard/admin/audit-logs/page.tsx
// Sprint L2.6 - Phase 7: real, paginated, filterable audit log list. Every
// row is a real AuditLog record written by an admin route.
// Sprint D1.0 - Retrofitted onto Table/Select/Button/Alert + tokens.
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AuditLogEntry } from "@/services/admin/AuditLogService";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import Select from "@/components/ui/Select";
import Button from "@/components/ui/Button";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";

const PAGE_SIZE = 25;
const ACTIONS = [
  "user.role_changed",
  "user.status_changed",
  "subscription.plan_overridden",
  "subscription.canceled",
  "subscription.reactivated",
  "knowledge.deleted",
];

export default function AdminAuditLogsPage() {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listAuditLogs({ page, pageSize: PAGE_SIZE, action: action || undefined });
      setItems(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [page, action]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">Audit Logs ({total})</h2>
        <Select
          value={action}
          onChange={(e) => {
            setPage(1);
            setAction(e.target.value);
          }}
        >
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <Skeleton className="h-40" />
      ) : (
        <Table className="min-w-[720px]">
          <Thead>
            <tr>
              <Th>When</Th>
              <Th>Actor</Th>
              <Th>Action</Th>
              <Th>Target</Th>
              <Th>Details</Th>
            </tr>
          </Thead>
          <Tbody>
            {items.map((entry) => (
              <Tr key={entry.id} className="align-top">
                <Td className="text-text-3">{new Date(entry.createdAt).toLocaleString()}</Td>
                <Td className="font-mono text-xs text-text-3">{entry.actorUserId}</Td>
                <Td className="text-text-2">{entry.action}</Td>
                <Td>
                  {entry.targetType}
                  {entry.targetId ? ` · ${entry.targetId}` : ""}
                </Td>
                <Td className="font-mono text-xs text-text-3">{entry.metadata ? JSON.stringify(entry.metadata) : "-"}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      {!loading && items.length === 0 && <p className="p-6 text-center text-sm text-text-3">No audit log entries found.</p>}

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
