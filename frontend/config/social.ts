// config/social.ts
// The company's real, verified public profiles. One source for the footer, the contact page and the Organization
// structured data (sameAs), so a handle is changed in a single place. Only add a profile here once it exists.
// Telegram points only at the eGold AI channel (the contact page keeps its own direct-message Telegram card).
export interface SocialProfile {
  id: "instagram" | "facebook" | "linkedin" | "x" | "telegram";
  label: string;
  href: string;
  handle: string;
}

export const SOCIAL_PROFILES: readonly SocialProfile[] = [
  { id: "instagram", label: "Instagram", href: "https://www.instagram.com/algotraders24ai/", handle: "@algotraders24ai" },
  { id: "facebook", label: "Facebook", href: "https://www.facebook.com/algotrader24", handle: "Algotraders24" },
  { id: "linkedin", label: "LinkedIn", href: "https://www.linkedin.com/company/algotraders24ai/", handle: "Algotraders24ai" },
  { id: "x", label: "X", href: "https://x.com/Algotraders24ai", handle: "@Algotraders24ai" },
  { id: "telegram", label: "Telegram", href: "https://t.me/eGoldai24", handle: "@eGoldai24" },
] as const;

export const SOCIAL_URLS: string[] = SOCIAL_PROFILES.map((p) => p.href);
