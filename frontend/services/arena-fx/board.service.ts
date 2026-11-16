// services/arena-fx/board.service.ts
// Reads the snapshots and the AI decisions and builds the arena board (pure rules: engine.ts). Admin use.
import "server-only";
import { prisma } from "@/lib/prisma";
import type { SwingAlignment } from "@/types/swing-lab";
import { buildArena, trendPosition, type ArenaBoard, type ContestantInput, type Pos, type SnapRow } from "./engine";
import { AI_CONTESTANTS } from "./tracker";

const WINDOW_DAYS = 150;

export interface ArenaFxResponse extends ArenaBoard {
  /** The latest decisions of every AI contestant, for display. */
  latest: Array<{ contestant: string; dayKey: string; decisions: Array<{ symbol: string; position: number; reason: string | null }> }>;
  /** Token use over the window per AI contestant, and run problems. */
  usage: Array<{ contestant: string; runs: number; failed: number; inputTokens: number; outputTokens: number }>;
  aiEnabled: boolean;
}

export async function getArenaFx(now: Date = new Date()): Promise<ArenaFxResponse> {
  const from = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [snapRows, decisions, runs] = await Promise.all([
    prisma.arenaFxSnapshot.findMany({ where: { dayKey: { gte: from } }, select: { dayKey: true, symbol: true, price: true, atrPct: true, alignment: true } }),
    prisma.arenaFxDecision.findMany({ where: { dayKey: { gte: from } }, select: { dayKey: true, symbol: true, contestant: true, position: true, reason: true } }),
    prisma.arenaFxRun.findMany({ where: { dayKey: { gte: from }, contestant: { not: "snapshot" } }, select: { dayKey: true, contestant: true, status: true, inputTokens: true, outputTokens: true } }),
  ]);
  const snaps: SnapRow[] = snapRows.map((s) => ({ dayKey: s.dayKey, symbol: s.symbol, price: s.price, atrPct: s.atrPct, alignment: s.alignment as SwingAlignment }));
  const contestants: ContestantInput[] = [{ id: "rule-trend", label: "Rule: follow the map alignment", kind: "rule", positionOf: (s) => trendPosition(s.alignment) }];
  for (const c of AI_CONTESTANTS) {
    const map = new Map(decisions.filter((d) => d.contestant === c.id).map((d) => [`${d.dayKey}|${d.symbol}`, (d.position === 1 ? 1 : d.position === -1 ? -1 : 0) as Pos]));
    const active = new Set(runs.filter((r) => r.contestant === c.id && r.status === "ok").map((r) => r.dayKey));
    contestants.push({ id: c.id, label: c.label, kind: "ai", positionOf: (s) => map.get(`${s.dayKey}|${s.symbol}`) ?? 0, activeDays: active });
  }
  const board = buildArena(snaps, contestants);
  const latest = AI_CONTESTANTS.map((c) => {
    const mine = decisions.filter((d) => d.contestant === c.id);
    const day = mine.reduce((m, d) => (d.dayKey > m ? d.dayKey : m), "");
    return { contestant: c.id, dayKey: day, decisions: mine.filter((d) => d.dayKey === day).map((d) => ({ symbol: d.symbol, position: d.position, reason: d.reason })) };
  });
  const usage = AI_CONTESTANTS.map((c) => {
    const mine = runs.filter((r) => r.contestant === c.id);
    return { contestant: c.id, runs: mine.length, failed: mine.filter((r) => r.status !== "ok").length, inputTokens: mine.reduce((s, r) => s + (r.inputTokens ?? 0), 0), outputTokens: mine.reduce((s, r) => s + (r.outputTokens ?? 0), 0) };
  });
  return { ...board, latest, usage, aiEnabled: process.env.ARENA_FX_AI_DISABLED !== "1" && !!process.env.ANTHROPIC_API_KEY };
}
