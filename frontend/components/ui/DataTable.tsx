"use client";
// components/ui/DataTable.tsx
// Sprint UI-01 - AT24 Premium UI Foundation. A column-defined table over the
// existing Table/Thead/Th/Tbody/Tr/Td primitives (components/ui/Table.tsx) -
// those stay the shared visual contract; this adds column config, optional
// client-side sort, and the three states every real data table needs
// (loading/error/empty) so pages stop hand-rolling that branch each time.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Table, Thead, Tbody, Th, Tr, Td } from "./Table";
import EmptyState, { type EmptyStateProps } from "./EmptyState";
import ErrorState, { type ErrorStateProps } from "./ErrorState";
import LoadingState from "./LoadingState";

export interface DataTableColumn<T> {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  /** Present => column header is clickable and sorts by this value. */
  sortValue?: (row: T) => string | number;
  className?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  loading?: boolean;
  error?: ErrorStateProps;
  empty?: EmptyStateProps;
  onRowClick?: (row: T) => void;
  className?: string;
}

const ALIGN_CLASS: Record<NonNullable<DataTableColumn<unknown>["align"]>, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

export default function DataTable<T>({
  columns,
  rows,
  getRowKey,
  loading = false,
  error,
  empty,
  onRowClick,
  className = "",
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sortedRows = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const sorted = [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av < bv) return -1;
      if (av > bv) return 1;
      return 0;
    });
    return sortDir === "asc" ? sorted : sorted.reverse();
  }, [rows, columns, sortKey, sortDir]);

  const toggleSort = (col: DataTableColumn<T>) => {
    if (!col.sortValue) return;
    if (sortKey !== col.key) {
      setSortKey(col.key);
      setSortDir("asc");
    } else {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  };

  if (loading) return <LoadingState variant="table" className={className} />;
  if (error) return <ErrorState {...error} />;
  if (rows.length === 0) return <EmptyState {...(empty ?? { title: "Nothing here yet." })} />;

  return (
    <Table className={className}>
      <Thead>
        <tr>
          {columns.map((col) => (
            <Th
              key={col.key}
              className={[ALIGN_CLASS[col.align ?? "left"], col.sortValue ? "cursor-pointer select-none hover:text-text-2" : "", col.className]
                .filter(Boolean)
                .join(" ")}
              onClick={() => toggleSort(col)}
              aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
            >
              <span className="inline-flex items-center gap-1">
                {col.header}
                {col.sortValue && sortKey === col.key && <span aria-hidden="true">{sortDir === "asc" ? "▲" : "▼"}</span>}
              </span>
            </Th>
          ))}
        </tr>
      </Thead>
      <Tbody>
        {sortedRows.map((row) => (
          <Tr key={getRowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={onRowClick ? "cursor-pointer" : ""}>
            {columns.map((col) => (
              <Td key={col.key} className={ALIGN_CLASS[col.align ?? "left"]}>
                {col.render(row)}
              </Td>
            ))}
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
