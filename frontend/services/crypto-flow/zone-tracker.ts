// services/crypto-flow/zone-tracker.ts
// The timer side of Flow Zones, called from the existing 5-minute sweep (app/api/live-sync/v1/sweep):
//  1. once an hour per instrument, record the 24-hour zones (the forward scoreboard's input);
//  2. score open snapshots against the 5-minute bars that really followed (rules: scoreboard.ts);
//  3. send members who subscribed a Telegram message when price reaches a zone of the latest snapshot.
// Best effort: every step is isolated, nothing here throws to the sweep, and a Binance or database failure just skips the step.
import "server-only";
import { prisma } from "@/lib/prisma";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { CRYPTO_FLOW_INSTRUMENTS, getCryptoFlowInstrument, getCryptoFlowLookback } from "@/types/crypto-flow";
import { fetchBinanceKlines } from "./binance.provider";
import { computeFlowZones, parseZoneBars, type ZoneBar } from "./zones";
import { evaluateSnapshot, firstTouchIndex, shouldAlert, typicalHourRangePct, type SnapshotZones, type ZoneSide } from "./scoreboard";

const BAR_MS = 5 * 60_000;
const MAX_FETCH_BARS = 1000;
/** Snapshots older than this are not used for alerts. */
const ALERT_SNAPSHOT_MAX_AGE_MS = 2 * 3_600_000;
const MAX_OPEN_AGE_MS = 72 * 3_600_000;

export interface TrackerResult {
  snapshots: number;
  evaluated: number;
  alertsSent: number;
}

function hourKeyOf(d: Date): string {
  return d.toISOString().slice(0, 13);
}

