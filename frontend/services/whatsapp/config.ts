// services/whatsapp/config.ts
// AT24 WhatsApp support bot (WhatsApp Business Platform / Cloud API): configuration from the environment. Everything is
// DORMANT unless WHATSAPP_ENABLED=true AND the token, phone-number id and app secret are set, so merging this code changes
// nothing until the owner finishes the Meta setup (docs/architecture/WHATSAPP_SUPPORT_BOT.md).
//   WHATSAPP_ENABLED=true
//   WHATSAPP_ACCESS_TOKEN=...          permanent system-user token (a secret: Vercel env only, never in chat or git)
//   WHATSAPP_PHONE_NUMBER_ID=...       the Cloud API phone-number id of the BOT number (not the phone number itself)
//   WHATSAPP_APP_SECRET=...            Meta app secret; every webhook POST is verified against it (X-Hub-Signature-256)
//   WHATSAPP_VERIFY_TOKEN=...          random string the owner types into Meta's webhook form (GET handshake)
//   WHATSAPP_OWNER_TELEGRAM_CHAT_ID=.. optional: private Telegram chat that gets "a human is needed" alerts
//   WHATSAPP_GRAPH_VERSION=v21.0       optional

export interface WhatsAppConfig {
  enabled: boolean;
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  ownerTelegramChatId: string;
  graphVersion: string;
  siteUrl: string;
}

export function whatsappConfig(env: Record<string, string | undefined> = process.env): WhatsAppConfig {
  const accessToken = (env.WHATSAPP_ACCESS_TOKEN ?? "").trim();
  const phoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID ?? "").trim();
  const appSecret = (env.WHATSAPP_APP_SECRET ?? "").trim();
  return {
    enabled: env.WHATSAPP_ENABLED === "true" && accessToken.length > 20 && /^\d{5,}$/.test(phoneNumberId) && appSecret.length >= 16,
    accessToken,
    phoneNumberId,
    appSecret,
    verifyToken: (env.WHATSAPP_VERIFY_TOKEN ?? "").trim(),
    ownerTelegramChatId: (env.WHATSAPP_OWNER_TELEGRAM_CHAT_ID ?? "").trim(),
    graphVersion: (env.WHATSAPP_GRAPH_VERSION ?? "v21.0").trim(),
    siteUrl: (env.WHATSAPP_SITE_URL ?? "https://www.algotraders24.ai").trim().replace(/\/+$/, ""),
  };
}

export const whatsappEnabled = (): boolean => whatsappConfig().enabled;
