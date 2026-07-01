// Central Product type — used across marketplace, dashboard, admin, payments.
// Keep this as the single source of truth for what a "product" is.

export type ProductStatus = "active" | "coming_soon" | "beta" | "archived";

export type ProductCategoryId =
  | "mt5-expert-advisors"
  | "mt4-expert-advisors"
  | "tradingview-indicators"
  | "tradingview-strategies"
  | "ctrader-cbots"
  | "ninjatrader-bots"
  | "crypto-bots"
  | "indian-market-algos";

export interface ProductSpecification {
  label: string;
  value: string;
}

export interface Product {
  // Identity
  id: string;
  slug: string; // URL-friendly, e.g. "ai-trend-master-ea"
  name: string;

  // Descriptions
  shortDescription: string;
  fullDescription: string;

  // Classification
  category: ProductCategoryId;
  platform: string; // e.g. "MetaTrader 5"
  supportedPlatforms: string[]; // e.g. ["Windows", "VPS"]
  tags: string[];

  // Pricing (kept simple now; ready for Stripe later)
  price: number; // e.g. 299
  currency: string; // e.g. "USD"

  // Media
  images: string[]; // paths under /public

  // Details
  features: string[];
  specifications: ProductSpecification[];

  // Versioning
  version: string; // e.g. "1.4.2"
  releaseDate: string; // ISO date "2025-06-01"
  lastUpdated: string; // ISO date

  // Social proof / metrics
  rating: number; // 0-5
  downloads: number;

  // Flags
  featured: boolean;
  status: ProductStatus;
}