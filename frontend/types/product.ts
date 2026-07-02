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

export interface ProductFAQ {
  question: string;
  answer: string;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  fullDescription: string;
  category: ProductCategoryId;
  platform: string;
  supportedPlatforms: string[];
  tags: string[];
  price: number;
  currency: string;
  images: string[];
  features: string[];
  specifications: ProductSpecification[];
  version: string;
  releaseDate: string;
  lastUpdated: string;
  rating: number;
  downloads: number;
  featured: boolean;
  status: ProductStatus;
  faqs?: ProductFAQ[];
}