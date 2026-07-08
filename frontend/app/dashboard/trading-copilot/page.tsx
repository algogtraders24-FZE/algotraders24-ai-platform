// app/dashboard/trading-copilot/page.tsx
"use client";

import { useMemo, useState } from "react";
import type { MarketAnalysis } from "@/types/market-analysis";
import { getQuote, mockMarket } from "@/data/mock-market";
import { analyzeMarket } from "@/services/ai/trading/market-analysis.service";
import { sendMessage } from "@/services/ai/assistant.service";
import TradingCopilotHeader from "@/components/trading/TradingCopilotHeader";
import MarketOverviewCard from "@/components/trading/MarketOverviewCard";
import MarketBiasCard from "@/components/trading/MarketBiasCard";
import ConfidenceGauge from "@/components/trading/ConfidenceGauge";
import TechnicalAnalysisCard from "@/components/trading/TechnicalAnalysisCard";
import TradeSetupCard from "@/components/trading/TradeSetupCard";
import RiskCard from "@/components/trading/RiskCard";
import SupportResistanceCard from "@/components/trading/SupportResistanceCard";
import LiquidityCard from "@/components/trading/LiquidityCard";
import AIReasoningCard from "@/components/trading/AIReasoningCard";

export default function TradingCopilotPage() {
  const [symbol, setSymbol] = useState(mockMarket[0].symbol);
  const [loading, setLoading] = useState(false);
  const [aiCommentary, setAiCommentary] = useState<string | null>(null);

  const analysis: MarketAnalysis = useMemo(() => {
    const quote = getQuote(symbol) ?? mockMarket[0];
    return analyzeMarket(quote);
  }, [symbol]);

  const onAnalyze = async () => {
    setLoading(true);
    setAiCommentary(null);
    try {
      const prompt = `Give a short professional trading commentary for ${analysis.quote.name} (${symbol}). Bias: ${analysis.bias.direction}, confidence ${analysis.confidence}%, entry ${analysis.setup.entry}, stop ${analysis.setup.stopLoss}, R:R ${analysis.setup.riskReward}. Keep it under 120 words. Mention risk.`;
      const res = await sendMessage({ conversationId: "copilot", message: prompt });
      setAiCommentary(res.message.content);
    } catch {
      setAiCommentary(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-5">
        <TradingCopilotHeader symbol={symbol} onSymbolChange={setSymbol} onAnalyze={onAnalyze} loading={loading} />

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MarketOverviewCard quote={analysis.quote} />
          <MarketBiasCard bias={analysis.bias} />
          <ConfidenceGauge score={analysis.confidence} />
          <TechnicalAnalysisCard indicators={analysis.indicators} />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <TradeSetupCard setup={analysis.setup} />
          <RiskCard risk={analysis.risk} />
          <div className="space-y-4">
            <SupportResistanceCard levels={analysis.levels} />
            <LiquidityCard liquidity={analysis.liquidity} />
          </div>
        </section>

        <AIReasoningCard
          reasoning={analysis.reasoning}
          warnings={analysis.warnings}
          nextActions={analysis.nextActions}
          aiCommentary={aiCommentary}
        />
      </div>
    </div>
  );
}