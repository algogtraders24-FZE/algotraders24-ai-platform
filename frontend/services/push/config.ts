// services/push/config.ts
// AT24 Web Push: configuration from the environment. DORMANT unless PUSH_ENABLED=true and a VAPID key pair is set, so merging
// the code changes nothing until the owner generates the keys (npx web-push generate-vapid-keys) and sets the variables:
//   PUSH_ENABLED=true
//   VAPID_PUBLIC_KEY=...     public: the browser needs it to subscribe (served by GET /api/private/push)
//   VAPID_PRIVATE_KEY=...    SECRET: Vercel env only, never in chat or git
//   VAPID_SUBJECT=mailto:you@example.com   a contact for the push services (a mailto: or https: URL)

export interface PushConfig {
  enabled: boolean;
  publicKey: string;
  privateKey: string;
  subject: string;
}

const B64URL = /^[A-Za-z0-9_-]+$/;

export function pushConfig(env: Record<string, string | undefined> = process.env): PushConfig {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env.VAPID_SUBJECT ?? "").trim();
  // A VAPID public key is a 65-byte uncompressed P-256 point (87 base64url characters); the private key is 32 bytes (43 characters).
  const keysOk = B64URL.test(publicKey) && publicKey.length === 87 && B64URL.test(privateKey) && privateKey.length === 43;
  const subjectOk = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject) || /^https:\/\/[^\s]+$/.test(subject);
  return { enabled: env.PUSH_ENABLED === "true" && keysOk && subjectOk, publicKey, privateKey, subject };
}

export const pushEnabled = (): boolean => pushConfig().enabled;
