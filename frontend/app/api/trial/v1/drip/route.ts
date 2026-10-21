// app/api/trial/v1/drip/route.ts
// Daily job (Vercel Cron, Authorization: Bearer <CRON_SECRET>): sends the trial reminder emails that are due (D7, D24, D31).
// Outside /api/private on purpose: bearer secret only, never a browser session. Idempotent - a step is claimed before it is sent.
import { isValidCronSecret } from "@/lib/intelligence/cron-auth";
import { runTrialDrip } from "@/services/trial/trialEmails";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function handle(request: Request): Promise<Response> {
  if (!isValidCronSecret(request)) return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  const r = await runTrialDrip();
  return Response.json({ ok: true, ...r }, { headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
