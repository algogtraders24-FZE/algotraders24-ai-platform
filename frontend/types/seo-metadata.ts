// types/seo-metadata.ts
export interface OpenGraph {
  title: string;
  description: string;
  type: string;
  url: string;
}

export interface TwitterCard {
  card: string;
  title: string;
  description: string;
}

export interface SeoMetadata {
  title: string;
  metaDescription: string;
  keywords: string[];
  slug: string;
  canonicalUrl: string;
  openGraph: OpenGraph;
  twitter: TwitterCard;
  score: number; // 0–100
}