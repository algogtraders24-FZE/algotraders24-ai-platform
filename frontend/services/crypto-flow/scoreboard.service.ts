// services/crypto-flow/scoreboard.service.ts
// Reads the scored Flow Zones snapshots from the database and builds the scoreboard (pure rules: scoreboard.ts).
import "server-only";
import { prisma } from "@/lib/prisma";
import { buildScoreboard, type ScoreboardResult, type ScoredEvent, type ZoneSide } from "./scoreboard";

const WINDOW_MS = 90 * 86_400_000;

export interface FlowZoneScoreboardResponse extends ScoreboardResult {
  /** Earliest snapshot in the data, ISO string, or null when nothing was recorded yet. */
  since: string | null;
}

export async function getFlowZoneScoreboard(now: Date = new Date()): Promise<FlowZoneScoreboardResponse> {
  const from = new Date(now.getTime() - WINDOW_MS);
  const [done, open, first] = await Promise.all([
    prisma.flowZoneObservation.findMany({
      where: { status: "done", createdAt: { gte: from } },
      select: { symbol: true, buyerTouchAt: true, buyerR: true, sellerTouchAt: true, sellerR: true, buyerPrice: true, sellerPrice: true },
    }),
    prisma.flowZoneObservation.count({ where: { status: "open" } }),
    prisma.flowZoneObservation.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const events: ScoredEvent[] = [];
  const untouched: Array<{ symbol: string; side: ZoneSide }> = [];
  for (const o of done) {
    if (o.buyerPrice !== null) {
      if (o.buyerTouchAt && o.buyerR !== null) events.push({ symbol: o.symbol, side: "buyer", touchAt: o.buyerTouchAt.getTime(), r: o.buyerR });
      else untouched.push({ symbol: o.symbol, side: "buyer" });
    }
    if (o.sellerPrice !== null) {
      if (o.sellerTouchAt && o.sellerR !== null) events.push({ symbol: o.symbol, side: "seller", touchAt: o.sellerTouchAt.getTime(), r: o.sellerR });
      else untouched.push({ symbol: o.symbol, side: "seller" });
    }
  }
  return { ...buildScoreboard(events, untouched, open, done.length), since: first ? first.createdAt.toISOString() : null };
}
