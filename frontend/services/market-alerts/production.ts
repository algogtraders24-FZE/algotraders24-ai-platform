// services/market-alerts/production.ts
// Production wiring for the market alert runner: Prisma rules, the SMC engine, the FairEconomy calendar and the
// user's own bell / Telegram / push. Kept apart from runner.ts so the loop itself stays pure and testable.
import "server-only";
import { prisma } from "@/lib/prisma";
import { createNotification } from "@/services/notifications/NotificationService";
import { sendTelegramToUser } from "@/services/telegram/deliver";
import { sendPushToUser } from "@/services/push/deliver";
import { alertMessage } from "@/services/telegram/messages";
import { telegramConfig } from "@/services/telegram/config";
import { getSmcAnalysis } from "@/services/smc/smc-service";
import { getEconomicCalendar } from "@/services/calendar/calendar.service";
import { profileForMiSymbol } from "@/services/macro/macro-alignment";
import { runMarketAlertsWith, type RunResult, type RunnerDeps } from "./runner";

export function productionDeps(): RunnerDeps {
  const calendarCache = new Map<string, ReturnType<typeof getEconomicCalendar>>();
  return {
    listEnabledRules: () => prisma.marketAlertRule.findMany({ where: { enabled: true } }),
    cas: async (rule, data) => {
      const r = await prisma.marketAlertRule.updateMany({ where: { id: rule.id, state: rule.state, lastFiredAt: rule.lastFiredAt }, data });
      return r.count > 0;
    },
    getSmc: async (symbol) => {
      const a = await getSmcAnalysis(symbol);
      return a ? { price: a.price, atr: a.atr, pools: a.pools, volatility: a.volatility, volatilityRatio: a.volatilityRatio } : null;
    },
    getEvents: async (symbol) => {
      const profile = profileForMiSymbol(symbol);
      if (!profile) return null;
      const key = profile.calendarCurrencies.join(",");
      let p = calendarCache.get(key);
      if (!p) {
        p = getEconomicCalendar({ week: "this", currencies: profile.calendarCurrencies, impacts: ["high"] });
        calendarCache.set(key, p);
      }
      return (await p).events;
    },
    notify: async (userId, n) => {
      await createNotification({ userId, kind: "market_alert", severity: n.severity, title: n.title, body: n.body, href: n.href }).catch(() => undefined);
      await sendTelegramToUser(userId, "alerts", alertMessage({ title: n.title, body: n.body, href: n.href, siteUrl: telegramConfig().siteUrl })).catch(() => false);
      await sendPushToUser(userId, "alerts", { title: n.title, body: n.body, url: n.href, tag: n.tag }).catch(() => 0);
    },
  };
}

export function runMarketAlerts(now: Date = new Date()): Promise<RunResult> {
  return runMarketAlertsWith(productionDeps(), now);
}
