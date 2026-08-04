// services/ai/market-context-builder.service.ts
// Sprint D2.2 (Phase 7) - the AI Context Builder. Realises the sprint's core
// rule: the AI never sees a raw provider response. The flow is
//   MarketSnapshot -> indicators -> structured MarketContext (JSON) -> Gemini
//   -> natural-language explanation
// where every indicator is COMPUTED from the real snapshot (OHLC/change), and
// Gemini's only job is to restate the already-computed structured context in
// plain language - it is explicitly forbidden from inventing a price,
// direction, or conclusion not already present. This mirrors the existing
// MarketAnalysisOrchestrationService's "Gemini as translator, not analyst"
// contract, applied to the new shared MarketSnapshot.
//
// Indicators here are deliberately only the ones a single snapshot can support
// HONESTLY (range position within the session, range width, session
// direction). Series-based indicators (RSI, moving averages) require a real
// price series and are intentionally NOT fabricated from one quote - they are
// a future extension once a /time_series feed is wired.
import { createAIService, AIProviderError, type AIService } from "@/lib/ai";
import { AI_COMMUNICATION_POLICY } from "@/lib/ai/response-policy";
import { MarketDataService } from "@/services/market-data/market-data.service";
import { MarketDataProviderError } from "@/lib/market-data/errors";
import type { SnapshotProvider } from "@/types/market-data-provider";
import type { MarketSnapshot } from "@/types/market-snapshot";
import type { MarketCategory } from "@/types/market";

const MAX_PROMPT_CHARS = 6000;

export type MarketDirection = "up" | "down" | "flat";

export interface MarketIndicators {
  direction: MarketDirection;
  /** 0..1: where `close` sits within the session low→high range. Undefined when OHLC is absent. */
  rangePosition?: number;
  /** (high-low)/low as a percent - session range width. Undefined when OHLC is absent. */
  rangeWidthPercent?: number;
}

export interface StructuredMarketContext {
  symbol: string;
  name?: string;
  assetClass: MarketCategory;
  quoteCurrency: string;
  marketStatus: MarketSnapshot["marketStatus"];
  price: number;
  ohlc?: MarketSnapshot["ohlc"];
  changePercent?: number;
  indicators: MarketIndicators;
  /** Evidence-backed, human-readable observations - each is derived only from the snapshot, never invented. */
  observations: string[];
  provider: string;
  asOf: string;
}

export type MarketContextOutcome =
  | { status: "completed"; snapshot: MarketSnapshot; context: StructuredMarketContext; explanation: string }
  | { status: "provider-unavailable"; symbol: string; reason: string }
  | { status: "provider-error"; symbol: string; reason: string }
  | { status: "ai-failed"; symbol: string; message: string; context: StructuredMarketContext };

export class MarketContextBuilderService {
  // Both dependencies default to the real implementations but are injectable:
  // `data` is any SnapshotProvider (the central MarketDataService by default,
  // so this gets Twelve Data primary + fallback + reliability for free); `ai`
  // is resolved lazily so merely constructing this class never requires a
  // configured GEMINI_API_KEY.
  constructor(
    private readonly data: SnapshotProvider = new MarketDataService(),
    private readonly ai: Pick<AIService, "complete"> | null = null,
  ) {}

  private getAI(): Pick<AIService, "complete"> {
    return this.ai ?? createAIService();
  }

  computeIndicators(snapshot: MarketSnapshot): MarketIndicators {
    const direction: MarketDirection =
      snapshot.changePercent === undefined || snapshot.changePercent === 0
        ? "flat"
        : snapshot.changePercent > 0
          ? "up"
          : "down";

    const ohlc = snapshot.ohlc;
    if (!ohlc || ohlc.high === ohlc.low) return { direction };

    const rangePosition = (ohlc.close - ohlc.low) / (ohlc.high - ohlc.low);
    const rangeWidthPercent = ((ohlc.high - ohlc.low) / ohlc.low) * 100;
    return { direction, rangePosition, rangeWidthPercent };
  }

