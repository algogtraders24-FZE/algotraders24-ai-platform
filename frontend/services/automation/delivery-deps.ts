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
//
// Brief v2: `enrich` adds the asset's price, the macro-alignment line and today's
// high-impact events for its currencies (IST). Each part is independent and best-effort - a
// source that is down is left out, never estimated.

import { createNotification } from "@/services/notifications/NotificationService";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { sendPushToUser } from "@/services/push/deliver";
import { telegramConfig } from "@/services/telegram/config";
import { getEconomicCalendar } from "@/services/calendar/calendar.service";
import { getMacroAlignmentSnapshot } from "@/services/macro/macro-service";
import { alignmentLine, profileForMiSymbol } from "@/services/macro/macro-alignment";
import { getSmcAnalysis, summariseSmc } from "@/services/smc/smc-service";
import { formatEventLines, formatPriceLine, smcBriefLine, type DeliveryExtras } from "./brief-extras";
import type { DeliveryDeps } from "./delivery";

async function enrichMacro(symbol: string): Promise<DeliveryExtras> {
  const profile = profileForMiSymbol(symbol);
  if (!profile) return {};
  const now = new Date();
  const [macro, calendar, smc] = await Promise.allSettled([
    getMacroAlignmentSnapshot(profile.id),
    getEconomicCalendar({ week: "this", currencies: profile.calendarCurrencies, impacts: ["high"] }),
    getSmcAnalysis(symbol),
  ]);
  const extras: DeliveryExtras = {};
  if (macro.status === "fulfilled") {
    extras.priceLine = formatPriceLine(macro.value.price);
    if (macro.value.alignment.score !== null) extras.macroLine = alignmentLine(macro.value.alignment);
  }
  if (smc.status === "fulfilled" && smc.value) {
    const line = smcBriefLine(summariseSmc(smc.value));
    if (line) extras.smcLine = line;
  }
  if (calendar.status === "fulfilled") {
    const lines = formatEventLines(calendar.value.events, now);
    if (lines.length > 0) extras.eventLines = lines;
  }
  return extras;
}

export function productionDeliveryDeps(): DeliveryDeps {
  return {
    siteUrl: telegramConfig().siteUrl,
    notify: createNotification,
    telegram: (userId, text) => sendTelegramToUser(userId, "alerts", text),
    push: (userId, msg) => sendPushToUser(userId, "alerts", msg),
    enrich: enrichMacro,
  };
}
