"use client";
// app/dashboard/admin/users/page.tsx
// Sprint L2.6 - Phase 2: User Management. Real, paginated user list with
// real role/status mutations (both audit-logged server-side).
// Sprint D1.0 - Retrofitted onto Table/Badge/Button/Input/Alert + tokens.
import { useCallback, useEffect, useState } from "react";
import { AdminApi } from "@/services/api/AdminApi";
import type { AdminUserSummary } from "@/services/admin/AdminUserService";
import { Table, Thead, Th, Tbody, Tr, Td } from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Alert from "@/components/ui/Alert";
import Skeleton from "@/components/ui/Skeleton";

const PAGE_SIZE = 20;

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminApi.listUsers({ page, pageSize: PAGE_SIZE, q: query || undefined });
      setUsers(result.items);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRole = async (u: AdminUserSummary) => {
    setBusyId(u.id);
    try {
      await AdminApi.setUserRole(u.id, u.role === "admin" ? "user" : "admin");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change role");
    } finally {
      setBusyId(null);
    }
  };

  const toggleStatus = async (u: AdminUserSummary) => {
    setBusyId(u.id);
    try {
      await AdminApi.setUserStatus(u.id, u.status === "active" ? "suspended" : "active");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to change status");
    } finally {
      setBusyId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-text">Users ({total})</h2>
        <Input
          value={query}
          onChange={(e) => {
            setPage(1);
            setQuery(e.target.value);
          }}
          placeholder="Search by name or email..."
          className="w-64"
        />
      </div>

      {error && <Alert tone="danger">{error}</Alert>}

      {loading ? (
        <Skeleton className="h-40" />
      ) : (
        <Table className="min-w-[720px]">
          <Thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Plan</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Joined</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </Thead>
          <Tbody>
            {users.map((u) => (
              <Tr key={u.id}>
                <Td className="text-text">{u.name}</Td>
                <Td>{u.email}</Td>
                <Td>{u.planId}</Td>
                <Td>
                  <Badge tone={u.role === "admin" ? "gold" : "neutral"}>{u.role}</Badge>
                </Td>
                <Td>
                  <Badge tone={u.status === "active" ? "success" : "danger"}>{u.status}</Badge>
                </Td>
                <Td className="text-text-3">{new Date(u.createdAt).toLocaleDateString()}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="secondary" onClick={() => toggleRole(u)} disabled={busyId === u.id}>
                      {u.role === "admin" ? "Revoke admin" : "Make admin"}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => toggleStatus(u)} disabled={busyId === u.id}>
                      {u.status === "active" ? "Suspend" : "Activate"}
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      {!loading && users.length === 0 && <p className="p-6 text-center text-sm text-text-3">No users found.</p>}

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
