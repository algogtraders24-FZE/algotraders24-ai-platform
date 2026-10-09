// app/api/telegram/webhook/route.ts
// Telegram calls this for every message sent to the AT24 bot. Public URL, so it is protected by the secret token that
// Telegram echoes in the X-Telegram-Bot-Api-Secret-Token header (set once with scripts/ops/telegram-setup.ts) and compared in
// constant time. Always answers 200 to a genuine call (Telegram retries on errors); never reveals anything.
// Dormant (503) unless TELEGRAM_ENABLED=true and a bot token is configured.

import { handleTelegramUpdate } from "@/services/telegram/webhook";
import { telegramConfig } from "@/services/telegram/config";
import { createTelegramClient } from "@/services/telegram/client";
import { prismaTelegramStore, secretMatches } from "@/services/telegram/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MAX_BODY = 20_000;

export async function POST(request: Request): Promise<Response> {
  const cfg = telegramConfig();
  if (!cfg.enabled) return Response.json({ ok: false, code: "DISABLED" }, { status: 503 });
  if (!secretMatches(request.headers.get("x-telegram-bot-api-secret-token"), cfg.webhookSecret)) {
    return Response.json({ ok: false, code: "UNAUTHORIZED" }, { status: 401 });
  }
  const text = await request.text().catch(() => "");
  if (text.length === 0 || text.length > MAX_BODY) return Response.json({ ok: true });
  let update: unknown = null;
  try {
    update = JSON.parse(text);
  } catch {
    return Response.json({ ok: true });
  }
  await handleTelegramUpdate(update, { store: prismaTelegramStore(), client: createTelegramClient(cfg.token), siteUrl: cfg.siteUrl });
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}

export const GET = () => Response.json({ ok: false, code: "METHOD" }, { status: 405, headers: { allow: "POST" } });
