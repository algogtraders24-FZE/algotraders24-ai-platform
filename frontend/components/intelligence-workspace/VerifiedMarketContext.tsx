// components/intelligence-workspace/VerifiedMarketContext.tsx
// Sprint D2.6.10 - Trader Intelligence Workspace & Verified Answer
// Experience. The reusable header strip showing symbol/timeframe/market,
// data status, provider, regime, and Intelligence Score - every field a
// direct read of the server's VerifiedAnswerResponse (types/verified-
// answer-response.ts), never recomputed here. A provider is shown only
// when genuinely known; "fresh" is shown only when the real freshness
// policy (D2.6.4) actually classified it as fresh - never implied.
import type { VerifiedAnswerResponse } from "@/types/verified-answer-response";
import Badge from "@/components/ui/Badge";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { formatLabel, DATA_STATUS_TONE, regimeTone } from "./format";
import { formatScore } from "@/lib/financial-format";
import { FIN_PRIMARY } from "@/components/ui/financial-typography";

export default function VerifiedMarketContext({ result }: { result: VerifiedAnswerResponse }) {
  const { marketContext, dataStatus, provider, fallbackUsed, intelligenceScore } = result;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-card border border-border bg-ink-2 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-text">{marketContext.symbol}</p>
        <p className="text-[11px] uppercase tracking-wider text-text-3">
          {marketContext.timeframe}
          {marketContext.market ? ` · ${formatLabel(marketContext.market)}` : ""}
        </p>
      </div>

      <div className="h-8 w-px bg-border" aria-hidden="true" />

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-3">Regime</span>
        <Badge tone={regimeTone(marketContext.regimeType)}>{formatLabel(marketContext.regimeType)}</Badge>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-text-3">Data</span>
        <Badge tone={DATA_STATUS_TONE[dataStatus]}>{formatLabel(dataStatus)}</Badge>
        {/* Only ever shown when a real fallback genuinely occurred - never implied. */}
        {fallbackUsed && <Badge tone="warning">Fallback used</Badge>}
      </div>

      {/* No provider name is shown at all when provenance is genuinely unavailable - never a guessed/default provider. */}
      {provider && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-text-3">Provider</span>
          <span className="text-sm text-text-2">{formatLabel(provider)}</span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <span className="flex items-center text-[10px] uppercase tracking-wider text-text-3">
          Intelligence
          <InfoTooltip
            label="Intelligence Score"
            text="A quality/completeness score for the available intelligence - NOT a probability of profit or trade success."
          />
        </span>
        <span className={`${FIN_PRIMARY} text-sm font-semibold text-gold`}>{formatScore(intelligenceScore.overallScore)}</span>
      </div>
    </div>
  );
}
