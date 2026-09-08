// components/ui/PageHeader.tsx
// Sprint IA4 - extracts the eyebrow/title/description header pattern
// Market Intelligence and Trading Copilot already hand-rolled identically
// (and several other dashboard pages approximated inconsistently, some with
// no eyebrow at all - Signals, Assistant, News, Agents). One primitive, not
// a new look: every prop below maps 1:1 onto that existing markup.
import type { ReactNode } from "react";

export interface PageHeaderProps {
  eyebrow: string;
  title: string;
  /** Usually a plain string; accepts ReactNode for the rare case a page needs an inline emphasis span inside its own description (e.g. Trading Copilot's "Insufficient data" callout) - never for injecting a second CTA here, that's what `action` is for. */
  description?: ReactNode;
  /** Optional page-level primary action, rendered top-right on wide viewports and beneath the description on narrow ones - per the CTA-placement convention (page-level primary action -> page header), never forced into a fixed position that would overflow on mobile. */
  action?: ReactNode;
  className?: string;
}

export default function PageHeader({ eyebrow, title, description, action, className = "" }: PageHeaderProps) {
  return (
    <header className={["mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className].filter(Boolean).join(" ")}>
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-gold">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-bold text-text">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-text-2">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
