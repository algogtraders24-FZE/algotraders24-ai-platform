// app/r/[code]/route.ts
// Referral link: algotraders24.ai/r/<CODE>. Remembers who sent the visitor (a first-party cookie set by the server) and sends
// them to the home page. Public on purpose. It does NOT credit anything: the sale is attributed server-side at
// checkout, where the code is looked up again and checked (real partner, Pro + KYC, not the buyer). A bad code is ignored
// quietly and the visitor still lands on the page, so a code can never be used to probe which ones exist.
import { NextResponse } from "next/server";
import { REF_COOKIE, REF_COOKIE_MAX_AGE_SECONDS, REFERRAL_LANDING_PATH, normalizeReferralCode } from "@/lib/rewards/referral";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const code = normalizeReferralCode(segments[1]);
  const res = NextResponse.redirect(new URL(REFERRAL_LANDING_PATH, req.url), 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  if (code) {
    res.cookies.set(REF_COOKIE, code, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: REF_COOKIE_MAX_AGE_SECONDS,
    });
  }
  return res;
}
