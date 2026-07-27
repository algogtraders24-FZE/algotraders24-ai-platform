// services/ai/market-context.service.ts
// Sprint 15D.1 - Service boundary for assembling a bounded, deterministic
// MarketContext from a MarketDataProvider. Does NOT call, wrap, or modify
// context-manager.service.ts - the MarketContext this produces is meant to
// be serialized by a future caller into Context Manager's existing
// ragContext/systemInstructions string inputs, exactly like knowledge-base
// RAG context is handled in app/api/private/knowledge/chat/route.ts today.
//
// No concrete MarketDataProvider exists yet (Sprint 15D.1 scope is the
// abstraction only - see types/market-data-provider.ts). With no provider
// configured, getMarketContext() throws MarketDataProviderUnavailableError
// rather than fabricating data, following the same throw-typed-error
// convention as ConversationMessageService/ConversationService (Sprint
// 15C.3/15C.7) rather than a mock fallback.
import type {
  MarketDataProvider,
  MarketContextRequest,
  MarketContextResult,
} from "@/types/market-data-provider";
import { MarketDataProviderUnavailableError } from "@/types/market-data-provider";
import type { MarketContext } from "@/types/market-context";
import { RepositoryError } from "@/types/repository";

const MAX_CONFIDENCE = 100;
const CONFIDENCE_PER_EVIDENCE = 20;

export class MarketContextService {
  constructor(private readonly provider: MarketDataProvider | null = null) {}

  private assertNonEmpty(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RepositoryError({
        code: "VALIDATION",
        entity: "MarketContext",
        operation: "validate",
        message: `${field} must be a non-empty string`,
      });
    }
    return value;
  }

  /**
   * Returns a bounded, deterministic MarketContext for the given symbol.
   * Throws MarketDataProviderUnavailableError when no provider is
   * configured - never returns a fabricated/placeholder context.
   */
  async getMarketContext(request: MarketContextRequest): Promise<MarketContext> {
    const symbol = this.assertNonEmpty(request.symbol, "symbol");

    if (!this.provider || !this.provider.isConfigured()) {
      throw new MarketDataProviderUnavailableError(this.provider?.name ?? "none");
    }

    const raw = await this.provider.getMarketContext({ ...request, symbol });
    return this.toMarketContext(raw);
  }

  // Passes through only what the provider actually supplied. An absent
  // field on `raw` stays absent on the result - it is never replaced with
  // a guessed default (that would be fabricated market data).
  private toMarketContext(raw: MarketContextResult): MarketContext {
    const evidence = raw.evidence;

    return {
      symbol: raw.symbol,
      state: {
        symbol: raw.symbol,
        trend: raw.trend,
        volatility: raw.volatility,
        liquidity: raw.liquidity,
        evidence,
      },
      technical: {
        symbol: raw.symbol,
        summary: raw.technicalSummary,
        evidence,
      },
      news: {
        symbol: raw.symbol,
        headlines: raw.headlines ?? [],
        evidence,
      },
      risk: {
        symbol: raw.symbol,
        level: raw.riskLevel,
        notes: raw.riskNotes,
        evidence,
      },
      confidence: {
        score: evidence.length > 0 ? Math.min(MAX_CONFIDENCE, evidence.length * CONFIDENCE_PER_EVIDENCE) : 0,
        basis: evidence,
      },
      sentiment: raw.sentiment,
      generatedAt: raw.retrievedAt,
    };
  }
}
