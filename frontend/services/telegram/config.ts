// services/telegram/config.ts
// AT24 Telegram: configuration from the environment. Everything is DORMANT unless TELEGRAM_ENABLED=true AND a bot token
// is set, so merging this code changes nothing until the owner creates the bot and sets the variables.
//   TELEGRAM_ENABLED=true
//   TELEGRAM_BOT_TOKEN=...            from @BotFather (a secret: Vercel env only, never in chat or git)
//   TELEGRAM_BOT_USERNAME=...         without the @, used for the deep link https://t.me/<username>?start=<code>
//   TELEGRAM_WEBHOOK_SECRET=...       random string; Telegram echoes it in a header on every webhook call
//   TELEGRAM_CHANNEL_ID=@at24updates  optional: AT24's own announcement channel (the bot must be an admin of it)
//   TELEGRAM_CHANNEL_ANNOUNCE=admin|all|off   which marketplace listings are announced (default admin = AT24's own)
//   TELEGRAM_CHANNEL_DIGEST=on        optional weekly digest of public Live Results (OFF by default)

export type AnnounceMode = "admin" | "all" | "off";

export interface TelegramConfig {
  enabled: boolean;
  token: string;
  botUsername: string;
  webhookSecret: string;
  channelId: string;
  announce: AnnounceMode;
  digestOn: boolean;
  siteUrl: string;
}

export function telegramConfig(env: Record<string, string | undefined> = process.env): TelegramConfig {
  const token = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const announce = (env.TELEGRAM_CHANNEL_ANNOUNCE ?? "admin").trim().toLowerCase();
  return {
    enabled: env.TELEGRAM_ENABLED === "true" && token.length > 20,
    token,
    botUsername: (env.TELEGRAM_BOT_USERNAME ?? "").trim().replace(/^@/, ""),
    webhookSecret: (env.TELEGRAM_WEBHOOK_SECRET ?? "").trim(),
    channelId: (env.TELEGRAM_CHANNEL_ID ?? "").trim(),
    announce: announce === "all" || announce === "off" ? announce : "admin",
    digestOn: (env.TELEGRAM_CHANNEL_DIGEST ?? "").trim().toLowerCase() === "on",
    siteUrl: (env.TELEGRAM_SITE_URL ?? "https://www.algotraders24.ai").trim().replace(/\/+$/, ""),
  };
}

export const telegramEnabled = (): boolean => telegramConfig().enabled;