  buildContext(snapshot: MarketSnapshot): StructuredMarketContext {
    const indicators = this.computeIndicators(snapshot);
    const observations: string[] = [];

    if (snapshot.changePercent !== undefined) {
      observations.push(`Session change is ${snapshot.changePercent.toFixed(2)}% (${indicators.direction}).`);
    }
    if (indicators.rangePosition !== undefined) {
      const third = indicators.rangePosition >= 2 / 3 ? "upper" : indicators.rangePosition <= 1 / 3 ? "lower" : "middle";
      observations.push(`Price is in the ${third} third of the session range.`);
    }
    if (indicators.rangeWidthPercent !== undefined) {
      observations.push(`Session range width is ${indicators.rangeWidthPercent.toFixed(2)}% of the low.`);
    }
    observations.push(`Market is currently ${snapshot.marketStatus}.`);

    return {
      symbol: snapshot.symbol,
      name: snapshot.name,
      assetClass: snapshot.assetClass,
      quoteCurrency: snapshot.quoteCurrency,
      marketStatus: snapshot.marketStatus,
      price: snapshot.price,
      ohlc: snapshot.ohlc,
      changePercent: snapshot.changePercent,
      indicators,
      observations,
      provider: snapshot.provider,
      asOf: snapshot.timestamp,
    };
  }

  // Restate-only prompt built purely from the structured context. Gemini is a
  // translator: it may not add a number, direction, or conclusion not present
  // below, and must carry any absence through as-is.
  buildPrompt(context: StructuredMarketContext): string {
    const lines: string[] = [
      "You are a market-data explainer. You are given a fully-computed, structured market context as JSON.",
      "Your only task is to explain it in clear, natural language for a trader - you are a translator, not an analyst.",
      "Do not add any price, percentage, direction, indicator, or conclusion that is not explicitly present in the JSON.",
      "Do not give buy/sell advice. If a field is absent, do not invent it. Keep it concise (3-5 sentences).",
      AI_COMMUNICATION_POLICY,
      "Structured market context:",
      JSON.stringify(context, null, 2),
    ];
    const prompt = lines.join("\n");
    return prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;
  }

  // Generic restate-only explanation of ANY already-computed structured
  // context (e.g. { snapshot, technical, risk }). Same translator contract as
  // buildPrompt: Gemini may not add a value not present in the JSON. Used by
  // the Trading Copilot flow (snapshot + TechnicalContext + RiskContext).
  private buildStructuredPrompt(structured: unknown): string {
    const lines: string[] = [
      "You are a market-data explainer. You are given a fully-computed, structured market analysis as JSON (a live snapshot plus computed technical indicators and a risk context).",
      "Your only task is to explain it in clear, natural language for a trader - you are a translator, not an analyst.",
      "Do not add any price, percentage, indicator value, or conclusion that is not explicitly present in the JSON.",
      "Do not give buy/sell advice or invent support/resistance or trade setups. Where a value is null/absent, say the data is insufficient rather than estimating.",
      "Keep it concise (4-6 sentences).",
      AI_COMMUNICATION_POLICY,
      "Structured analysis:",
      JSON.stringify(structured, null, 2),
    ];
    const prompt = lines.join("\n");
    return prompt.length > MAX_PROMPT_CHARS ? prompt.slice(0, MAX_PROMPT_CHARS) : prompt;
  }

  async explainStructured(
    structured: unknown,
  ): Promise<{ status: "completed"; explanation: string } | { status: "ai-failed"; message: string }> {
    const prompt = this.buildStructuredPrompt(structured);
    try {
      const completion = await this.getAI().complete(prompt);
      if (completion.content.trim().length === 0) return { status: "ai-failed", message: "The AI returned an empty response." };
      return { status: "completed", explanation: completion.content };
    } catch (error) {
      const message = error instanceof AIProviderError ? error.message : "The AI explanation could not be completed.";
      return { status: "ai-failed", message };
    }
  }

  /**
   * Full flow for one symbol. Never throws for an expected failure: a missing
   * provider, a provider error, or an AI failure each return an explicit
   * outcome variant (the ai-failed variant still returns the computed
   * structured context, so a caller can render the deterministic part even if
   * the natural-language layer is unavailable). An unexpected non-typed error
   * propagates.
   */
  async build(symbol: string): Promise<MarketContextOutcome> {
    let snapshot: MarketSnapshot;
    try {
      snapshot = await this.data.getSnapshot({ symbol });
    } catch (error) {
      if (error instanceof MarketDataProviderError) {
        const status = error.kind === "unconfigured" ? "provider-unavailable" : "provider-error";
        return { status, symbol, reason: error.message };
      }
      throw error;
    }

    const context = this.buildContext(snapshot);
    const prompt = this.buildPrompt(context);

    try {
      const completion = await this.getAI().complete(prompt);
      if (completion.content.trim().length === 0) {
        return { status: "ai-failed", symbol, message: "The AI returned an empty response.", context };
      }
      return { status: "completed", snapshot, context, explanation: completion.content };
    } catch (error) {
      const message = error instanceof AIProviderError ? error.message : "The AI explanation could not be completed.";
      return { status: "ai-failed", symbol, message, context };
    }
  }
}
