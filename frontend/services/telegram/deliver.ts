// services/telegram/deliver.ts
// Sends one message to ONE AT24 user's linked Telegram chat, if they linked it and switched that kind on.
// Best effort by design: it never throws and never blocks an alert; a blocked bot or a deleted chat removes the link.

import { telegramConfig } from "./config";
import { createTelegramClient, type TelegramClient } from "./client";
import { prismaTelegramStore, type TelegramStore } from "./store";

export type DeliveryKind = "alerts" | "watch";

export interface DeliverDeps {
  store?: TelegramStore;
  client?: TelegramClient;
  enabled?: boolean;
  now?: () => Date;
}

/** Returns true when Telegram accepted the message. */
export async function sendTelegramToUser(userId: string, kind: DeliveryKind, text: string, deps: DeliverDeps = {}): Promise<boolean> {
  try {
    const cfg = telegramConfig();
    if (!(deps.enabled ?? cfg.enabled)) return false;
    const store = deps.store ?? prismaTelegramStore();
    const link = await store.getByUser(userId);
    if (!link) return false;
    if (kind === "alerts" ? !link.alertsOn : !link.watchOn) return false;
    const client = deps.client ?? createTelegramClient(cfg.token);
    const res = await client.sendMessage(link.chatId, text);
    if (res.gone) await store.unlinkByUser(userId).catch(() => undefined);
    if (res.ok) await store.touchSent(userId, (deps.now ?? (() => new Date()))()).catch(() => undefined);
    return res.ok;
  } catch {
    return false;
  }
}
