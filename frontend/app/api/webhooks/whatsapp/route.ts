// app/api/webhooks/whatsapp/route.ts
// WhatsApp Cloud API webhook for the AT24 support bot. Public URL, protected by Meta's HMAC signature
// (X-Hub-Signature-256, checked against WHATSAPP_APP_SECRET on the RAW body). GET is Meta's one-time verify handshake.
// Dormant (503) until WHATSAPP_ENABLED=true and the Meta credentials are set. A genuine call always gets 200 so Meta
// does not retry; the bot answers from the public support knowledge base only (see services/whatsapp/webhook.ts).
import { whatsappConfig } from "@/services/whatsapp/config";
import { createWhatsAppClient } from "@/services/whatsapp/client";
import { signatureValid, verifyHandshake } from "@/services/whatsapp/signature";
import { handleWhatsAppPayload } from "@/services/whatsapp/webhook";
import { telegramConfig } from "@/services/telegram/config";
import { createTelegramClient, escapeHtml } from "@/services/telegram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY = 200_000;

export async function GET(request: Request): Promise<Response> {
  const cfg = whatsappConfig();
  const challenge = verifyHandshake(new URL(request.url).searchParams, cfg.verifyToken);
  if (challenge === null) return new Response("forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const cfg = whatsappConfig();
  if (!cfg.enabled) return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  const raw = await request.text().catch(() => "");
  if (raw.length === 0 || raw.length > MAX_BODY) return Response.json({ ok: true });
  if (!signatureValid(raw, request.headers.get("x-hub-signature-256"), cfg.appSecret)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ ok: true });
  }

  const tg = telegramConfig();
  const alertOwner =
    tg.enabled && cfg.ownerTelegramChatId
      ? async (text: string) => {
          await createTelegramClient(tg.token).sendMessage(cfg.ownerTelegramChatId, escapeHtml(text));
        }
      : undefined;

  const summary = await handleWhatsAppPayload(payload, {
    client: createWhatsAppClient({ accessToken: cfg.accessToken, phoneNumberId: cfg.phoneNumberId, graphVersion: cfg.graphVersion }),
    siteUrl: cfg.siteUrl,
    alertOwner,
  });
  return Response.json({ ok: true, ...summary }, { headers: { "cache-control": "no-store" } });
}
