// components/quant-lite/LegacyEvidenceBadge.tsx
// Sprint Q0.8 - one component so the LEGACY-BACKTEST-EVIDENCE wording/
// styling can never drift across the Strategy Library and Strategy Detail
// screens (Q0.7_UI_INFORMATION_ARCHITECTURE.md Part 10). Never "Verified",
// "Validated", "Production Ready", or "Guaranteed" - those claims require
// a real Evidence/Validation chain this library has never gone through
// (per quant-engine/reports/QUANT_LITE_LEGACY_AUDIT.md).
import Badge from "@/components/ui/Badge";
import InfoTooltip from "@/components/ui/InfoTooltip";

export default function LegacyEvidenceBadge() {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone="gold">LEGACY-BACKTEST-EVIDENCE</Badge>
      <InfoTooltip
        label="Legacy Backtest Evidence"
        text="This result predates the current canonical execution engine and is research/discovery evidence only - not validated performance. It is not labeled Verified, Validated, or Guaranteed."
      />
    </span>
  );
}
