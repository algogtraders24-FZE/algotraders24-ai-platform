// services/publishing/article.service.ts
// Sprint D2.3.S1 - Publishing Activation. Real, DB-backed replacement for
// the Publishing dashboard's hardcoded mockArticles (Master Audit D2.3.F,
// Critical finding #1: no persistence, no working Publish/Schedule).
// Composes the existing, previously-unwired pure functions in
// services/ai/publishing/*.ts rather than reinventing them:
//   - generateArticle() for the category skeleton (title + starter sections)
//   - buildSeo() for real, deterministic SEO scoring
//   - validateArticle() gates schedule()/publish() - a thin article is
//     rejected with its real issues[], never silently allowed through
// Website-channel scope only: publish() is a durable status change on the
// row itself, never a claim that content was posted to any external channel
// (Telegram/Twitter/LinkedIn/etc. have no configured credentials - see
// services/ai/publishing/publisher.service.ts).
import { prisma } from "@/lib/prisma";
import { Errors } from "@/services/backend/ErrorHandler";
import { generateArticle } from "@/services/ai/publishing/content-generator.service";
import { buildSeo } from "@/services/ai/publishing/seo.service";
import { validateArticle, type ValidationResult } from "@/services/ai/publishing/article-validator.service";
import type { Article, ArticleHistoryEntry, ArticleSection, ArticleSourceType, ArticleStatus } from "@/types/article";
import type { ContentCategory } from "@/types/content-category";
import type { SeoMetadata } from "@/types/seo-metadata";

const KNOWN_STATUSES: ArticleStatus[] = ["draft", "scheduled", "published", "failed"];
const KNOWN_SOURCE_TYPES: ArticleSourceType[] = ["ai", "manual", "imported", "research"];

// Cheap, honest guard against an AI call that "succeeded" but produced
// nothing real - never a substitute for a human/editorial review, just a
// floor against obviously-broken content reaching the database at all.
const PLACEHOLDER_MARKERS = ["lorem ipsum", "[insert", "todo:", "xxx", "placeholder text"];

export interface CreateDraftInput {
  category: ContentCategory;
  keywords: string[];
  /**
   * Real AI-generated overview text, already fetched by the caller via the
   * proven services/ai/assistant.service.ts sendMessage() path (the same
   * call the old page.tsx generateDraft() made) - replaces the skeleton's
   * generic "Market Overview" placeholder body when provided. Optional so a
   * bare skeleton can still be created (and edited) without an AI call.
   */
  aiOverviewText?: string;
}

export interface UpdateArticleInput {
  title?: string;
  summary?: string;
  category?: ContentCategory;
  sections?: ArticleSection[];
  keywords?: string[];
}

function historyEntry(
  action: ArticleHistoryEntry["action"],
  actor: string,
  metadata?: Record<string, unknown>,
): ArticleHistoryEntry {
  return { action, actor, timestamp: new Date().toISOString(), metadata };
}

function appendHistory(existing: unknown, entry: ArticleHistoryEntry): ArticleHistoryEntry[] {
  const prev = Array.isArray(existing) ? (existing as ArticleHistoryEntry[]) : [];
  return [...prev, entry];
}

// Validates AI-generated content before it's ever written to the database -
// distinct from validateArticle() (which gates schedule/publish and runs on
// already-persisted articles, draft or not). This one runs pre-persistence
// and only when aiOverviewText is present: an empty/placeholder/garbage AI
// response must never become a saved draft in the first place.
function assertUsableAiContent(text: string): void {
  const trimmed = text.trim();
  if (trimmed.length < 40) {
    throw Errors.validation("The AI response was too short or empty - try generating again.");
  }
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_MARKERS.some((marker) => lower.includes(marker))) {
    throw Errors.validation("The AI response looked like placeholder text - try generating again.");
  }
}

