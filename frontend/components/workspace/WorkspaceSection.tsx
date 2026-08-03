// components/workspace/WorkspaceSection.tsx
// Sprint D2.3 (Phase 2) - the standard panel wrapper for every workspace
// region, so spacing/borders/headers are identical everywhere (seeds the
// Phase 8 standardization). `emphasis` marks the AI Intelligence panel as the
// visual center of the workspace - the platform's positioning is that AI
// leads and the chart supports, never the reverse. When a region's real
// content isn't wired yet, `pending` renders a height-reserved placeholder
// (no layout shift when it later fills) - honest and neutral, never fake data.
import type { ReactNode } from "react";
import Skeleton from "@/components/ui/Skeleton";

export interface WorkspaceSectionProps {
  title: string;
  subtitle?: string;
  emphasis?: boolean;
  action?: ReactNode;
  /** Reserved-height placeholder text shown until the real content lands in a later phase. */
  pending?: string;
  minHeight?: number;
  children?: ReactNode;
}

export default function WorkspaceSection({
  title,
  subtitle,
  emphasis,
  action,
  pending,
  minHeight = 160,
  children,
}: WorkspaceSectionProps) {
  return (
    <section
      className={`rounded-panel border bg-ink-2 ${emphasis ? "border-gold/40 shadow-raised" : "border-border"}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          {emphasis && (
            <span className="rounded-control bg-gold px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink">
              Core
            </span>
          )}
          <div>
            <h2 className={`text-sm font-semibold ${emphasis ? "text-gold" : "text-text"}`}>{title}</h2>
            {subtitle && <p className="text-xs text-text-3">{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>

      <div className="p-5">
        {children ?? (
          <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ minHeight }}>
            <div aria-hidden="true" className="w-full max-w-md space-y-2 opacity-60">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            {pending && <p className="text-xs text-text-3">{pending}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
