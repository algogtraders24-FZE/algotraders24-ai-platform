// services/ai/trading-copilot.service.ts
// Sprint D2.2 (Phase 7) - orchestrates the real Trading Copilot analysis:
//   MarketDataService (snapshot + time-series)
//     -> TechnicalContextService (real indicators + risk + data confidence)
//       -> MarketContextBuilderService.explainStructured (Gemini restate-only)
//         -> CopilotAnalysis
// The snapshot is required; the candle series is best-effort - if it is
// missing or too short, the technical context honestly reports insufficient
// data (indicators left undefined) rather than estimating, and the analysis
// still returns with whatever is real. No synthetic trade setups, no invented
// support/resistance, no fabricated RSI anywhere in this path.
import { MarketDataService } from "@/services/market-data/market-data.service";
import { TechnicalContextService } from "./technical-context.service";
import { MarketContextBuilderService } from "./market-context-builder.service";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import type { SnapshotProvider, TimeSeriesProvider } from "@/types/market-data-provider";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { Candle } from "@/types/market-candle";
import type { TechnicalContext, RiskContext, DataConfidence } from "@/types/technical-context";

export interface CopilotEvidenceItem {
  label: string;
  value: string;
}

export interface CopilotAnalysis {
  symbol: string;
  snapshot: MarketSnapshot;
  technical: TechnicalContext;
  risk: RiskContext;
  confidence: DataConfidence;
  explanation?: string;
  aiStatus: "completed" | "ai-failed";
  evidence: CopilotEvidenceItem[];
}

export type CopilotOutcome =
  | { status: "completed"; analysis: CopilotAnalysis }
  // Sprint D2.3.S3 - `cause` retains the original typed MarketDataProviderError
  // so the route layer can build the standardized error DTO
  // (lib/market-data/error-dto.ts) every other market-data-facing route
  // returns, instead of only a pre-formatted message string.
  | { status: "provider-unavailable"; symbol: string; reason: string; cause: MarketDataProviderError }
  | { status: "provider-error"; symbol: string; reason: string; cause: MarketDataProviderError };

export interface CopilotAnalyzeRequest {
  symbol: string;
  interval?: string;
  outputSize?: number;
}

export class TradingCopilotService {
  constructor(
    private readonly data: SnapshotProvider & TimeSeriesProvider = new MarketDataService(),
    private readonly technicalService: TechnicalContextService = new TechnicalContextService(),
    private readonly contextBuilder: MarketContextBuilderService = new MarketContextBuilderService(),
  ) {}

  async analyze(request: CopilotAnalyzeRequest): Promise<CopilotOutcome> {
    const { symbol } = request;
    const interval = request.interval ?? "1day";

    // Snapshot is required - without a live price there is nothing honest to show.
    let snapshot: MarketSnapshot;
    try {
      snapshot = await this.data.getSnapshot({ symbol });
    } catch (error) {
      if (error instanceof MarketDataProviderError) {
        const status = error.kind === "unconfigured" ? "provider-unavailable" : "provider-error";
        return { status, symbol, reason: error.message, cause: error };
      }
      throw error;
    }

    // Candles are best-effort: a failure here degrades to "insufficient data",
    // never fails the whole analysis (the snapshot is still real and useful).
    let candles: Candle[] = [];
    let seriesError: string | undefined;
    try {
      candles = await this.data.getTimeSeries({ symbol, interval, outputSize: request.outputSize });
    } catch (error) {
      seriesError = error instanceof MarketDataProviderError ? error.kind : "unknown";
    }

    const computedAt = new Date().toISOString();
    const technical = this.technicalService.build(symbol, interval, candles, computedAt);
    const risk = this.technicalService.buildRisk(snapshot, technical);
    const confidence = this.technicalService.confidence(technical);

    // The AI Context Builder receives snapshot + technical + risk as one
    // structured object and restates it - it never sees the raw provider JSON.
    const structured = {
      snapshot: {
        symbol: snapshot.symbol,
        name: snapshot.name,
        assetClass: snapshot.assetClass,
        price: snapshot.price,
        ohlc: snapshot.ohlc ?? null,
        changePercent: snapshot.changePercent ?? null,
        quoteCurrency: snapshot.quoteCurrency,
        marketStatus: snapshot.marketStatus,
        asOf: snapshot.timestamp,
      },
      technical,
      risk,
    };
    const ai = await this.contextBuilder.explainStructured(structured);

    const evidence: CopilotEvidenceItem[] = [
      { label: "Quote provider", value: snapshot.provider },
      { label: "Quote as of", value: snapshot.timestamp },
      { label: "Candles", value: `${candles.length} @ ${interval}${seriesError ? ` (series unavailable: ${seriesError})` : ""}` },
      { label: "Indicators computed", value: `${confidence.computed} of ${confidence.total}` },
    ];

    return {
      status: "completed",
      analysis: {
        symbol,
        snapshot,
        technical,
        risk,
        confidence,
        explanation: ai.status === "completed" ? ai.explanation : undefined,
        aiStatus: ai.status,
        evidence,
      },
    };
  }
}
