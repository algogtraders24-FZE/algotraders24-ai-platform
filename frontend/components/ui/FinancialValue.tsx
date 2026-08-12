// components/ui/FinancialValue.tsx
// Sprint D2.7.1 - AT24 Financial Typography & Rendering Foundation. The
// one reusable label+price[+change] display for a financial value -
// built ON TOP of the existing StatField primitive (D2.3-P8's own
// label+value pattern), never a competing shape. Every number rendered
// through here uses the same formatPrice/formatPercent
// (lib/financial-format.ts) and the same FIN_* typography tokens
// (components/ui/financial-typography.ts) this sprint establishes as the
// one contract - the unification MarketRibbon/WorkspaceHeader previously
// each reinvented independently.
//
// Purely presentational: no market-data fetch, no computation. A caller
// supplies the already-real value/state; this component only decides how
// to render it. No hardcoded market values anywhere in this file.
import StatField from "@/components/workspace/StatField";
import Skeleton from "@/components/ui/Skeleton";
import { formatPrice, formatPercent } from "@/lib/financial-format";
import { FIN_PRIMARY, FIN_SECONDARY, financialDirectionClass, directionFromChange } from "./financial-typography";

export type FinancialValueState = "ready" | "loading" | "unavailable" | "stale";

export interface FinancialValueProps {
  label: string;
  /** The real value, or undefined when genuinely not (yet) known - never a placeholder number. */
  value?: number;
  unit?: string;
  changePercent?: number;
  /** See lib/financial-format.ts's formatPrice - defaults to the standard 2-decimal convention. */
  maxDecimals?: number;
  state?: FinancialValueState;
  /** Matches StatField's own `bare` prop - defaults true for inline header/ribbon placement. */
  bare?: boolean;
  className?: string;
}

export default function FinancialValue({
  label,
  value,
  unit,
  changePercent,
  maxDecimals,
  state = "ready",
  bare = true,
  className,
}: FinancialValueProps) {
  if (state === "loading") {
    return (
      <StatField label={label} bare={bare} className={className}>
        <Skeleton className="h-4 w-16" />
      </StatField>
    );
  }

  if (state === "unavailable" || value === undefined) {
    return (
      <StatField label={label} bare={bare} className={className}>
        <span className="text-text-3">Unavailable</span>
      </StatField>
    );
  }

  const direction = directionFromChange(changePercent);

  return (
    <StatField label={label} bare={bare} className={className}>
      <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className={FIN_PRIMARY}>
          {formatPrice(value, { maxDecimals })}
          {unit ? ` ${unit}` : ""}
        </span>
        {changePercent !== undefined && (
          <span className={`${FIN_SECONDARY} ${financialDirectionClass(direction)}`}>{formatPercent(changePercent)}</span>
        )}
        {state === "stale" && <span className="text-[10px] uppercase tracking-wider text-warning">Stale</span>}
      </span>
    </StatField>
  );
}
