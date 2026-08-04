// types/article.ts
import type { ContentCategory } from "./content-category";
import type { SeoMetadata } from "./seo-metadata";

export type ArticleStatus = "draft" | "scheduled" | "published" | "failed";

// How an article's content originated - presentation-only today (no
// gating), kept for future extensibility (e.g. a research-sourced article
// might carry citations, an imported one might skip the AI-quality gate).
export type ArticleSourceType = "ai" | "manual" | "imported" | "research";

export interface ArticleSection {
  heading: string;
  body: string;
}

// Sprint D2.3.S1 - Publishing Activation. Append-only audit trail; one entry
// per real state change (create/generate/edit/schedule/publish/delete).
// Standardized shape: every entry names who did it (actor), what happened
// (action), and when (timestamp) - metadata carries anything extra
// (scheduledFor, duplicatedFrom, etc.) without needing new columns.
export interface ArticleHistoryEntry {
  action: "created" | "edited" | "scheduled" | "published" | "deleted";
  actor: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
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
  sourceType: ArticleSourceType;
  history: ArticleHistoryEntry[];
  createdAt: string;
  scheduledFor: string | null;
  publishedAt: string | null;
}