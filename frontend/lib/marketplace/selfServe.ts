// lib/marketplace/selfServe.ts
// (Pure policy only - safe to import from the browser. File hygiene that needs node:crypto lives in buildInspect.ts.)
// Seller self-serve listing (Phase 1, docs/SELLER-SELF-SERVE-SPEC.md): pure policy + file hygiene, no I/O, so the same
// rules run in the API routes and in scripts/validate-seller-self-serve.ts.
//
// Rollout: SELLER_SELF_SERVE_MODE = off (default) | allowlist | public.
//   - the platform owner accounts are ALWAYS allowed (so the owner can test in production while the mode is off);
//   - allowlist: also the emails in SELLER_SELF_SERVE_ALLOWLIST (comma separated);
//   - public: every logged-in user.
/** Name of the private Supabase Storage bucket for seller product files (shared by server + browser upload). */
export const BUILDS_BUCKET = "marketplace-builds";

export type SelfServeMode = "off" | "allowlist" | "public";

export const PLATFORM_OWNER_EMAILS = ["algogtraders24@gmail.com", "pravinawari@outlook.com"];

export const MAX_BUILD_BYTES = 50 * 1024 * 1024;
export const MAX_NEW_LISTINGS_PER_DAY = 3;
export const MIN_DESCRIPTION_CHARS = 40;
export const MAX_SELF_SERVE_PRICE_USD = 5000;

/** Extensions a seller may upload as the product file. */
export const ALLOWED_PRODUCT_EXTENSIONS = [".ex5", ".ex4", ".zip", ".mq5", ".mq4", ".mqh", ".pine", ".cs", ".py", ".set", ".tpl", ".pdf"];

/** Never allowed as the product file, nor as an entry inside a .zip. */
export const BLOCKED_EXTENSIONS = [
  ".dll", ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".ps1", ".psm1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".lnk",
  ".jar", ".sh", ".reg", ".hta", ".cpl", ".sys", ".apk", ".dmg", ".app", ".so", ".dylib",
];

export function parseMode(raw: string | undefined | null): SelfServeMode {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "public" || v === "allowlist" ? v : "off";
}

export function parseAllowlist(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformOwner(email: string | null | undefined): boolean {
  return !!email && PLATFORM_OWNER_EMAILS.includes(email.trim().toLowerCase());
}

export function selfServeAllowedFor(
  email: string | null | undefined,
  mode: SelfServeMode = parseMode(process.env.SELLER_SELF_SERVE_MODE),
  allowlist: string[] = parseAllowlist(process.env.SELLER_SELF_SERVE_ALLOWLIST),
): boolean {
  if (isPlatformOwner(email)) return true;
  if (mode === "public") return !!email;
  if (mode === "allowlist") return !!email && allowlist.includes(email.trim().toLowerCase());
  return false;
}

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i).toLowerCase();
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/]+/g, "_").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/\.{2,}/g, "_").replace(/^[._]+/, "").slice(0, 120);
  return cleaned || "product";
}

export interface PublishRequirementsInput {
  title: string;
  description: string;
  media: string[];
  pricing: unknown;
  hasBuild: boolean;
  acceptTerms: boolean;
}

/** What must be true before a self-serve listing goes live. Returns the exact missing items. */
export function checkPublishRequirements(i: PublishRequirementsInput): string[] {
  const missing: string[] = [];
  if (!i.title.trim()) missing.push("a title");
  if (i.description.trim().length < MIN_DESCRIPTION_CHARS) missing.push(`a description of at least ${MIN_DESCRIPTION_CHARS} characters`);
  if (!i.media[0]) missing.push("a logo (icon)");
  const p = i.pricing as { model?: unknown; amount?: unknown } | null;
  if (!p || p.model !== "one_time" || typeof p.amount !== "number" || !(p.amount > 0)) missing.push("a price");
  else if (p.amount > MAX_SELF_SERVE_PRICE_USD) missing.push(`a price of at most ${MAX_SELF_SERVE_PRICE_USD} USD`);
  if (!i.hasBuild) missing.push("an uploaded product file");
  if (!i.acceptTerms) missing.push("acceptance of the seller terms");
  return missing;
}
