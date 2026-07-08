# AI Publishing & SEO Engine

Automated market research content engine. Mock data + Gemini drafts. No external publishing integrations yet.

## Architecture

Planner -> Generator -> SEO -> Validator -> Publisher (queue). Article preview + Gemini draft on demand.

## Publishing Flow

1. content-planner schedules categories (daily/weekly) with priorities.
2. content-generator builds an Article (sections, disclaimer) and attaches SEO.
3. seo.service produces title, meta, keywords, slug, canonical, OG, Twitter, and a score.
4. internal-link.service adds related articles and suggested reading.
5. article-validator checks length, duplicate headings, disclaimer, SEO score.
6. publisher.service creates a queued PublishingJob (architecture only).

## SEO Strategy

Score rewards title length (30-65), 3+ keywords, and a 120-160 char meta description. Each article carries canonical URL, Open Graph, and Twitter Card metadata for rich sharing.

## Commercial Readiness

Every service exposes FeatureMeta (featureId, requiredPlan, estimatedCost, dailyUsageWeight) for the future Subscription Engine. No billing yet.

## Gemini Integration

Generate AI Draft builds a prompt for the selected article and sends it through the existing Prompt Engine and Gemini provider. If the API fails, mock article content still renders.

## Future Scheduler

A cron job or background worker reads the planner schedule and triggers generation at each slot.

## Future Auto Publishing

publisher.service.runJob is a placeholder. Real channel adapters (website, blog, RSS, newsletter, Telegram, X, LinkedIn) plug in behind PublishChannel without changing callers.

## Future WordPress / Headless CMS

Adapters for WordPress, Sanity, Contentful, Strapi, or Ghost implement a common publish interface. The queue and job model stay unchanged; only the adapter differs.