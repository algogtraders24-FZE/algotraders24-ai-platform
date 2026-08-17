// services/research/microstructure/historical-microstructure-dataset.service.ts
// Sprint D2.8.14 - Historical Microstructure Outcome Validation. RESEARCH
// ONLY. Builds real HistoricalMicrostructureObservation rows by joining:
//   (a) real, already-persisted AT24 hypotheses (IntelligenceAnalysisRun.
//       hypothesisSnapshot, D2.5.4) - never recomputed, read verbatim.
//   (b) real historical Binance aggTrades (lib/research/binance-historical-
//       trades.ts, NEW this sprint) ending at (never after) each
//       hypothesis's own creation time - never future data.
// Every microstructure field this service cannot honestly know
// historically (bid/ask/order-book depth - Binance's public API has no
// historical depth endpoint at all, Phase 1 finding) is explicitly marked
// "not_supported_by_provider" via D2.8.5's own unmodified
// buildMicrostructureSnapshot() - NEVER reconstructed from OHLC candles.
// The resulting snapshot's directional read comes ENTIRELY from real,
// aggressor-mapped historical trade volume - the one signal the brief
// explicitly permits reconstructing historically.
//
// assessMicrostructureEvidence() (D2.8.11) is imported and called
// UNMODIFIED - this file performs zero threshold/formula logic of its own.
import { prisma } from "@/lib/prisma";
import { getCanonicalInstrument } from "@/lib/market-data/instrument-catalog";
import { buildMicrostructureSnapshot } from "@/services/microstructure/microstructure-snapshot.service";
import { assessMicrostructureEvidence } from "@/services/intelligence/microstructure/microstructure-evidence-assessment.service";
import { fetchBinanceHistoricalAggTrades, BinanceHistoricalTradesError, type BinanceHistoricalAggTrade } from "@/lib/research/binance-historical-trades";
import type { MarketSymbol } from "@/types/market";
import type { RawMicrostructureResult, RawMicrostructureEvidence } from "@/types/microstructure";
import type { HypothesisSnapshot } from "@/types/intelligence-hypothesis-snapshot";
import type { HistoricalMicrostructureObservation } from "@/types/research/historical-microstructure-research";

/**
 * How far back before a hypothesis's creation time to aggregate real
 * trades for the volume-delta signal - a fixed, documented research
 * parameter, never tuned against this sprint's own outcome results
 * (Phase 5's own prohibition, applied consistently here too).
 *
 * 2 minutes, not the originally-drafted 15 - a real-data run against this
 * sprint's own BTCUSD/ETHUSD hypotheses found Binance's aggTrades response
 * (capped at 1000 rows per call) was truncated in the vast majority of
 * 15-minute windows for these highly liquid pairs, silently dropping every
 * trade CLOSEST to the hypothesis's own creation time - a real, if subtle,
 * data-quality bug this sprint's own honesty requirements exist to catch,
 * not paper over. A live feasibility check found BTCUSDT/ETHUSDT stay
 * safely under the 1000-row cap (~100-150 trades) at 2 minutes with
 * comfortable margin.
 */
export const AGG_TRADES_LOOKBACK_MS = 2 * 60_000;

export type ObservationRejectionReason =
  | "instrument-not-binance-capable"
  | "no-hypotheses-in-snapshot"
  | "aggtrades-fetch-failed"
  | "aggtrades-window-truncated"
  | "no-real-trades-in-window"
  | "missing-creation-price";

export interface BuildObservationsResult {
  observations: HistoricalMicrostructureObservation[];
  rejected: Partial<Record<ObservationRejectionReason, number>>;
  runsConsidered: number;
}

interface AnalysisRunRow {
  id: string;
  symbol: string;
  timeframe: string;
  createdAt: Date;
  hypothesisSnapshot: unknown;
}

/** The one, narrow slice of the Prisma client this service actually reads - injectable so tests can supply deterministic fixture rows instead of a real database connection, matching this codebase's established DI convention (e.g. IntelligenceChatContextService, ResearchSnapshotService). Defaults to the real, unmodified prisma singleton. */
export interface AnalysisRunReader {
  intelligenceAnalysisRun: {
    findMany(args: {
      where: { symbol: string; deletedAt: null; hypothesisSnapshot: { not: undefined }; createdAt: { lte: Date } };
      orderBy: { createdAt: "asc" };
      select: { id: true; symbol: true; timeframe: true; createdAt: true; hypothesisSnapshot: true };
    }): Promise<AnalysisRunRow[]>;
  };
}

export class HistoricalMicrostructureDatasetService {
  constructor(
    private readonly fetchAggTrades: typeof fetchBinanceHistoricalAggTrades = fetchBinanceHistoricalAggTrades,
    private readonly db: AnalysisRunReader = prisma,
  ) {}

