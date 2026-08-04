// types/content-category.ts
export type ContentCategory =
  | "technical-analysis"
  | "fundamental-analysis"
  | "market-outlook"
  | "economic-preview"
  | "forex-analysis"
  | "gold-analysis"
  | "crypto-analysis"
  | "index-analysis"
  | "weekly-review";

// Sprint D2.3.S1 - runtime-checkable list mirroring the union above, for
// request-body validation in the Publishing API routes.
export const CONTENT_CATEGORIES: ContentCategory[] = [
  "technical-analysis",
  "fundamental-analysis",
  "market-outlook",
  "economic-preview",
  "forex-analysis",
  "gold-analysis",
  "crypto-analysis",
  "index-analysis",
  "weekly-review",
];