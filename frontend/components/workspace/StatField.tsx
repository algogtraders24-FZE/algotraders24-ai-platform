// components/workspace/StatField.tsx
// Sprint D2.3 (Phase 8) - Design System Standardization. The one label+value
// micro-pattern for the workspace, replacing four near-identical hand-rolled
// versions (WorkspaceHeader's `Field`, IntelligencePanel's `StatCard`, and its
// two inline grid-cell blocks) that had drifted into three different paddings.
// `bare` renders the label-over-value pair with no border/background (for
// inline baseline placement, e.g. the workspace header strip). `dashed` swaps
// to a dashed border for values the current engine hasn't computed yet (Key
// Levels), signalling "not available" without a different shape.
import type { ReactNode } from "react";

export interface StatFieldProps {
  /** Sprint D2.3.S4 - widened from string to ReactNode so a label can carry an inline InfoTooltip (e.g. an educational-term definition); every existing string caller remains valid. */
  label: ReactNode;
  dashed?: boolean;
  bare?: boolean;
  className?: string;
  children: ReactNode;
}

export default function StatField({ label, dashed = false, bare = false, className = "", children }: StatFieldProps) {
  return (
    <div
      className={[
        bare ? "" : `rounded-control border bg-ink px-3 py-2.5 ${dashed ? "border-dashed border-border" : "border-border"}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p className="text-[10px] font-medium uppercase tracking-wider text-text-3">{label}</p>
      <div className={bare ? "mt-0.5 font-mono text-sm text-text" : "mt-0.5 text-sm text-text"}>{children}</div>
    </div>
  );
}
