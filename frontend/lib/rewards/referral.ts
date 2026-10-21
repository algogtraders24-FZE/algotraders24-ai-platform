// lib/rewards/referral.ts
// (Pure - no I/O except randomness.) Referral codes and links.
// Why a random code and NOT the username: usernames change, can be guessed or impersonated, and would expose who the
// partner is. A random code reveals nothing and can be replaced if it leaks.
import { randomInt } from "node:crypto";
import { REFERRAL_WINDOW_DAYS } from "./config";

/** No 0/O/1/I/L so a code is easy to read out or type. 31 symbols ^ 8 = ~8.5e11 combinations. */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 8;
export const REF_COOKIE = "at24_ref";
export const REF_COOKIE_MAX_AGE_SECONDS = REFERRAL_WINDOW_DAYS * 86_400;
export const DEFAULT_SITE_ORIGIN = "https://algotraders24.ai";

export function generateReferralCode(length: number = CODE_LENGTH, rand: (max: number) => number = randomInt): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[rand(CODE_ALPHABET.length)];
  return out;
}

/** Upper-cases and trims; returns null unless it is exactly a well-formed code. Never trust a code from the URL or cookie before this. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().toUpperCase();
  if (v.length !== CODE_LENGTH) return null;
  for (const ch of v) if (!CODE_ALPHABET.includes(ch)) return null;
  return v;
}

export function referralLink(code: string, origin: string = DEFAULT_SITE_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/r/${code}`;
}

/** The only place a visitor may be sent after a referral link: a fixed internal path, never a URL taken from the request. */
export const REFERRAL_LANDING_PATH = "/";
