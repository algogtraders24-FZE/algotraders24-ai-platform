// components/workspace/WorkspaceSection.tsx
// Sprint D2.3 (Phase 2) - the standard panel wrapper for every workspace
// region, so spacing/borders/headers are identical everywhere (seeds the
// Phase 8 standardization). `emphasis` marks the AI Intelligence panel as the
// visual center of the workspace - the platform's positioning is that AI
// leads and the chart supports, never the reverse. When a region's real
// content isn't wired yet, `pending` renders a height-reserved placeholder
// (no layout shift when it later fills) - honest and neutral, never fake data.
//
// Sprint D2.3 (Phase 7) - optional collapse support (`id` + `collapsible`),
// backed by WorkspaceContext's persisted `collapsedPanels`. Opt-in and
// backward compatible: omitted on existing usages, so behavior there is
// unchanged. The AI Intelligence panel never opts in - it must stay the
// workspace's visible, primary decision surface.
"use client";

import type { ReactNode } from "react";
import Skeleton from "@/components/ui/Skeleton";
import { useWorkspace } from "@/context/WorkspaceContext";
import type { PanelId } from "@/types/workspace-preferences";

export interface WorkspaceSectionProps {
  title: string;
  subtitle?: string;
  emphasis?: boolean;
  action?: ReactNode;
  /** Reserved-height placeholder text shown until the real content lands in a later phase. */
  pending?: string;
  minHeight?: number;
  /** Opt-in panel identity for persisted collapse state - see PANEL_IDS. */
  id?: PanelId;
  collapsible?: boolean;
  children?: ReactNode;
}

export default function WorkspaceSection({
  title,
  subtitle,
  emphasis,
  action,
  pending,
  minHeight = 160,
  id,
  collapsible = false,
  children,
}: WorkspaceSectionProps) {
  const { collapsedPanels, togglePanel } = useWorkspace();
  const collapsed = collapsible && id ? collapsedPanels.includes(id) : false;

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
        <div className="flex items-center gap-2">
          {action}
          {collapsible && id && (
            <button
              type="button"
              onClick={() => togglePanel(id)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
              className="rounded-control p-1 text-sm leading-none text-text-3 transition hover:bg-ink-3 hover:text-text"
            >
              {collapsed ? "▸" : "▾"}
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
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
      )}
    </section>
  );
}
