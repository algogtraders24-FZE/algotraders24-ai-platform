// components/intelligence-workspace/MarketDataProvenance.tsx
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. Displays real market-data provenance only - provider,
// freshness, cache state, fallback status. Reuses exactly the fields
// VerifiedAnswerResponse already carries; never fabricates a provider
// chain. D2.6.9's own documented scope limitation applies here too: the
// exact pre-fallback provider attempt order is not structurally
// available, so this component only ever shows the real winning
// provider plus a fallback-occurred flag - never an invented sequence.
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";
import Badge from "@/components/ui/Badge";
import { formatLabel, DATA_STATUS_TONE } from "./format";
import { FIN_LABEL } from "@/components/ui/financial-typography";

export default function MarketDataProvenance({ result }: { result: VerifiedAnswerResponse }) {
  const { provider, dataStatus, fallbackUsed } = result;

  return (
    <div className="rounded-card border border-border bg-ink-2 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-gold">Data Source</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div>
          <dt className={FIN_LABEL}>Provider</dt>
          <dd className="mt-0.5 text-text-2">{provider ? formatLabel(provider) : "Unavailable"}</dd>
        </div>
        <div>
          <dt className={FIN_LABEL}>Status</dt>
          <dd className="mt-0.5">
            <Badge tone={DATA_STATUS_TONE[dataStatus]}>{formatLabel(dataStatus)}</Badge>
          </dd>
        </div>
        <div>
          <dt className={FIN_LABEL}>Fallback</dt>
          <dd className="mt-0.5 text-text-2">{fallbackUsed ? "Used" : "Not used"}</dd>
        </div>
      </dl>
      {fallbackUsed && (
        <p className="mt-3 text-xs leading-5 text-text-3">
          Data retrieved using a fallback provider after an earlier-priority provider was unavailable.
        </p>
      )}
    </div>
  );
}
