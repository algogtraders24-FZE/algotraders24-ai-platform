// lib/payments/env.ts
// Sprint L2.7 - Environment loading for payment providers, mirroring
// lib/market-data/env.ts's pattern exactly: a payment provider is optional
// at the platform level (no Stripe/NOWPayments account is required to run
// this app), so these return null when keys are absent rather than
// throwing. Every payment route/service checks these before doing
// anything, and reports an honest "not configured" state instead of
// fabricating a successful payment.
export interface StripeEnv {
  secretKey: string;
  webhookSecret: string;
}

export function loadStripeEnv(): StripeEnv | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secretKey || secretKey.trim().length === 0) return null;
  if (!webhookSecret || webhookSecret.trim().length === 0) return null;
  return { secretKey, webhookSecret };
}

export interface NowPaymentsEnv {
  apiKey: string;
  ipnSecret: string;
}

export function loadNowPaymentsEnv(): NowPaymentsEnv | null {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  const ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!apiKey || apiKey.trim().length === 0) return null;
  if (!ipnSecret || ipnSecret.trim().length === 0) return null;
  return { apiKey, ipnSecret };
}

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
}
