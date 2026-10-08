// services/live-results/pages.ts
// Pure rules for Live Results pages: who may view, and what the owner may save. No DB, no network.

import { randomBytes, timingSafeEqual } from "node:crypto";

export type Visibility = "private" | "unlisted" | "public";
export const VISIBILITIES: readonly Visibility[] = ["private", "unlisted", "public"];
export const MAX_PAGES_PER_USER = 10;
export const DELAY_CHOICES: readonly number[] = [0, 15, 60, 240, 1440];
export const MAX_FOLLOWS_PER_USER = 50;
/** Marketplace listing slugs look like "xxx-us30-multi-module-breakout". */
export const LISTING_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,78}$/;

export interface PageAccessFields {
  visibility: string;
  unlistedKey: string;
}

/** Viewing rule. Owner sees everything; public is open; unlisted needs the secret key; private is owner-only. */
export function canView(page: PageAccessFields, viewer: { isOwner: boolean; key: string | null }): boolean {
  if (viewer.isOwner) return true;
  if (page.visibility === "public") return true;
  if (page.visibility === "unlisted" && viewer.key) {
    const a = Buffer.from(viewer.key);
    const b = Buffer.from(page.unlistedKey);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return false;
}

export function newUnlistedKey(): string {
  return randomBytes(18).toString("base64url");
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 2 ? base : "results";
}

export function slugWithSuffix(base: string): string {
  return `${slugify(base)}-${randomBytes(3).toString("hex")}`;
}

import { parsePropSettings, type PropSettings } from "./prop";

export interface PageInput {
  accountId: string;
  title: string;
  description: string;
  visibility: Visibility;
  /** Digits only, or null for the whole account. */
  magicFilter: string | null;
  showAmounts: boolean;
  /** Show the broker company name (only if the EA sent it). */
  showBroker: boolean;
  /** Prop Mode rule check settings, or null = off. */
  propMode: PropSettings | null;
  positionDelayMin: number;
  /** Marketplace listing this page is shown on (the server checks the owner sells it), or null. */
  listingSlug: string | null;
}

export type PageValidation = { ok: true; value: PageInput } | { ok: false; message: string };

/** Strips control characters and angle brackets so titles/descriptions are plain text everywhere they are shown. */
export function plainText(s: string, max: number): string {
  return s.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function validatePageInput(body: unknown): PageValidation {
  if (typeof body !== "object" || body === null) return { ok: false, message: "Invalid request" };
  const b = body as Record<string, unknown>;
  if (typeof b.accountId !== "string" || b.accountId.length < 5 || b.accountId.length > 60) return { ok: false, message: "accountId is required" };
  const title = typeof b.title === "string" ? plainText(b.title, 80) : "";
  if (title.length < 2) return { ok: false, message: "Please give the page a title (at least 2 characters)." };
  const description = typeof b.description === "string" ? plainText(b.description, 400) : "";
  const visibility = b.visibility;
  if (typeof visibility !== "string" || !VISIBILITIES.includes(visibility as Visibility)) return { ok: false, message: "visibility must be private, unlisted or public" };
  let magicFilter: string | null = null;
  if (b.magicFilter !== null && b.magicFilter !== undefined && b.magicFilter !== "") {
    const m = String(b.magicFilter);
    if (!/^\d{1,18}$/.test(m)) return { ok: false, message: "EA magic number must be digits only" };
    magicFilter = m;
  }
  if (typeof b.showAmounts !== "boolean") return { ok: false, message: "showAmounts must be true or false" };
  if (b.showBroker !== undefined && typeof b.showBroker !== "boolean") return { ok: false, message: "showBroker must be true or false" };
  let propMode: PropSettings | null = null;
  if (b.propMode !== null && b.propMode !== undefined) {
    const p = parsePropSettings(b.propMode);
    if (typeof p === "string") return { ok: false, message: p };
    propMode = p;
  }
  const delay = Number(b.positionDelayMin);
  if (!Number.isInteger(delay) || !DELAY_CHOICES.includes(delay)) return { ok: false, message: "Choose a position delay from the list." };
  let listingSlug: string | null = null;
  if (b.listingSlug !== null && b.listingSlug !== undefined && b.listingSlug !== "") {
    if (typeof b.listingSlug !== "string" || !LISTING_SLUG_RE.test(b.listingSlug)) return { ok: false, message: "Invalid marketplace listing" };
    listingSlug = b.listingSlug;
  }
  return { ok: true, value: { accountId: b.accountId, title, description, visibility: visibility as Visibility, magicFilter, showAmounts: b.showAmounts, showBroker: b.showBroker === true, propMode, positionDelayMin: delay, listingSlug } };
}
