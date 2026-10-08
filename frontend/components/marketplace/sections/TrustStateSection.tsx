// components/marketplace/sections/TrustStateSection.tsx
// Sprint M8 - Displays the structured backend output verbatim (M8 brief
// section 9): status, reasonCode, explanation, last transition. The
// frontend never invents or paraphrases an explanation - if trustInfo is
// null, this says so plainly rather than guessing a reason.
//
// Sprint M12 branding follow-on - adds a real, positive lead-in: how many
// of the M4 validation dimensions actually passed, computed directly from
// the same ValidationSummary already shown in ValidationSection below,
// never a new number. An INCONCLUSIVE overall status with 5/7 real PASS
// dimensions is a materially different picture than "nothing computed" -
// this surfaces that fact prominently instead of only in the fine print,
// without touching or softening trustInfo.explanation itself (still
// rendered verbatim, unchanged).
import Badge from "@/components/ui/Badge";
import { trustStateLabel, trustStateTone } from "@/lib/marketplace";
import type { TrustStateInfo, ValidationSummary } from "@/types/marketplace";

export default function TrustStateSection({ trustInfo, validation }: { trustInfo: TrustStateInfo | null; validation?: ValidationSummary | null }) {
  const passCount = validation?.dimensions.filter((d) => d.status === "PASS").length ?? null;
  const totalCount = validation?.dimensions.length ?? null;

  return (
    <section aria-labelledby="trust-state-heading" className="rounded-2xl bg-ink-3 border border-border p-6">
      <h2 id="trust-state-heading" className="text-xl font-bold mb-4">
        Trust State
      </h2>
      {trustInfo ? (
        <div className="space-y-3">
          {passCount !== null && totalCount !== null && passCount > 0 && (
            <div className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-sm font-semibold text-success">
              {passCount} of {totalCount} independent validation checks passed
            </div>
          )}
          <div className="flex items-center gap-3">
            <Badge tone={trustStateTone(trustInfo.status)} className="text-sm px-3 py-1">
              {trustStateLabel(trustInfo.status)}
            </Badge>
            <span className="text-xs text-text-3">reason: {trustInfo.reasonCode}</span>
          </div>
          <p className="text-text-2 text-sm leading-6">{trustInfo.explanation}</p>
          {trustInfo.generatedAt && (
            <p className="text-xs text-text-3">Last transition: {new Date(trustInfo.generatedAt).toLocaleString()}</p>
          )}
        </div>
      ) : (
        <p className="text-sm text-text-3">
          <strong className="text-text-2">Not checked.</strong> AT24 has not checked this listing, so the description and any performance
          figures are the seller&apos;s own claims. &quot;Not checked&quot; is not a negative signal by itself - it means no verification has been run for it yet.
          If the seller attached a demo or live account, its real results are shown separately on this page.
        </p>
      )}
    </section>
  );
}
