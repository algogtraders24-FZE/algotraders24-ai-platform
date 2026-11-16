// services/arena-fx/tracker.ts
// The daily job of the AI Arena, called from the existing 5-minute sweep (app/api/live-sync/v1/sweep). Best effort: nothing here throws to the sweep.
//  1. On weekdays from 14:00 UTC, once a day, take a decision-time snapshot of every open market (the Swing Lab map: price, ATR, trends, levels).
//  2. For each AI contestant not yet run today, show it the table, parse its answer with code, store its positions and log the call.
// Decoys and the rule contestant are computed from the snapshots when the board is read, so they cost nothing.
// Cost: two calls a day, a few thousand tokens each. Set ARENA_FX_AI_DISABLED=1 to stop the AI calls; the snapshots keep running.
import "server-only";
import { prisma } from "@/lib/prisma";
import { SWING_INSTRUMENTS, getSwingInstrument } from "@/types/swing-lab";
import { marketOpen } from "@/services/swing-lab/scoreboard";
import { getSwingMapOverview } from "@/services/swing-lab/swing-lab.service";
import { SYSTEM_PROMPT, buildUserPrompt, parseDecisions, type MapFeatures, type PromptMarket } from "./ai";
import { callClaude } from "./ai-client";

export const AI_CONTESTANTS = [
  { id: "ai-haiku", label: "Claude Haiku 5.5", model: "claude-haiku-5-5" },
  { id: "ai-sonnet", label: "Claude Sonnet 5.5", model: "claude-sonnet-5-5" },
] as const;

const DECISION_HOUR_UTC = 14;
const LAST_HOUR_UTC = 21;
const MIN_MARKETS = 12;
const RETRY_AFTER_MS = 20 * 60_000;

export interface ArenaTrackerResult {
  snapshots: number;
  aiRuns: number;
}

let lastSnapshotAttempt = 0;

async function takeSnapshots(now: Date, dayKey: string): Promise<number> {
  const done = await prisma.arenaFxRun.findUnique({ where: { dayKey_contestant: { dayKey, contestant: "snapshot" } } });
  if (done) return 0;
  if (now.getTime() - lastSnapshotAttempt < 10 * 60_000) return 0;
  lastSnapshotAttempt = now.getTime();
  const overview = await getSwingMapOverview();
  let n = 0;
  for (const r of overview.rows) {
    if (r.status !== "ok" || !marketOpen(r.data.asOfBar, now.getTime())) continue;
    const d = r.data;
    const features: MapFeatures = {
      w1: d.w1,
      d1: d.d1,
      h4: d.h4,
      resistance: d.resistance ? { pct: d.resistance.distancePct, atr: d.resistance.distanceAtr } : null,
      support: d.support ? { pct: d.support.distancePct, atr: d.support.distanceAtr } : null,
      rangePos: d.rangePosPct,
    };
    try {
      await prisma.arenaFxSnapshot.create({ data: { dayKey, symbol: r.symbol, price: d.price, atrPct: d.atrPct, alignment: d.alignment, features: features as unknown as object } });
      n += 1;
    } catch {
      /* already stored */
    }
  }
  if (n >= MIN_MARKETS || now.getUTCHours() >= LAST_HOUR_UTC) await prisma.arenaFxRun.create({ data: { dayKey, contestant: "snapshot", status: n >= MIN_MARKETS ? "ok" : "failed" } }).catch(() => undefined);
  return n;
}

async function runAi(now: Date, dayKey: string): Promise<number> {
  if (process.env.ARENA_FX_AI_DISABLED === "1") return 0;
  const snaps = await prisma.arenaFxSnapshot.findMany({ where: { dayKey } });
  if (snaps.length < MIN_MARKETS) return 0;
  const order = new Map(SWING_INSTRUMENTS.map((i, idx) => [i.symbol, idx]));
  const markets: PromptMarket[] = snaps
    .sort((a, b) => (order.get(a.symbol) ?? 99) - (order.get(b.symbol) ?? 99))
    .map((s) => ({ symbol: s.symbol, label: getSwingInstrument(s.symbol)?.label ?? s.symbol, price: s.price, atrPct: s.atrPct, alignment: s.alignment, features: s.features as unknown as MapFeatures }));
  const prompt = buildUserPrompt(now.toISOString(), markets);
  const symbols = markets.map((m) => m.symbol);
  let n = 0;
  for (const c of AI_CONTESTANTS) {
    const prev = await prisma.arenaFxRun.findUnique({ where: { dayKey_contestant: { dayKey, contestant: c.id } } });
    if (prev && (prev.status === "ok" || now.getTime() - prev.createdAt.getTime() < RETRY_AFTER_MS)) continue;
    const res = await callClaude(c.model, SYSTEM_PROMPT, prompt);
    const parsed = res.ok ? parseDecisions(res.text, symbols) : null;
    const status = parsed ? "ok" : "failed";
    const error = parsed ? (parsed.missing.length > 0 ? `${parsed.missing.length} markets not answered (set flat)` : null) : res.error ?? "unusable answer";
    if (parsed) {
      await prisma.arenaFxDecision.createMany({ data: parsed.decisions.map((d) => ({ dayKey, symbol: d.symbol, contestant: c.id, position: d.position, reason: d.reason })), skipDuplicates: true });
      n += 1;
    }
    const data = { status, model: c.model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, error, createdAt: now };
    await prisma.arenaFxRun.upsert({ where: { dayKey_contestant: { dayKey, contestant: c.id } }, create: { dayKey, contestant: c.id, ...data }, update: data });
  }
  return n;
}

export async function runArenaTracker(now: Date = new Date()): Promise<ArenaTrackerResult> {
  const out: ArenaTrackerResult = { snapshots: 0, aiRuns: 0 };
  const dow = now.getUTCDay();
  const hour = now.getUTCHours();
  if (dow === 0 || dow === 6 || hour < DECISION_HOUR_UTC || hour > LAST_HOUR_UTC) return out;
  const dayKey = now.toISOString().slice(0, 10);
  try {
    out.snapshots = await takeSnapshots(now, dayKey);
  } catch {
    /* skip the step */
  }
  try {
    out.aiRuns = await runAi(now, dayKey);
  } catch {
    /* skip the step */
  }
  return out;
}
