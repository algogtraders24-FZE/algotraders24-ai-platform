// app/api/arena/ingest/route.ts
// Receives AT24 Arena data from the paper-trading bot on the owner's VPS. Public URL, but every request must carry
// "Authorization: Bearer <ARENA_INGEST_SECRET>" (constant-time check). With no secret configured the endpoint is closed (503).
// Two kinds of message, both paper results only (never keys), size-capped and shape-checked:
//   {kind:"full", payload}  after every hourly cycle (agents, activity, equity history, positions, radar ...)
//   {kind:"live", live}     every ~15 s: prices, mark-to-market equity, position P&L, rolling 1h volume (small)
// Only admins can read it back (/api/private/admin/arena).
import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
const MAX_FULL = 600_000;
const MAX_LIVE = 60_000;

const digest = (s: string) => createHash("sha256").update(s).digest();
const bad = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  const secret = process.env.ARENA_INGEST_SECRET;
  if (!secret) return bad("not configured", 503);
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !timingSafeEqual(digest(given), digest(secret))) return bad("unauthorized", 401);

  const raw = await req.text();
  if (raw.length > MAX_FULL) return bad("payload too large", 413);
  let msg: { kind?: unknown; payload?: unknown; live?: unknown } | null;
  try {
    msg = JSON.parse(raw);
  } catch {
    return bad("invalid json", 400);
  }
  if (!msg || typeof msg !== "object") return bad("unexpected shape", 422);

  try {
    if (msg.kind === "live") {
      const live = msg.live as { ts?: unknown; arms?: unknown } | null;
      if (raw.length > MAX_LIVE || !live || typeof live !== "object" || typeof live.arms !== "object" || live.arms === null) return bad("unexpected live shape", 422);
      await prisma.arenaSnapshot.upsert({
        where: { id: "main" },
        create: { id: "main", payload: { ready: false }, live: live as object, liveAt: new Date() },
        update: { live: live as object, liveAt: new Date() },
      });
      return NextResponse.json({ ok: true });
    }
    if (msg.kind === "full") {
      const p = msg.payload as { ready?: unknown; arms?: unknown; last_bar?: unknown } | null;
      if (!p || typeof p !== "object" || p.ready !== true || typeof p.arms !== "object" || p.arms === null) return bad("unexpected shape", 422);
      const lastBar = typeof p.last_bar === "string" ? p.last_bar.slice(0, 40) : null;
      await prisma.arenaSnapshot.upsert({
        where: { id: "main" },
        create: { id: "main", payload: p as object, lastBar },
        update: { payload: p as object, lastBar, receivedAt: new Date() },
      });
      return NextResponse.json({ ok: true });
    }
    return bad("unknown kind", 422);
  } catch {
    return bad("storage unavailable", 503);
  }
}
