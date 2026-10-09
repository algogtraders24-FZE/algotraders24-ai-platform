// app/api/identity/v1/didit/route.ts
// Didit webhook: the verdict of a seller's identity check. Outside /api/private on purpose (the caller is Didit, not a browser).
// The signature and the timestamp are checked against the RAW body before anything is parsed or stored.
// Answers fast and with 200 for events we do not act on, so Didit does not keep retrying them.
import { applyVerdict } from "@/services/marketplace/identityStore";
import { diditVerdict, verifyDiditWebhook } from "@/lib/marketplace/didit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.DIDIT_WEBHOOK_SECRET;
  if (!secret || secret.length < 8) return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 200_000) return Response.json({ ok: false, code: "TOO_LARGE" }, { status: 413 });
  const ok = verifyDiditWebhook(
    raw,
    { signature: request.headers.get("x-signature"), signatureV2: request.headers.get("x-signature-v2"), timestamp: request.headers.get("x-timestamp") },
    secret,
  );
  if (!ok) return Response.json({ ok: false, code: "BAD_SIGNATURE" }, { status: 401 });
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ ok: true, ignored: "not json" });
  }
  const verdict = diditVerdict(payload);
  if (!verdict) return Response.json({ ok: true, ignored: "not a finished decision" });
  const result = await applyVerdict(verdict);
  return Response.json({ ok: true, result });
}

export const GET = () => Response.json({ ok: false, code: "METHOD" }, { status: 405, headers: { allow: "POST" } });
