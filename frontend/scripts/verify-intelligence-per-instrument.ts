// scripts/verify-intelligence-per-instrument.ts
// Sprint D2.8.15, Phase 9-10 - real, live production verification for all 7
// required instruments (BTCUSD, ETHUSD, EURUSD, XAUUSD, XAGUSD, NIFTY50,
// BANKNIFTY). This performs REAL network calls through the actual
// production entry point (RealTimeIntelligenceService.build() ->
// DecisionContextService.build(), the exact path the chat/workspace routes
// use) - never a fixture, never a fabricated candle. Records, per
// instrument: provider, timeframe, candles requested vs. received vs.
// structurally valid, every core indicator's availability, regime,
// hypothesis count, microstructure capability/evidence state, historical
// validation state, and the final decisionState - proving core intelligence
// survives independently of microstructure/historical-validation gaps
// (D2.8.15's central claim) against real, current market data.
//
// Not part of the regular regression suite (real network + real Angel One
// auth) - run manually: DOTENV_CONFIG_PATH=.env.local npx tsx -r dotenv/config scripts/verify-intelligence-per-instrument.ts
import { RealTimeIntelligenceService } from "@/services/intelligence/orchestration/real-time-intelligence.service";
import { DecisionContextService } from "@/services/intelligence/decision/decision-context.service";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";

const INSTRUMENTS = ["BTCUSD", "ETHUSD", "EURUSD", "XAUUSD", "XAGUSD", "NIFTY50", "BANKNIFTY"] as const;

interface InstrumentReport {
  symbol: string;
  status: string;
  provider?: string;
  fallbackUsed?: boolean;
  timeframe?: string;
  candlesReceived?: number;
  candlesValid?: number;
  candleIssues?: number;
  indicators?: Record<string, boolean>;
  regimeType?: string;
  hypothesisCount?: number;
  microstructureCapable?: boolean;
  microstructureSnapshotFetched?: boolean;
  microstructureEvidencePresent?: boolean;
  historicalValidationStatus?: string;
  decisionState?: string;
  missingInformationCount?: number;
  missingInformationDescriptions?: string[];
  error?: string;
}

async function verifyOne(svc: RealTimeIntelligenceService, decisionSvc: DecisionContextService, symbol: string): Promise<InstrumentReport> {
  const instrument = getCanonicalInstrument(symbol);
  const timeframe = "1h" as const;
  try {
    const ctx = await svc.build({
      requestId: `d2.8.15-verify-${symbol}`,
      userId: "d2.8.15-production-verification",
      question: `What is the current market intelligence for ${symbol}?`,
      symbol,
      timeframe,
      includeMicrostructure: true,
    });

    if (ctx.status !== "resolved" || !ctx.envelope) {
      return { symbol, status: ctx.status };
    }

    const { envelope, microstructure } = ctx;
    const dc = decisionSvc.build(envelope, microstructure);
    const technical = envelope.marketState.technical ?? {};

    const microstructureCapable = (instrument?.providerMappings ?? []).some(
      (m) => m.provider === "binance" && m.supportedCapabilities.includes("quote"),
    );

    return {
      symbol,
      status: "resolved",
      provider: envelope.marketState.snapshot.provider,
      fallbackUsed: envelope.marketState.snapshot.fallbackUsed,
      timeframe: envelope.timeframe,
      candlesReceived: envelope.marketState.candleValidation?.totalReceived,
      candlesValid: envelope.marketState.candleValidation?.totalValid,
      candleIssues: envelope.marketState.candleValidation?.issues.length,
      indicators: {
        rsi14: technical.rsi14 !== undefined,
        ema20: technical.ema20 !== undefined,
        ema50: technical.ema50 !== undefined,
        atr14: technical.atr14 !== undefined,
        macd: technical.macd !== undefined,
        bollinger: technical.bollinger !== undefined,
        volume: technical.volume !== undefined,
      },
      regimeType: envelope.regime.regimeType,
      hypothesisCount: envelope.hypotheses.length,
      microstructureCapable,
      microstructureSnapshotFetched: !!microstructure,
      microstructureEvidencePresent: !!dc.microstructureEvidence,
      historicalValidationStatus: dc.historicalContext.status,
      decisionState: dc.state,
      missingInformationCount: dc.missingInformation.length,
      missingInformationDescriptions: dc.missingInformation.map((m) => m.description),
    };
  } catch (error) {
    return { symbol, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const svc = new RealTimeIntelligenceService();
  const decisionSvc = new DecisionContextService();
  const reports: InstrumentReport[] = [];

  for (const symbol of INSTRUMENTS) {
    console.log(`\nVerifying ${symbol}...`);
    const report = await verifyOne(svc, decisionSvc, symbol);
    reports.push(report);
    console.log(JSON.stringify(report, null, 2));
  }

  console.log("\n\n=== SUMMARY TABLE ===");
  console.log(
    reports
      .map((r) =>
        [
          r.symbol.padEnd(10),
          r.status.padEnd(10),
          (r.provider ?? "-").padEnd(14),
          `candles ${r.candlesValid ?? "-"}/${r.candlesReceived ?? "-"}`,
          `regime=${r.regimeType ?? "-"}`,
          `hyp=${r.hypothesisCount ?? "-"}`,
          `microCapable=${r.microstructureCapable ?? "-"}`,
          `microEvidence=${r.microstructureEvidencePresent ?? "-"}`,
          `historical=${r.historicalValidationStatus ?? "-"}`,
          `decisionState=${r.decisionState ?? "-"}`,
        ].join(" | "),
      )
      .join("\n"),
  );

  const resolvedCount = reports.filter((r) => r.status === "resolved").length;
  console.log(`\n${resolvedCount}/${reports.length} instruments resolved.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
