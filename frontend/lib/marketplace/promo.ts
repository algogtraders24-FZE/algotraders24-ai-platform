// lib/marketplace/promo.ts
// Time-boxed percentage promo codes for one-time Marketplace purchases.
// Deliberately code-config, not a DB table: no migration, nothing to apply to
// production before deploy, and a code simply stops working when its window
// ends. The server always re-resolves the code (never trusts a client-sent
// price), and both payment routes (Stripe card, NOWPayments crypto) charge the
// discounted amount. Add the next campaign by adding one entry here.

export interface PromoCode {
  code: string;
  percentOff: number;
  /** Inclusive window, ISO strings with an explicit offset. */
  startsAt: string;
  endsAt: string;
  label: string;
}

export const PROMO_CODES: PromoCode[] = [
  {
    code: "DIWALI20",
    percentOff: 20,
    startsAt: "2026-11-05T00:00:00+05:30",
    endsAt: "2026-11-14T23:59:59+05:30",
    label: "Diwali offer: 20% off",
  },
];

export function normalizePromoCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  return /^[A-Z0-9_-]{3,32}$/.test(code) ? code : null;
}

/** Returns the promo only if the code exists AND `now` is inside its window. */
export function resolvePromo(input: unknown, now: Date = new Date()): PromoCode | null {
  const code = normalizePromoCode(input);
  if (!code) return null;
  const promo = PROMO_CODES.find((p) => p.code === code);
  if (!promo) return null;
  const t = now.getTime();
  if (t < Date.parse(promo.startsAt) || t > Date.parse(promo.endsAt)) return null;
  return promo;
}

/** Discounted price, rounded to cents, never below 0.50 (Stripe minimum). */
export function applyPromo(amount: number, promo: PromoCode): number {
  const discounted = Math.round(amount * (100 - promo.percentOff)) / 100;
  return Math.max(0.5, discounted);
}
