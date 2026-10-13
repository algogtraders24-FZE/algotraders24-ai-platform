// services/ai/production-analysis-orchestrator.ts
// The one production-wired MarketAnalysisOrchestrationService (live market data +
// stored news + macro/cross-asset/technical evidence). Extracted verbatim from
// app/api/private/market-intelligence/analyze/route.ts so a second caller (the
// daily publishing cron) analyses with exactly the same inputs as that page.
import { MarketAnalysisOrchestrationService } from "@/services/ai/market-analysis-orchestration.service";
import { MarketIntelligencePipelineService } from "@/services/ai/market-intelligence-pipeline.service";
import { EvidenceCollectorService } from "@/services/ai/evidence/evidence-collector.service";
import { EvidenceRankingService } from "@/services/ai/evidence/evidence-ranking.service";
import { EvidenceFusionService } from "@/services/ai/evidence-fusion.service";
import { ReasoningEngineService } from "@/services/ai/reasoning/reasoning-engine.service";
import { RiskEngineService } from "@/services/ai/risk/risk-engine.service";
import { ConfidenceEngineService } from "@/services/ai/confidence/confidence-engine.service";
import { marketData } from "@/services/market-data/shared-instance";
import { SharedNewsCacheProvider } from "@/services/news/market-intelligence-news-provider";
import { StoredNewsEvidenceProvider } from "@/services/evidence-sources/stored-news-provider";
import { productionExtraEvidenceSources } from "@/services/evidence-sources/production-sources";
import { systemClock } from "@/lib/market-data/cache";

const pipeline = new MarketIntelligencePipelineService(
  marketData,
  new EvidenceCollectorService(),
  new EvidenceRankingService(),
  new ReasoningEngineService(),
  new RiskEngineService(),
  new ConfidenceEngineService(),
  systemClock,
  new EvidenceFusionService(),
  // AN1.2 - reads the shared, cross-feature NewsArticle store (cache-first,
  // quota-reserved live fallback) instead of calling Alpha Vantage directly
  // on every analysis request. See services/news/market-intelligence-news-
  // provider.ts's header for why this is a new class rather than a rewrite
  // of the pre-existing, still-tested AlphaVantageNewsProvider.
  //
  // Wrapped so every headline carries ONE source name (publisher kept in the claim): the ranking
  // stage flags same-type items from different sources with different text as conflicts, so
  // per-publisher names produced N(N-1)/2 spurious "conflicts" (6 for 4 headlines) and pushed this
  // page's risk to High. This page keeps the live (quota-reserved) refresh fallback.
  new StoredNewsEvidenceProvider(async () => new SharedNewsCacheProvider()),
  // Same extra evidence the real-time path uses: macro (economic calendar), cross-asset (macro
  // drivers) and technical (SMC structure). Before this the page ran on price + news only.
  productionExtraEvidenceSources(),
);
const orchestrator = new MarketAnalysisOrchestrationService(pipeline);

export const productionAnalysisOrchestrator = orchestrator;