function fmtPrice(v: number): string {
  const digits = v >= 100 ? 2 : v >= 1 ? 3 : 5;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

async function snapshotHour(now: Date): Promise<number> {
  const cfg = getCryptoFlowLookback("24h");
  if (!cfg) return 0;
  const key = hourKeyOf(now);
  const have = new Set((await prisma.flowZoneObservation.findMany({ where: { hourKey: key }, select: { symbol: true } })).map((r) => r.symbol));
  const todo = CRYPTO_FLOW_INSTRUMENTS.filter((i) => !have.has(i.symbol));
  const settled = await Promise.allSettled(
    todo.map(async (inst) => {
      const rows = await fetchBinanceKlines(inst.symbol, inst.market, fetch, cfg.interval, cfg.bars + 1);
      const z = computeFlowZones(inst.symbol, rows, null, now.getTime(), "", cfg);
      if (!z || z.thin) return false;
      const bars = parseZoneBars(rows, now.getTime());
      const x = typicalHourRangePct(bars);
      if (x === null || !(x > 0)) return false;
      await prisma.flowZoneObservation.create({
        data: {
          symbol: inst.symbol,
          hourKey: key,
          barTime: new Date(z.asOf),
          price: z.lastPrice,
          stepPct: z.stepPct,
          xRangePct: x,
          buyerPrice: z.buyerZone?.price ?? null,
          sellerPrice: z.sellerZone?.price ?? null,
          pocPrice: z.poc?.price ?? null,
        },
      });
      return true;
    }),
  );
  return settled.filter((r) => r.status === "fulfilled" && r.value === true).length;
}

type Obs = { id: string; symbol: string; barTime: Date; price: number; stepPct: number; xRangePct: number; buyerPrice: number | null; sellerPrice: number | null };

const snap = (o: Obs): SnapshotZones => ({ price: o.price, stepPct: o.stepPct, xRangePct: o.xRangePct, buyerPrice: o.buyerPrice, sellerPrice: o.sellerPrice });

/** Closed 5-minute bars after `from` (open time, exclusive) for one instrument. */
async function barsAfter(symbol: string, from: Date, nowMs: number): Promise<ZoneBar[]> {
  const inst = getCryptoFlowInstrument(symbol);
  if (!inst) return [];
  const rows = await fetchBinanceKlines(inst.symbol, inst.market, fetch, "5m", MAX_FETCH_BARS, from.getTime() + BAR_MS);
  return parseZoneBars(rows, nowMs).filter((b) => b.t > from.getTime());
}

export async function runFlowZoneTracker(now: Date = new Date()): Promise<TrackerResult> {
  const out: TrackerResult = { snapshots: 0, evaluated: 0, alertsSent: 0 };
  try {
    out.snapshots = await snapshotHour(now);
  } catch {
    /* skip the step */
  }

  try {
    const open = await prisma.flowZoneObservation.findMany({
      where: { status: "open", barTime: { lte: new Date(now.getTime() - 30 * 60_000) } },
      orderBy: { barTime: "asc" },
      take: 400,
    });
    const subs = await prisma.flowZoneAlertSub.findMany({ take: 2000 });
    const alertSymbols = [...new Set(subs.map((s) => s.symbol))];
    const latestForAlert = new Map<string, Obs>();
    if (alertSymbols.length > 0) {
      const recent = await prisma.flowZoneObservation.findMany({
        where: { symbol: { in: alertSymbols }, createdAt: { gte: new Date(now.getTime() - ALERT_SNAPSHOT_MAX_AGE_MS) } },
        orderBy: { createdAt: "desc" },
      });
      for (const o of recent) if (!latestForAlert.has(o.symbol)) latestForAlert.set(o.symbol, o);
    }
    const from = new Map<string, Date>();
    const need = (symbol: string, t: Date) => {
      const cur = from.get(symbol);
      if (!cur || t < cur) from.set(symbol, t);
    };
    for (const o of open) need(o.symbol, o.barTime);
    for (const o of latestForAlert.values()) need(o.symbol, o.barTime);
    const barsBySymbol = new Map<string, ZoneBar[]>();
    await Promise.allSettled(
      [...from.entries()].map(async ([symbol, t]) => {
        barsBySymbol.set(symbol, await barsAfter(symbol, t, now.getTime()));
      }),
    );

    // 2. score open snapshots
    for (const o of open) {
      const all = barsBySymbol.get(o.symbol);
      if (!all) continue;
      const after = all.filter((b) => b.t > o.barTime.getTime());
      const ev = evaluateSnapshot(snap(o), after);
      if (ev.state === "pending") {
        if (now.getTime() - o.barTime.getTime() > MAX_OPEN_AGE_MS) await prisma.flowZoneObservation.update({ where: { id: o.id }, data: { status: "done", evaluatedAt: now } }).catch(() => undefined);
        continue;
      }
      await prisma.flowZoneObservation
        .update({
          where: { id: o.id },
          data: {
            status: "done",
            evaluatedAt: now,
            buyerTouchAt: ev.buyer.touchAt === null ? null : new Date(ev.buyer.touchAt),
            buyerR: ev.buyer.r,
            sellerTouchAt: ev.seller.touchAt === null ? null : new Date(ev.seller.touchAt),
            sellerR: ev.seller.r,
          },
        })
        .then(() => {
          out.evaluated += 1;
        })
        .catch(() => undefined);
    }

    // 3. Telegram alerts
    for (const sub of subs) {
      const o = latestForAlert.get(sub.symbol);
      const all = barsBySymbol.get(sub.symbol);
      if (!o || !all) continue;
      const after = all.filter((b) => b.t > o.barTime.getTime());
      const inst = getCryptoFlowInstrument(sub.symbol);
      if (!inst) continue;
      for (const side of ["buyer", "seller"] as ZoneSide[]) {
        const zone = side === "buyer" ? o.buyerPrice : o.sellerPrice;
        if (zone === null) continue;
        const k = firstTouchIndex(side, snap(o), after);
        if (k < 0) continue;
        const lastObsId = side === "buyer" ? sub.lastBuyerObsId : sub.lastSellerObsId;
        const lastAt = side === "buyer" ? sub.lastBuyerAt : sub.lastSellerAt;
        const send = shouldAlert({ touchBarOpenMs: after[k].t, nowMs: now.getTime(), obsId: o.id, lastObsId, lastAtMs: lastAt ? lastAt.getTime() : null });
        if (lastObsId === o.id) continue;
        let sent = false;
        if (send) {
          const last = after[after.length - 1].close;
          const text =
            `AT24 Flow Zones - ${inst.short}\n` +
            `Price reached the ${side} zone ${fmtPrice(zone)} (24h buyer/seller volume profile, taken ${o.barTime.toISOString().slice(11, 16)} UTC).\n` +
            `Last price ${fmtPrice(last)}.\n` +
            `Context, not a signal: zones can fail. https://www.algotraders24.ai/dashboard/crypto-flow`;
          sent = await sendTelegramToUser(sub.userId, "alerts", text);
        }
        const data = side === "buyer" ? { lastBuyerObsId: o.id, ...(sent ? { lastBuyerAt: now } : {}) } : { lastSellerObsId: o.id, ...(sent ? { lastSellerAt: now } : {}) };
        await prisma.flowZoneAlertSub.update({ where: { id: sub.id }, data }).catch(() => undefined);
        if (sent) out.alertsSent += 1;
      }
    }
  } catch {
    /* skip the step */
  }
  return out;
}
