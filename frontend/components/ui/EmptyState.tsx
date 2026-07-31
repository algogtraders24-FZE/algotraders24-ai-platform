// components/ui/EmptyState.tsx
// Sprint D1.0 - Formalizes the "meaningful empty state" pattern R1.1
// established ad hoc per-page (Knowledge, Market Intelligence, Orders,
// Licenses, Billing invoices) into one reusable primitive, so every empty
// state gets the same dashed-border treatment and the same title/
// description/action shape instead of a slightly different one per page.
import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function EmptyState({ title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={["rounded-card border border-dashed border-border p-10 text-center", className].filter(Boolean).join(" ")}>
      <p className="text-sm font-medium text-text">{title}</p>
      {description && <p className="mt-1 text-xs text-text-3">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
