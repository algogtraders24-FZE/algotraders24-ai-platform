// scripts/ops/telegram-setup.ts
// ONE-TIME setup of the AT24 Telegram bot, run by the owner on his own PC. It reads the secrets from the environment of the
// shell it runs in (never from a file, never from chat) and never prints the token.
//
//   Windows cmd:
//     set TELEGRAM_BOT_TOKEN=<from @BotFather>
//     set TELEGRAM_WEBHOOK_SECRET=<the same random string you set on Vercel>
//     npx tsx scripts/ops/telegram-setup.ts https://www.algotraders24.ai
//
// What it does: checks the token (getMe), registers the webhook https://<site>/api/telegram/webhook with the secret header,
// sets the bot's command list (/status, /stop) and prints the webhook state. Run it again any time (it is idempotent).
import assert from "node:assert/strict";

const token = (process.env.TELEGRAM_BOT_TOKEN ?? "").trim();
const secret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
const site = (process.argv[2] ?? "https://www.algotraders24.ai").replace(/\/+$/, "");

assert.ok(token.length > 20, "Set TELEGRAM_BOT_TOKEN in this shell first (from @BotFather).");
assert.ok(/^[A-Za-z0-9_-]{16,256}$/.test(secret), "Set TELEGRAM_WEBHOOK_SECRET to a random string of 16-256 letters, digits, _ or - (the same value as on Vercel).");
assert.ok(site.startsWith("https://"), "The site must be an https:// address.");

async function api<T>(method: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`${method} failed: ${json.description ?? res.status}`);
  return json.result as T;
}

async function main(): Promise<void> {
  const me = await api<{ username: string; first_name: string; can_join_groups: boolean }>("getMe");
  console.log(`Bot OK: @${me.username} (${me.first_name})`);
  console.log(`Set TELEGRAM_BOT_USERNAME=${me.username} on Vercel.`);
  await api("setWebhook", { url: `${site}/api/telegram/webhook`, secret_token: secret, allowed_updates: ["message"], drop_pending_updates: true, max_connections: 10 });
  console.log(`Webhook registered: ${site}/api/telegram/webhook`);
  await api("setMyCommands", { commands: [{ command: "status", description: "Show what is connected" }, { command: "stop", description: "Disconnect AT24 alerts" }] });
  const info = await api<{ url: string; pending_update_count: number; last_error_message?: string; has_custom_certificate: boolean }>("getWebhookInfo");
  console.log(`Webhook now: ${info.url} | pending updates: ${info.pending_update_count}${info.last_error_message ? ` | last error: ${info.last_error_message}` : " | no errors"}`);
  console.log("Done. Open the bot in Telegram and send /start to check that it answers.");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message.replace(token, "<token>") : "failed");
  process.exit(1);
});