  /**
   * `asOfMs` bounds every query and every candidate run to strictly avoid
   * pulling a run created after the research is being run - a real, if
   * unlikely, leakage vector (Phase 10 self-check) rather than an
   * assumption the DB is a fixed point-in-time snapshot.
   */
  async buildObservations(symbols: MarketSymbol[], asOfMs: number): Promise<BuildObservationsResult> {
    const observations: HistoricalMicrostructureObservation[] = [];
    const rejected: Partial<Record<ObservationRejectionReason, number>> = {};
    let runsConsidered = 0;
    const bump = (reason: ObservationRejectionReason) => {
      rejected[reason] = (rejected[reason] ?? 0) + 1;
    };

    for (const symbol of symbols) {
      const instrument = getCanonicalInstrument(symbol);
      const binanceMapping = (instrument?.providerMappings ?? []).find((m) => m.provider === "binance" && m.supportedCapabilities.includes("quote"));
      if (!binanceMapping) {
        // Instrument safety (Phase 4/D2.8.9-13's own established rule):
        // zero Binance calls for anything not genuinely Binance-mapped.
        bump("instrument-not-binance-capable");
        continue;
      }

      const rows = (await this.db.intelligenceAnalysisRun.findMany({
        where: { symbol, deletedAt: null, hypothesisSnapshot: { not: undefined }, createdAt: { lte: new Date(asOfMs) } },
        orderBy: { createdAt: "asc" },
        select: { id: true, symbol: true, timeframe: true, createdAt: true, hypothesisSnapshot: true },
      })) as AnalysisRunRow[];

      for (const row of rows) {
        runsConsidered += 1;
        const snapshot = row.hypothesisSnapshot as HypothesisSnapshot | null;
        if (!snapshot || snapshot.hypotheses.length === 0) {
          bump("no-hypotheses-in-snapshot");
          continue;
        }
        const creationPrice = snapshot.marketState?.snapshot?.price;
        if (typeof creationPrice !== "number" || !Number.isFinite(creationPrice)) {
          bump("missing-creation-price");
          continue;
        }

        const createdAtMs = row.createdAt.getTime();
        let trades: BinanceHistoricalAggTrade[];
        try {
          const result = await this.fetchAggTrades(binanceMapping.providerSymbol, createdAtMs - AGG_TRADES_LOOKBACK_MS, createdAtMs);
          // Binance caps a single aggTrades response at 1000 rows, returned
          // oldest-first - a truncated result silently drops every trade
          // CLOSEST to createdAt (the ones that actually matter most for a
          // "what was order flow doing right before this hypothesis" read),
          // keeping only the earliest slice of the lookback window. Using
          // that as a real volume-delta reading would honestly not be
          // representative of the window it claims to cover - rejected
          // rather than silently computed from a biased partial sample.
          if (result.truncated) {
            bump("aggtrades-window-truncated");
            continue;
          }
          trades = result.trades;
        } catch (cause) {
          if (cause instanceof BinanceHistoricalTradesError) {
            bump("aggtrades-fetch-failed");
            continue;
          }
          throw cause;
        }
        if (trades.length === 0) {
          bump("no-real-trades-in-window");
          continue;
        }

        const rawEvidence: RawMicrostructureEvidence = {
          bid: { state: "not_supported_by_provider", reason: "Binance's public REST API has no historical order-book endpoint - depth is only available for the current live snapshot." },
          ask: { state: "not_supported_by_provider", reason: "Binance's public REST API has no historical order-book endpoint - depth is only available for the current live snapshot." },
          bidLevels: { state: "not_supported_by_provider", reason: "Historical order-book levels do not exist in Binance's public API at any retention tier." },
          askLevels: { state: "not_supported_by_provider", reason: "Historical order-book levels do not exist in Binance's public API at any retention tier." },
          trades: {
            state: "available",
            value: trades.map((t) => ({ price: t.price, quantity: t.quantity, timestamp: t.timestamp, aggressorSide: { state: "available", value: t.aggressorSide } })),
          },
          sequenceId: { state: "not_supported_by_provider", reason: "Historical aggTrades carry an aggregate trade ID, not the live order-book's lastUpdateId sequence concept." },
        };
        const raw: RawMicrostructureResult = {
          symbol,
          provider: "binance",
          assetClass: "crypto",
          // The query's own end boundary (createdAt), never the last real
          // trade's own timestamp - this snapshot was deliberately built
          // "as of" createdAt, so that IS its reading time by construction
          // (the individual trades inside the lookback window feed the
          // volume-delta computation; they don't individually define the
          // snapshot's own freshness). Using the last trade's timestamp
          // instead would make freshness depend on how recently a trade
          // happened to print, which is a real, honest bug this sprint's
          // own real-data run caught: it made every single historical
          // observation read "stale" whenever the most recent trade before
          // createdAt was more than the crypto freshness threshold away,
          // even though the reading itself is genuinely current as of the
          // moment being studied.
          timestamp: new Date(createdAtMs).toISOString(),
          retrievedAt: new Date(createdAtMs).toISOString(),
          evidence: rawEvidence,
        };
        // nowMs = the hypothesis's own real creation time (never the
        // research run's wall-clock "today") - freshness is evaluated
        // relative to the moment being studied, exactly like the
        // production pipeline evaluates it relative to a live request.
        const microstructureSnapshot = buildMicrostructureSnapshot(raw, createdAtMs);

        for (const hypothesis of snapshot.hypotheses) {
          const evidence = assessMicrostructureEvidence(microstructureSnapshot, hypothesis, row.createdAt.toISOString());
          observations.push({
            analysisRunId: row.id,
            hypothesisId: hypothesis.id,
            symbol,
            timeframe: row.timeframe as HistoricalMicrostructureObservation["timeframe"],
            provider: "binance",
            observedAt: row.createdAt.toISOString(),
            hypothesisType: hypothesis.type,
            hypothesisDirection: evidence.hypothesisDirection ?? "neutral",
            regimeType: hypothesis.regimeContext.regimeType,
            volatilityBand: snapshot.marketState?.structure?.volatilityBand,
            creationPrice,
            snapshot: microstructureSnapshot,
            evidence,
          });
        }
      }
    }

    return { observations, rejected, runsConsidered };
  }
}
