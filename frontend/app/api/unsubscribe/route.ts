// app/api/unsubscribe/route.ts
// Public (no login): opt a user out of product-update emails. The link carries the user id and an HMAC signature, so it only works
// for the person the email was sent to. POST is what mail clients call for the one-click List-Unsubscribe header (RFC 8058) and what
// the /unsubscribe page's button calls. GET is deliberately NOT an opt-out: mail scanners pre-fetch links, and a pre-fetch must not
// unsubscribe anyone - GET only reports whether the link is valid.
import { NextResponse } from "next/server";
import { recordOptOut, verifyUnsubscribeToken } from "@/services/announcements/service";

export const dynamic = "force-dynamic";

function params(req: Request): { u: string; t: string } | null {
  const url = new URL(req.url);
  const u = url.searchParams.get("u") ?? "";
  const t = url.searchParams.get("t") ?? "";
  return u && t && u.length < 64 && t.length < 128 ? { u, t } : null;
}

export async function GET(req: Request) {
  const p = params(req);
  return NextResponse.json({ valid: !!p && verifyUnsubscribeToken(p.u, p.t) });
}

export async function POST(req: Request) {
  const p = params(req);
  if (!p || !verifyUnsubscribeToken(p.u, p.t)) return NextResponse.json({ ok: false, error: "Invalid or expired link" }, { status: 400 });
  try {
    await recordOptOut(p.u);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not save - please reply to the email with the word unsubscribe" }, { status: 503 });
  }
}
