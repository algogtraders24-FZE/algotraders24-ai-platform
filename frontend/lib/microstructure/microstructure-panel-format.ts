// lib/microstructure/microstructure-panel-format.ts
// Sprint D2.8.10 - Microstructure Visualization & Intelligence Evidence
// Layer. The one pure formatting function MicrostructurePanel.tsx uses to
// turn a MicrostructureField<number> into UI text - split out from the
// component (matching this codebase's established "components render, lib
// computes/formats" split - lib/financial-format.ts/ChartHeader.tsx is the
// same pattern) so it is independently testable without rendering React.
// This performs NO calculation of its own - it only chooses which string to
// show for an already-computed field's already-assigned CapabilityState,
// exactly the same honesty rule lib/microstructure/microstructure-presentation.ts
// already enforces for the AI presentation path (never a fabricated number
// for a non-available/stale field, stale always labeled, never silently
// upgraded to fresh).
import type { MicrostructureField } from "@/types/microstructure";

export function formatMicrostructureFieldForUI(field: MicrostructureField<number> | undefined, render: (value: number) => string): string {
  if (!field) return "Unavailable";
  if (field.state === "available" || field.state === "stale") {
    const value = render(field.value as number);
    return field.state === "stale" ? `${value} (stale)` : value;
  }
  if (field.state === "not_supported_by_provider") return "Not supported for this instrument";
  if (field.state === "invalid") return "Invalid";
  return "Unavailable";
}