function toDomain(row: {
  id: string;
  title: string;
  category: string;
  summary: string;
  sections: unknown;
  disclaimer: string;
  seo: unknown;
  status: string;
  sourceType: string;
  history: unknown;
  createdAt: Date;
  scheduledFor: Date | null;
  publishedAt: Date | null;
}): Article {
  return {
    id: row.id,
    title: row.title,
    category: row.category as ContentCategory,
    summary: row.summary,
    sections: (Array.isArray(row.sections) ? row.sections : []) as ArticleSection[],
    disclaimer: row.disclaimer,
    seo: (row.seo && typeof row.seo === "object" ? row.seo : {}) as unknown as SeoMetadata,
    status: (KNOWN_STATUSES.includes(row.status as ArticleStatus) ? row.status : "draft") as ArticleStatus,
    sourceType: (KNOWN_SOURCE_TYPES.includes(row.sourceType as ArticleSourceType)
      ? row.sourceType
      : "manual") as ArticleSourceType,
    history: (Array.isArray(row.history) ? row.history : []) as ArticleHistoryEntry[],
    createdAt: row.createdAt.toISOString(),
    scheduledFor: row.scheduledFor ? row.scheduledFor.toISOString() : null,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

async function findOwned(userId: string, id: string) {
  const row = await prisma.article.findFirst({ where: { id, userId, deletedAt: null } });
  if (!row) throw Errors.notFound("Article");
  return row;
}

export class ArticleService {
  async list(userId: string): Promise<Article[]> {
    const rows = await prisma.article.findMany({
      where: { userId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(toDomain);
  }

  async getById(userId: string, id: string): Promise<Article> {
    return toDomain(await findOwned(userId, id));
  }

  async createDraft(userId: string, input: CreateDraftInput): Promise<Article> {
    if (input.aiOverviewText !== undefined) {
      assertUsableAiContent(input.aiOverviewText);
    }

    const skeleton = generateArticle(input.category, input.keywords);
    const sections: ArticleSection[] = input.aiOverviewText
      ? skeleton.sections.map((s, i) => (i === 0 ? { ...s, body: input.aiOverviewText! } : s))
      : skeleton.sections;

    // Minimum structure: every section must have real content, not an
    // empty body - a skeleton section that was never filled in shouldn't
    // silently pass as "generated".
    if (sections.some((s) => s.body.trim().length === 0)) {
      throw Errors.validation("Generated article has an empty section - try again.");
    }

    const seo = buildSeo(skeleton.title, input.keywords);
    const sourceType: ArticleSourceType = input.aiOverviewText ? "ai" : "manual";

    const row = await prisma.article.create({
      data: {
        userId,
        title: skeleton.title,
        category: input.category,
        summary: skeleton.summary,
        sections: sections as object[],
        disclaimer: skeleton.disclaimer,
        seo: seo as unknown as object,
        slug: seo.slug,
        status: "draft",
        sourceType,
        history: [historyEntry("created", userId, { category: input.category, sourceType })] as object[],
      },
    });
    return toDomain(row);
  }

  async update(userId: string, id: string, patch: UpdateArticleInput): Promise<Article> {
    const existing = await findOwned(userId, id);

    // A published article's content must never silently change under a
    // reader who already saw it - once published, a row is read-only.
    // Editing means duplicateAsDraft() first, then editing the copy.
    if (existing.status === "published") {
      throw Errors.conflict("Published articles are read-only - duplicate as a draft to make changes.");
    }

    const title = patch.title ?? existing.title;
    const currentSeo = (existing.seo && typeof existing.seo === "object" ? existing.seo : {}) as unknown as SeoMetadata;
    const keywords = patch.keywords ?? currentSeo.keywords ?? [];
    const seo = patch.title !== undefined || patch.keywords !== undefined ? buildSeo(title, keywords) : currentSeo;

    const row = await prisma.article.update({
      where: { id: existing.id },
      data: {
        title,
        summary: patch.summary ?? existing.summary,
        category: patch.category ?? existing.category,
        sections: patch.sections !== undefined ? (patch.sections as object[]) : existing.sections ?? [],
        seo: seo as unknown as object,
        slug: seo.slug,
        history: appendHistory(existing.history, historyEntry("edited", userId)) as object[],
      },
    });
    return toDomain(row);
  }

  private async runValidationGate(userId: string, id: string) {
    const existing = await findOwned(userId, id);
    const validation = validateArticle(toDomain(existing));
    return { existing, validation };
  }

  async schedule(userId: string, id: string, scheduledFor: string): Promise<{ article: Article; validation: ValidationResult }> {
    const { existing, validation } = await this.runValidationGate(userId, id);
    if (!validation.valid) return { article: toDomain(existing), validation };

    const parsed = new Date(scheduledFor);
    if (Number.isNaN(parsed.getTime())) throw Errors.validation("scheduledFor must be a valid date");

    const row = await prisma.article.update({
      where: { id: existing.id },
      data: {
        status: "scheduled",
        scheduledFor: parsed,
        history: appendHistory(existing.history, historyEntry("scheduled", userId, { scheduledFor })) as object[],
      },
    });
    return { article: toDomain(row), validation };
  }

  async publish(userId: string, id: string): Promise<{ article: Article; validation: ValidationResult }> {
    const { existing, validation } = await this.runValidationGate(userId, id);
    if (!validation.valid) return { article: toDomain(existing), validation };

    const row = await prisma.article.update({
      where: { id: existing.id },
      data: {
        status: "published",
        publishedAt: new Date(),
        history: appendHistory(existing.history, historyEntry("published", userId)) as object[],
      },
    });
    return { article: toDomain(row), validation };
  }

  // A published row is read-only (see update()'s guard). To revise
  // published content, copy it into a brand-new draft row - standard CMS
  // pattern, and the simplest correct way to guarantee a published article
  // never mutates without needing a separate version-history table.
  async duplicateAsDraft(userId: string, id: string): Promise<Article> {
    const existing = await findOwned(userId, id);
    const domain = toDomain(existing);
    const seo = buildSeo(`${domain.title} (Copy)`, domain.seo.keywords ?? []);

    const row = await prisma.article.create({
      data: {
        userId,
        title: `${domain.title} (Copy)`,
        category: domain.category,
        summary: domain.summary,
        sections: domain.sections as object[],
        disclaimer: domain.disclaimer,
        seo: seo as unknown as object,
        slug: seo.slug,
        status: "draft",
        sourceType: domain.sourceType,
        history: [historyEntry("created", userId, { duplicatedFrom: existing.id })] as object[],
      },
    });
    return toDomain(row);
  }

  async remove(userId: string, id: string): Promise<void> {
    const existing = await findOwned(userId, id);
    await prisma.article.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        history: appendHistory(existing.history, historyEntry("deleted", userId)) as object[],
      },
    });
  }
}

export const articleService = new ArticleService();
