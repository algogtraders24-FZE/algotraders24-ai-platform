// components/marketplace/MarketplacePagination.tsx
// Sprint M8 - Same prev/next + "page X of Y" pattern as
// app/dashboard/admin/users/page.tsx, the one real pagination precedent in
// this codebase.
import Button from "@/components/ui/Button";

export default function MarketplacePagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between text-sm text-text-3">
      <span>
        Page {page} of {totalPages} ({total} listing{total === 1 ? "" : "s"})
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
          Next
        </Button>
      </div>
    </div>
  );
}
