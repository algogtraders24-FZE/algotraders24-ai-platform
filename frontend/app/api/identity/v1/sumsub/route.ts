// app/api/identity/v1/sumsub/route.ts
// Sumsub webhook: the verdict of a seller's identity check. Outside /api/private on purpose (the caller is Sumsub, not a browser).
// The signature is checked against the RAW body before anything is parsed or stored; only `applicantReviewed` events are acted on.
// Always answers fast: Sumsub gives up after 10 s and retries any non-2xx (401/403/404 are treated as permanent failures).
import { applyVerdict } from "@/services/marketplace/identityStore";
import { verdictFromWebhook, verifyWebhookSignature } from "@/lib/marketplace/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SUMSUB_WEBHOOK_SECRET;
  if (!secret || secret.length < 8) return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 100_000) return Response.json({ ok: false, code: "TOO_LARGE" }, { status: 413 });
  if (!verifyWebhookSignature(raw, request.headers.get("x-payload-digest"), request.headers.get("x-payload-digest-alg"), secret)) {
    return Response.json({ ok: false, code: "BAD_SIGNATURE" }, { status: 401 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ ok: true, ignored: "not json" });
  }
  const verdict = verdictFromWebhook(payload);
  if (!verdict) return Response.json({ ok: true, ignored: "not a finished review" });
  const result = await applyVerdict(verdict);
  return Response.json({ ok: true, result });
}

export const GET = () => Response.json({ ok: false, code: "METHOD" }, { status: 405, headers: { allow: "POST" } });
