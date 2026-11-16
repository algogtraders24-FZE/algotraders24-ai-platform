// services/swing-lab/scoreboard.service.ts
// Reads the scored Swing Lab snapshots from the database and builds the scoreboard (pure rules: scoreboard.ts).
import "server-only";
import { prisma } from "@/lib/prisma";
import type { SwingAlignment } from "@/types/swing-lab";
import { BAR_4H_MS, buildSwingBoard, type SwingBoard } from "./scoreboard";

const WINDOW_MS = 180 * 86_400_000;

export interface SwingScoreboardResponse extends SwingBoard {
  /** Earliest snapshot, ISO string, or null when nothing was recorded yet. */
  since: string | null;
}

export async function getSwingScoreboard(now: Date = new Date()): Promise<SwingScoreboardResponse> {
  const from = new Date(now.getTime() - WINDOW_MS);
  const [done, open, first] = await Promise.all([
    prisma.swingLabObservation.findMany({ where: { status: "done", rawAtr: { not: null }, createdAt: { gte: from } }, select: { symbol: true, alignment: true, barTime: true, rawAtr: true, r: true } }),
    prisma.swingLabObservation.count({ where: { status: "open" } }),
    prisma.swingLabObservation.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const snaps = done.map((o) => ({ symbol: o.symbol, alignment: o.alignment as SwingAlignment, at: o.barTime.getTime() + BAR_4H_MS, rawAtr: o.rawAtr as number, r: o.r }));
  return { ...buildSwingBoard(snaps, open), since: first ? first.createdAt.toISOString() : null };
}
