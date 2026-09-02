// components/quant-lite/MetricTile.tsx
// Sprint Q0.8 - renders "Not available" for a null metric, never "0".
// Built on StatField's existing `dashed` variant (already the codebase's
// convention for "the current engine hasn't computed this yet" -
// components/workspace/StatField.tsx) rather than inventing a second one.
import StatField from "@/components/workspace/StatField";
import { FIN_PRIMARY, financialDirectionClass } from "@/components/ui/financial-typography";

export interface MetricTileProps {
  label: string;
  value: number | null;
  /** "percent" = signed/directional (Return, Drawdown) - gets a +/- prefix. "rate" = an absolute 0-100 rate (Win Rate) - no prefix, never negative. */
  format?: "percent" | "rate" | "currency" | "ratio" | "integer";
  /** true = positive is good (return), false = positive is bad (drawdown magnitude) */
  positiveIsGood?: boolean;
}

function formatValue(value: number, format: MetricTileProps["format"]): string {
  switch (format) {
    case "percent":
      return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
    case "rate":
      return `${value.toFixed(2)}%`;
    case "currency":
      return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case "ratio":
      return value.toFixed(2);
    case "integer":
    default:
      return value.toLocaleString();
  }
}

export default function MetricTile({ label, value, format = "integer", positiveIsGood = true }: MetricTileProps) {
  if (value === null) {
    return (
      <StatField label={label} dashed>
        <span className="text-text-3">Not available</span>
      </StatField>
    );
  }

  const direction = value === 0 ? "neutral" : (value > 0) === positiveIsGood ? "up" : "down";

  return (
    <StatField label={label}>
      <span className={[FIN_PRIMARY, "text-base", financialDirectionClass(direction)].join(" ")}>
        {formatValue(value, format)}
      </span>
    </StatField>
  );
}
