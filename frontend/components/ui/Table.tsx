// components/ui/Table.tsx
// Sprint D1.0 - One table shell (Invoice History, Audit Logs, Users,
// Feedback all hand-rolled their own header/row/border classes with small
// drifts - border-white/10 vs border-slate-800, text-slate-500 vs
// text-gray-500 for the same "column header" role). Thin wrappers around
// the real <table> elements - no virtualization/sorting logic, just shared
// visual contract.
import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";

export function Table({ className = "", children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-card border border-border bg-ink-2">
      <table className={["w-full text-sm", className].filter(Boolean).join(" ")} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Thead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-text-3">{children}</thead>;
}

export function Th({ className = "", children, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={["px-4 py-3 font-medium", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </th>
  );
}

export function Tbody({ children }: { children: React.ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function Tr({ className = "", children, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={["border-b border-border/60 transition last:border-0 hover:bg-ink-3/60", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </tr>
  );
}

export function Td({ className = "", children, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={["px-4 py-3 text-text-2", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </td>
  );
}
