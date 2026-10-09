// services/telegram/webhook.ts
// What the bot does with an incoming Telegram update. Pure over an injected store and client (tested without the network).
// Only PRIVATE chats are accepted (a group or channel can never be linked), only text commands are understood, and the
// only way to link is a one-time code created by a signed-in AT24 user. The function never throws.

import type { TelegramClient } from "./client";
import { expiredCodeMessage, helpMessage, linkedMessage, statusMessage, stoppedMessage } from "./messages";
import { hashCode, parseStartPayload, type TelegramStore } from "./store";

export interface TelegramUpdate {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number | string; type?: string };
    from?: { id?: number; is_bot?: boolean; username?: string };
  };
}

export type WebhookOutcome = "ignored" | "linked" | "expired_code" | "help" | "status" | "stopped";

export interface WebhookDeps {
  store: TelegramStore;
  client: TelegramClient;
  siteUrl: string;
  now?: () => Date;
}

const cleanUsername = (u: unknown): string | null => (typeof u === "string" && /^[A-Za-z0-9_]{1,32}$/.test(u) ? u : null);

export async function handleTelegramUpdate(update: unknown, deps: WebhookDeps): Promise<WebhookOutcome> {
  try {
    const msg = (update as TelegramUpdate | null)?.message;
    const text = typeof msg?.text === "string" ? msg.text.trim() : "";
    const chatType = msg?.chat?.type;
    const rawChat = msg?.chat?.id;
    if (!msg || chatType !== "private" || (typeof rawChat !== "number" && typeof rawChat !== "string") || msg.from?.is_bot === true || !text.startsWith("/")) return "ignored";
    const chatId = String(rawChat);
    if (!/^-?\d{1,20}$/.test(chatId)) return "ignored";
    const reply = (t: string) => deps.client.sendMessage(chatId, t);
    const cmd = (/^\/([a-zA-Z]+)/.exec(text)?.[1] ?? "").toLowerCase();

    if (cmd === "start") {
      const payload = parseStartPayload(text);
      if (!payload) {
        await reply(helpMessage(deps.siteUrl));
        return "help";
      }
      const userId = await deps.store.consumeCode(hashCode(payload), (deps.now ?? (() => new Date()))());
      if (!userId) {
        await reply(expiredCodeMessage(deps.siteUrl));
        return "expired_code";
      }
      await deps.store.link(userId, chatId, cleanUsername(msg.from?.username));
      await reply(linkedMessage());
      return "linked";
    }
    if (cmd === "status") {
      await reply(statusMessage(await deps.store.getByChat(chatId)));
      return "status";
    }
    if (cmd === "stop") {
      const was = await deps.store.unlinkByChat(chatId);
      await reply(stoppedMessage(was));
      return "stopped";
    }
    await reply(helpMessage(deps.siteUrl));
    return "help";
  } catch {
    return "ignored";
  }
}
