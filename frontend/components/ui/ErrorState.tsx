// components/ui/ErrorState.tsx
// Sprint IA4 - extracts the error-card pattern Market Intelligence and
// Trading Copilot already hand-rolled identically (rounded-card border-
// signal-down/30 bg-signal-down/10 p-6 + a retry action), and gives every
// other page a real "something went wrong" primitive distinct from
// EmptyState (dashed border, neutral tone, "nothing here yet"). The two
// must never look the same - a genuine failure and an honestly-empty
// result are different situations. `description` must always be a
// product-level sentence (see lib/api/ApiClient.ts's own fallback message)
// - never a raw HTTP status or exception string.
import type { ReactNode } from "react";

export interface ErrorStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export default function ErrorState({ title, description, action, className = "" }: ErrorStateProps) {
  return (
    <div role="alert" className={["rounded-card border border-signal-down/30 bg-signal-down/10 p-6", className].filter(Boolean).join(" ")}>
      <p className="text-sm font-semibold text-signal-down">{title}</p>
      {description && <p className="mt-1 text-sm text-text-2">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
