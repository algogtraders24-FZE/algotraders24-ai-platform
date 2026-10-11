// services/automation/delivery-deps.ts
// AT24 Automation Phase 2 - the PRODUCTION wiring for deliverRunResult: the real
// in-app notification, the user's own linked Telegram chat and their own push
// devices. Kept apart from delivery.ts so that module stays pure and testable
// (this file pulls in server-only modules, like the dispatcher that uses it).
//
// Telegram / push use the existing "alerts" kind, so a user's single
// alerts on/off switch silences automation results too, exactly like every
// other AT24 alert. Both are best-effort and return false/0 for a user who
// never connected them.

import { createNotification } from "@/services/notifications/NotificationService";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { sendPushToUser } from "@/services/push/deliver";
import { telegramConfig } from "@/services/telegram/config";
import type { DeliveryDeps } from "./delivery";

export function productionDeliveryDeps(): DeliveryDeps {
  return {
    siteUrl: telegramConfig().siteUrl,
    notify: createNotification,
    telegram: (userId, text) => sendTelegramToUser(userId, "alerts", text),
    push: (userId, msg) => sendPushToUser(userId, "alerts", msg),
  };
}
