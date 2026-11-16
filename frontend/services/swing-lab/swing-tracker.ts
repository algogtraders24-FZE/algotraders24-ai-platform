// services/swing-lab/swing-tracker.ts
// The timer side of the Swing Lab forward scoreboard, called from the existing 5-minute sweep (app/api/live-sync/v1/sweep):
//  1. once per UTC day and market, record the trend alignment (the map state) while the market is open;
//  2. score snapshots that are 5 days old against the 4-hour bars that really followed (rules: scoreboard.ts).
// Best effort: every step is isolated, nothing throws to the sweep, and a bridge or database failure just skips the step.
// Bridge load is kept small: snapshots are attempted at most every 30 minutes and never on Saturday or Sunday; scoring fetches one
// market only when it has a snapshot that is due.
import "server-only";
import { prisma } from "@/lib/prisma";
import { SWING_INSTRUMENTS } from "@/types/swing-lab";
import type { Bar } from "./compute";
import { BAR_4H_MS, FORWARD_MS, forwardClose, marketOpen, scoreSnapshot } from "./scoreboard";
import { fetchClosedBars, getSwingMapOverview } from "./swing-lab.service";

const SNAPSHOT_RETRY_MS = 30 * 60_000;
const MAX_DUE_PER_RUN = 120;
/** Four-hour bars fetched for scoring: 220 bars = 36 days, enough to find the bar 5 days after any snapshot that is not badly late. */
const SCORING_BARS = 220;
/** A snapshot older than this that still cannot be scored (bridge never had the bars) is closed without a result. */
const GIVE_UP_MS = 30 * 86_400_000;

export interface SwingTrackerResult {
  snapshots: number;
  evaluated: number;
}

let lastSnapshotAttempt = 0;

async function snapshotDay(now: Date): Promise<number> {
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) return 0;
  if (now.getTime() - lastSnapshotAttempt < SNAPSHOT_RETRY_MS) return 0;
  const dayKey = now.toISOString().slice(0, 10);
  const have = new Set((await prisma.swingLabObservation.findMany({ where: { dayKey }, select: { symbol: true } })).map((r) => r.symbol));
  if (have.size >= SWING_INSTRUMENTS.length) return 0;
  lastSnapshotAttempt = now.getTime();
  const overview = await getSwingMapOverview();
  let n = 0;
  for (const r of overview.rows) {
    if (r.status !== "ok" || have.has(r.symbol) || !marketOpen(r.data.asOfBar, now.getTime())) continue;
    try {
      await prisma.swingLabObservation.create({
        data: { symbol: r.symbol, dayKey, barTime: new Date(r.data.asOfBar), price: r.data.price, atrPct: r.data.atrPct, alignment: r.data.alignment },
      });
      n += 1;
    } catch {
      /* a concurrent run already stored this market for today */
    }
  }
  return n;
}

async function scoreDue(now: Date): Promise<number> {
  const dueBefore = new Date(now.getTime() - FORWARD_MS - 2 * BAR_4H_MS);
  const due = await prisma.swingLabObservation.findMany({ where: { status: "open", barTime: { lte: dueBefore } }, orderBy: { barTime: "asc" }, take: MAX_DUE_PER_RUN });
  if (due.length === 0) return 0;
  const bySymbol = new Map<string, typeof due>();
  for (const o of due) bySymbol.set(o.symbol, [...(bySymbol.get(o.symbol) ?? []), o]);
  let n = 0;
  for (const [symbol, list] of bySymbol) {
    let bars: Bar[];
    try {
      bars = await fetchClosedBars(symbol, "4h", SCORING_BARS, now.getTime());
    } catch {
      continue; // try again on a later sweep
    }
    for (const o of list) {
      const priceTime = o.barTime.getTime() + BAR_4H_MS;
      const fwd = forwardClose(bars, priceTime + FORWARD_MS);
      if (fwd === null) {
        if (now.getTime() - o.barTime.getTime() > GIVE_UP_MS) await prisma.swingLabObservation.update({ where: { id: o.id }, data: { status: "done", evaluatedAt: now } }).catch(() => undefined);
        continue;
      }
      const s = scoreSnapshot({ alignment: o.alignment as "aligned up" | "aligned down" | "mixed", price: o.price, atrPct: o.atrPct }, fwd);
      await prisma.swingLabObservation
        .update({ where: { id: o.id }, data: { status: "done", evaluatedAt: now, fwdPrice: fwd, rawAtr: s.rawAtr, r: s.r } })
        .then(() => {
          n += 1;
        })
        .catch(() => undefined);
    }
  }
  return n;
}

export async function runSwingTracker(now: Date = new Date()): Promise<SwingTrackerResult> {
  const out: SwingTrackerResult = { snapshots: 0, evaluated: 0 };
  try {
    out.snapshots = await snapshotDay(now);
  } catch {
    /* skip the step */
  }
  try {
    out.evaluated = await scoreDue(now);
  } catch {
    /* skip the step */
  }
  return out;
}
