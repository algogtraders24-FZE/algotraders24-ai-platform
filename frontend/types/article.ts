// types/article.ts
import type { ContentCategory } from "./content-category";
import type { SeoMetadata } from "./seo-metadata";

export type ArticleStatus = "draft" | "scheduled" | "published" | "failed";

export interface ArticleSection {
  heading: string;
  body: string;
}

export interface Article {
  id: string;
  title: string;
  category: ContentCategory;
  summary: string;
  sections: ArticleSection[];
  disclaimer: string;
  seo: SeoMetadata;
  status: ArticleStatus;
  createdAt: string;
  scheduledFor: string | null;
  publishedAt: string | null;
}