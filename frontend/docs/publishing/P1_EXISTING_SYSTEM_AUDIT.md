# P1 — Existing System Audit (AT24 Publishing)

**Sprint:** AT24 Publishing — P1 (READ / ANALYSIS ONLY)
**Date:** 2026-09-08
**Branch inspected:** `feat/agent-framework-foundation`
**Scope:** Establish exactly what Publishing is today, what is reusable, what is
missing, and what a real Publishing Engine (P2) must connect to.
**Files changed by this sprint:** `NONE` (this audit document only).

> Location note: placed under `frontend/docs/publishing/` (adjacent to the code
> and consistent with the sibling `frontend/docs/architecture/AUTOMATION_*` R&D
> pass committed in `661106d`), not the root `docs/` narrative folder.

---

## Executive Summary

**"Publishing" in AT24 today is a single-tenant article CMS, not a publishing
engine.** It is `/dashboard/publishing` → a real, DB-backed `Article` model with
a `draft → scheduled → published → failed` status field, deterministic SEO
scoring, a validation gate, and an append-only history log. All of that is real
and production-quality *as an internal drafting tool*.

Everything that makes it a *publishing system* is absent:

1. **`published` has no reader.** `publish()` flips a DB column. No public route
   renders a published `Article`. The SEO `canonicalUrl`
   (`https://algotraders24.ai/blog/<slug>`) is a 404 — there is no `/blog`.
2. **`scheduled` is inert.** Nothing reads `Article.scheduledFor`. There is no
   worker, queue, or cron that publishes a scheduled article when its time
   arrives. Setting the status is the entire behavior.
3. **No destinations exist.** No channel adapter, no external integration, no
   `externalId`/`externalUrl`, no webhook, no retry, no job/queue table. The
   only artifacts that mention channels
   (`services/ai/publishing/publisher.service.ts`, `types/publishing-job.ts`)
   are **dead code** — zero non-comment references anywhere in the repo.
4. **No automation can trigger it.** There is no working automation executor in
   the product at all (three half-built/overlapping models — see
   *Automation Integration Analysis*).

**The good news:** the reusable substrate for a real engine already exists and
is shipped/tested — the **Agent Framework** (`services/agent-framework/`,
Sprint AN A1–A15: resumable runtime, idempotent credit ledger, immutable
evidence/trace, per-tool authorization, cancellation, ownership-scoped
observability), the **`AuditLog`** append-only table, the **`Article`** model
itself, and the platform's route/service/validation conventions. The sibling
**`AUTOMATION_*` R&D pass** already did most of the reuse analysis P2 needs and
reached the same conclusion for the automation side.

**P1 verdict: PASS.** No blocker to *designing* P2. Real blockers exist to
*shipping* P2 (Vercel Hobby cron limit; owner decision on model reconciliation)
and are documented below.

---

## Current Publishing Architecture

```
Browser (/dashboard/publishing/page.tsx, "use client")
  │  fetch()
  ▼
app/api/private/publishing/articles/**  (Next route handlers, withContext)
  │  getUserOrNull() → sessionUser.profile.id
  ▼
services/publishing/article.service.ts  (ArticleService — the only real logic)
  │  composes pure helpers:
  │    services/ai/publishing/content-generator.service.ts  (generateArticle, CATEGORY_TITLES)
  │    services/ai/publishing/seo.service.ts                (buildSeo — deterministic score)
  │    services/ai/publishing/article-validator.service.ts  (validateArticle — schedule/publish gate)
  ▼
prisma.article  (model Article, @@map("articles"))
  ▼
(nothing further — no queue, no worker, no external provider, no public render)
```

**AI draft path (separate):** `page.tsx` → `sendMessage()`
(`services/ai/assistant.service.ts`) → `POST /api/private/knowledge/chat`
(Gemini + `AI_COMMUNICATION_POLICY`) → the returned text is posted back as
`aiOverviewText` on `POST /articles`, where `assertUsableAiContent()` gates it
before persistence. This is real and was proven live in the D2.3 audit.

**Lifecycle owned by:** the service layer (`ArticleService`). No business logic
lives in the React component beyond fetch orchestration and local form state —
this already satisfies the P2 "publishing logic must not live in components"
rule.

---

## Repository Map

### A. Real, in-use, production-quality

| Path | Responsibility | Notes |
| --- | --- | --- |
| `frontend/app/dashboard/publishing/page.tsx` | Client dashboard: list, generate AI draft, open preview, publish/schedule/duplicate | Real; DB-backed since D2.3.S1. No destination selector. |
| `frontend/services/publishing/article.service.ts` | **The** Publishing service. CRUD + `createDraft` + `schedule` + `publish` + `duplicateAsDraft` + soft `remove`. Ownership-scoped. Validation-gated. | Reusable core. Website-channel scope only (documented in its header). |
| `frontend/app/api/private/publishing/articles/route.ts` | `GET` list (user), `POST` create draft | Real. Auth via `getUserOrNull`. |
| `frontend/app/api/private/publishing/articles/[id]/route.ts` | `GET` / `PATCH` / `DELETE` one article | Real. `id` parsed from path (Middleware doesn't thread `params`). |
| `frontend/app/api/private/publishing/articles/[id]/publish/route.ts` | `POST` — validation-gated status flip to `published` | Real write; **no distribution**. |
| `frontend/app/api/private/publishing/articles/[id]/schedule/route.ts` | `POST` — validation-gated status flip to `scheduled` + `scheduledFor` | Real write; **no executor**. |
| `frontend/app/api/private/publishing/articles/[id]/duplicate/route.ts` | `POST` — copy a (published) article into a new draft row | Real. CMS "revise published" pattern. |
| `frontend/services/ai/publishing/content-generator.service.ts` | `CATEGORY_TITLES`, `generateArticle()` skeleton | Used by `article.service.ts` + `page.tsx`. |
| `frontend/services/ai/publishing/seo.service.ts` | `buildSeo()` — deterministic SEO metadata + score (0–100) | Used by `article.service.ts`. |
| `frontend/services/ai/publishing/article-validator.service.ts` | `validateArticle()` — 6 checks, gates schedule/publish | Used by `article.service.ts` + both route files. |
| `frontend/services/ai/publishing/content-planner.service.ts` | `getDailySchedule()` — **hardcoded static array** of category/time/priority | Rendered by `ContentCalendar`. Not connected to any scheduler. `getWeeklySchedule()` is unused. |
| `frontend/components/publishing/*` (6 files) | Presentational: `ArticleCard`, `ArticlePreview`, `ContentCalendar`, `PublishingQueue`, `PublishingStatus`, `SEOScoreCard` | Real, thin. `ArticlePreview` holds the publish/schedule/duplicate buttons + history render. |
| `frontend/types/article.ts` | `Article`, `ArticleStatus`, `ArticleSourceType`, `ArticleSection`, `ArticleHistoryEntry` | Canonical. |
| `frontend/prisma/schema.prisma` L588–628 | `enum ArticleStatus`, `model Article` (`@@map("articles")`) | Canonical. Migrations `20260804100000_add_article`, `20260804110000_add_article_source_type`. |
| `frontend/app/platform/publishing/page.tsx` | Public marketing page for the Publishing module | Static copy; links to `/dashboard/publishing`. |

### B. Dead / architecture-only (zero non-comment references)

| Path | What it claims to be | Reality |
| --- | --- | --- |
| `frontend/services/ai/publishing/publisher.service.ts` | `PublishingJob` factory + `SUPPORTED_CHANNELS` (`website/blog/rss/newsletter/telegram/twitter/linkedin`) + `runJob()` | **Placeholder.** `runJob()` returns `{...job, status:"done"}` with no work. Nothing imports it. |
| `frontend/types/publishing-job.ts` | `PublishChannel`, `JobStatus`, `PublishingJob` | Type-only. No persistence, no callers. |
| `frontend/services/ai/publishing/internal-link.service.ts` | `getRelatedArticles()`, `getSuggestedReading()` | Nothing imports either function. |
| `frontend/data/mock-articles.ts` | Old hardcoded article list | Replaced by DB in D2.3.S1. Referenced only in code comments. |
| `docs/AI-Publishing-Architecture.md` | Architecture narrative | Partly stale ("Mock data + Gemini drafts. No external publishing integrations yet") — the article pipeline is now real/DB-backed, but the "no external integrations" part is still accurate. |

### Repository keyword sweep (task §2)

| Term | Real hits | Verdict |
| --- | --- | --- |
| `publish` / `publisher` / `publishing` | `services/publishing/*`, `services/ai/publishing/*`, `app/api/private/publishing/*`, `app/dashboard/publishing`, `app/platform/publishing`, `components/publishing/*` — plus **`MarketplaceListing.publicationState`** and `ReleaseArtifact.releaseStatus="PUBLISHED"` (separate lifecycle, different entity) | Two independent "publish" concepts: **Article** (content) and **MarketplaceListing** (product). Do not merge. |
| `publishingStatus` / `publishStatus` | none | Article uses `status` (typed `ArticleStatus`). |
| `scheduled` / `schedule` | `Article.scheduledFor` + `/schedule` route (write only); `WorkflowTrigger.scheduled`, `AgentRunTrigger.schedule` (both **unused**); `vercel.json` 2 daily crons (intelligence only); `content-planner` static array | No scheduler consumes `Article.scheduledFor`. |
| `destination` / `channel` | `PublishChannel` (dead type), `SUPPORTED_CHANNELS` (dead const) | **No real destination anywhere.** |
| `externalId` / `externalUrl` | none | Not modeled. |
| `webhook` | Stripe / NOWPayments payment webhooks only | No publishing webhook, inbound or outbound. |
| `retry` | `limit-enforcer.ts` `retriesUsed` (agent tool-call retries); `ApiClient` `retries` (client fetch) | No publish-level retry. |
| `queue` / `job` | `WorkflowQueueItem` (14E, read-only, faked); `JobStatus` (dead type); agent `AgentRun` (real, but not a generic queue) | No publishing job/queue. |
| `automation` / `automationRun` | `Automation` (14D), `Workflow`/`WorkflowRun` (14E), `AgentRun` (AN) | Three overlapping models; none executes today. |
| `content` | `types/content-category.ts` (`ContentCategory` — 9 values), `services/ai/publishing/content-*` | No generic `Content` model. `Article` is the content entity. |
| `strategy` / `marketplace` / `marketplaceListing` | `model Strategy`, `model MarketplaceListing`, `services/marketplace/*` | Real; candidate *sources*, not part of the article pipeline today. |

---

## Database Reuse Analysis

Relevant models (Prisma schema line refs):

| Model | Key fields | Ownership | Status field | Timestamps | Reusable by Publishing? |
| --- | --- | --- | --- | --- | --- |
| **`Article`** (L604) | `title, category, summary, sections(Json), disclaimer, seo(Json), slug, status(enum ArticleStatus), sourceType, scheduledFor, publishedAt, history(Json)` | `userId` (denormalized, no FK) | `enum ArticleStatus { draft, scheduled, published, failed }` | `createdAt, updatedAt, deletedAt` (soft delete) | **Yes — this is the content entity.** `@@unique([userId, slug])`, `@@index([userId, status])`. |
| `MarketplaceListing` (L948) | `publicationState(String): DRAFT\|SUBMITTED\|UNDER_REVIEW\|EVIDENCE_PENDING\|VALIDATION_PENDING\|READY\|PUBLISHED\|SUSPENDED\|RETIRED`; `trustState` (separate axis) | `sellerId` | `publicationState` (string, not enum) | std + soft delete | **Reference only.** A real, richer publish state machine already exists here for *products*. Good prior art; do not reuse the row. |
| `AuditLog` (L397) | `actorUserId, action(String), targetType, targetId?, metadata(Json?)` | actor | n/a (event log) | `createdAt` only; **no update/delete path by design** | **Yes — observability.** Add `article.*` / `publishing.*` action strings (union in `AuditLogService.ts` L11). Already carries `marketplace.published`/`marketplace.unpublished`. |
| `AgentRun` / `AgentStep` / `AgentToolCall` / `AgentEvidence` (L1547+) | resumable run + immutable ordered trace + evidence lineage; `AgentRunTrigger { manual, schedule, event, supervisor }`; `AgentRunStatus` (14 states incl. `cancelled`, `credit_limit`) | `userId` | rich `AgentRunStatus` enum | std | **Yes — as the execution substrate** if publishing ever needs a bounded/resumable job (e.g. multi-destination fan-out). No second runtime needed. |
| `AgentCreditLedgerEntry` (L1770) | append-only, **unique `idempotencyKey`**, `charge`/`refund` atomic | `userId` | `AgentCreditEntryKind` | `periodStart` denormalized | **Yes — if publishing is metered.** Idempotency primitive already solved. |
| `Workflow` / `WorkflowRun` / `WorkflowQueueItem` (L316+) | `trigger, schedule(String?), status, steps(Json)` | `userId` | `enum RunStatus { queued, running, success, failed }` | std | **No — reconcile, don't extend.** 14E; runs are faked client-side (see below). |
| `Automation` (L222) | `name, trigger(String), enabled` | `userId` | none | std | **No — 14D minimal stub.** List-only API, no executor. |
| `IntelligenceAnalysisRun` (L668) | persisted deterministic analysis snapshot | `userId` | `evaluationStatus` | std | Candidate *source* of article body content; not a publishing model. |

**New model required?** For P2 Beta: **a small `PublishingDestination` + `PublishingJob`/`PublishingAttempt` set is genuinely new** (nothing represents "an external target" or "an attempt to push content there, with an external ref and a retry count"). Everything else (content, audit, credits, run substrate, idempotency key) is reuse. `Article` should stay the single content entity — do **not** add a generic `Content` model (task §7): no second publishable entity is in Beta scope.

---

## Automation Integration Analysis

### The three-model conflict (already escalated, on HOLD)

`661106d docs(automation): R&D + architecture deliverables (implementation on
HOLD)` committed 8 `frontend/docs/architecture/AUTOMATION_*.md` files. That R&D
pass found **exactly the conflict Publishing also has to navigate**:

| Model | Sprint | State today |
| --- | --- | --- |
| `Automation` | 14D | `GET /api/private/automations` list only. No runs, no executor. |
| `Workflow` / `WorkflowRun` / `WorkflowQueueItem` | 14E | `GET /api/private/workflows` read model. UI at `/dashboard/automation`. **Runs are faked** — `onRun()` pushes an optimistic client-side `success` run; no executor is wired to any action. |
| `AgentRun` (+ steps/tools/evidence) | AN A1–A15 | **Real, shipped, tested.** Resumable `tick()`-per-request runtime, idempotent credit ledger, per-tool authz, immutable trace, cancellation, ownership-scoped observability. `AgentRunTrigger.schedule` **exists and is unused**. |

`AUTOMATION_DECISION.md` is **NOT LOCKED** — blocked on **PENDING-1** (which
model wins), **PENDING-2/-3** (scheduler on the Hobby plan). Implementation is
STOPPED per that sprint's §26.

### Answers to task §4

1. **Can an Automation trigger a publishing job today?** **No.** There is no
   automation executor in the product. The only real run engine is `AgentRun`,
   and no agent has a publishing tool.
2. **Cleanest integration point (when automation ships):** the
   `AUTOMATION_DECISION.md` §10 contract is already written and is the right
   shape — *Automation's only publishing capability is
   `articleService.createDraft(userId, { category, keywords, aiOverviewText })`
   via a `publication_draft` step; it has **no** path to `publish`, `schedule`,
   `duplicateAsDraft`, or `remove`.* Publishing should expose exactly one
   automation-callable seam (`createDraft`) and keep every state transition
   inside Publishing's own permissions. This preserves
   `execution_succeeded ≠ analysis_verified ≠ publication_approved ≠ publication_published`.
3. **Can scheduled publishing reuse existing scheduling infra?** Partially. The
   **cron mechanism** (`vercel.json` crons + `lib/intelligence/cron-auth.ts`
   `isValidCronSecret` — constant-time `Bearer` check, accepts Vercel's native
   `CRON_SECRET`) is reusable. The **constraint** is load-bearing: Vercel
   **Hobby** allows **one cron run per path per day** (a sub-daily schedule in
   `vercel.json` silently blocks all deploys — this caused a ~1-day outage, PR
   #34). A minute-resolution "publish at 14:32" scheduler is **not possible on
   the current plan**. Beta options = fixed daily UTC slots, or Vercel Pro, or
   an external scheduler → identical to `AUTOMATION_DECISION.md` PENDING-2.
4. **Can retry reuse existing job infra?** The agent runtime's bounded
   transient-retry (`limit-enforcer.ts`) covers *tool-call* retries inside a
   run. It does **not** cover "re-attempt a failed publish to WordPress in 5
   minutes" — that is new and belongs to a `PublishingAttempt` row + the daily
   cron re-scanning `failed` attempts.
5. **What must Publishing expose to Automation?** One idempotent method:
   `createDraft` (returns the `Article`). Nothing else.
6. **What must Automation provide to Publishing?** `userId` (server session,
   never body), `category`, `keywords`, and optionally `aiOverviewText` from an
   upstream agent step. Plus a stable `idempotencyKey` so a re-dispatched
   automation run doesn't create duplicate drafts.

---

## Authentication & Authorization

| Concern | Mechanism | File |
| --- | --- | --- |
| Authenticated user (pages) | `requireUser()` → redirect `/login`; `/dashboard/*` guarded at layout | `lib/auth/protectedRoute.ts`, `app/dashboard/layout.tsx` |
| Authenticated user (API) | `getUserOrNull()` → `sessionUser.profile.id`; handler returns 401 JSON | every `app/api/private/publishing/**` route |
| Ownership | `ArticleService.findOwned(userId, id)` → `prisma.article.findFirst({ where: { id, userId, deletedAt: null } })`; throws `Errors.notFound("Article")` (404, not 403 — never leaks another user's row's existence) | `services/publishing/article.service.ts` L116 |
| `userId` never from body | All publishing routes read it from the session only | verified across all 5 route files |
| Roles / admin | `assertRole("admin")` / `requireAdmin()` exist and are used by `/api/private/admin/*` | `lib/auth/protectedRoute.ts`, `lib/auth/adminRoute.ts` — **not used by Publishing** (nor needed for a per-user CMS) |
| Plan / entitlement gating | `FeatureMeta { requiredPlan }` is declared on every `services/ai/publishing/*` service (`publisher`=premium, `content-generator`=pro, …) but **nothing enforces it** for Publishing. `PLAN_LIMITS` / `config/plan-limits.ts` exists (used by agent credits). | not wired |
| Cron auth | `isValidCronSecret(req)` constant-time `Bearer <CRON_SECRET>` | `lib/intelligence/cron-auth.ts` |

### Minimum permission model for P2 Publishing

- **Draft/edit/schedule/publish/duplicate/delete an Article:** owner only
  (current model — keep). Ownership check on every op via `findOwned`.
- **Configure a `PublishingDestination` (credentials):** owner only, and the
  credential value must be write-only from the client's perspective (never
  returned in a `GET`). Consider `role="admin"` for *shared/site-wide*
  destinations vs per-user destinations.
- **Trigger a scheduled publish (cron):** `isValidCronSecret` **OR**
  `requireAdmin` — the established `admin/intelligence/ingest-news` pattern.
  Never a plain logged-in user.
- **Automation → `createDraft`:** child run carries the requester's `userId`;
  no widening.

### Places P2 could accidentally allow abuse (flag, do not fix)

| Risk | Where it would arise |
| --- | --- |
| Cross-user access | If any future `GET /articles/:id` or destination lookup drops the `userId` filter. Current path-parse pattern (`articleIdFromPath`) + `findOwned` is safe; keep the filter in **every** new query. |
| Unauthorized publish | If the cron dispatch route runs a user's scheduled article without re-checking the article still belongs to a valid, active user / the destination still belongs to that user. |
| Unauthorized retry/cancel | No cancel/retry exists yet; when added, both must be `findOwned`-scoped (a `PublishingAttempt` must resolve through its `Article.userId`). |
| Privilege escalation via destination creds | A per-user destination that stores an API token: if a `GET` ever echoes the token, or if destination rows aren't `userId`-scoped, user A could publish through user B's WordPress. |
| Automation widening | If Publishing exposes `publish`/`schedule` to automation instead of only `createDraft`. |
| Plan bypass | `requiredPlan` is declared but unenforced — a free user can generate unlimited AI drafts today. Decide in P2 whether Publishing is metered (reuse `CreditLedger`) or not. |

---

## Destination Audit

**No real destination is implemented. None. Anywhere.**

| Candidate | Source | Status |
| --- | --- | --- |
| `website` / `blog` | `SUPPORTED_CHANNELS`, `PublishChannel`, `Article.seo.canonicalUrl` → `https://algotraders24.ai/blog/<slug>` | **D — Not implemented.** No `/blog` route exists; the canonical URL is a dead link. `publish()` does not render or serve anything. |
| `rss` / `newsletter` | `SUPPORTED_CHANNELS` | **D — Not implemented.** No feed route, no email service in the repo. |
| `telegram` / `twitter` / `linkedin` | `SUPPORTED_CHANNELS` | **D — Not implemented.** No credentials, no client, no adapter. `docs/AI-Publishing-Architecture.md` explicitly says "No external publishing integrations yet." |
| WordPress / Sanity / Contentful / Strapi / Ghost | `docs/AI-Publishing-Architecture.md` "Future" section | **D — Not implemented.** Aspirational only. |
| `MarketplaceListing` publish | `services/marketplace/*`, `publicationState` machine, `auditTrail.recordPublished()` | **A — implemented, but a different product.** This is the *only* place in the codebase where a "publish" verb does real, audited, state-machine work. It publishes a *marketplace product listing*, not content. Study it as prior art (audit trail, derived state, `PUBLICLY_VISIBLE_STATES` gate in `MarketplaceCatalogue.ts`), but it is not an Article destination. |

- **A. Actually implemented:** (Article destinations) none.
- **B. Partially implemented:** none.
- **C. UI/mock only:** none even reaches the UI — `page.tsx` has a *category*
  selector, not a *destination* selector. `SUPPORTED_CHANNELS` never renders.
- **D. Not implemented:** every channel listed above.

For every field the task asks per destination (API, auth mechanism, credentials,
publish/schedule/unpublish/update capability, `externalId`, `externalUrl`,
webhook, rate-limit handling, retry): **N/A — no destination record type
exists.**

---

## Content / Source Mapping

| Source | Model / ID | Content available | Metadata | Owner | Versioning | Public/private today |
| --- | --- | --- | --- | --- | --- | --- |
| **AI assistant output** | via `sendMessage()` → text; not persisted on its own | prose overview text | none | session user | none | wired **now** as `aiOverviewText` into `createDraft` |
| **Article (self)** | `Article.id` (cuid) | `title, summary, sections[], disclaimer, seo` | `category, sourceType, history[]` | `Article.userId` | none — published rows read-only; revise = `duplicateAsDraft` (new row). Schema comment marks this as the seam for a future version table. | private (no public render) |
| Intelligence analysis | `IntelligenceAnalysisRun.analysisResult` (deterministic `MarketIntelligenceResult`) | evidence + reasoning + risk + confidence | `symbol, timeframe, createdAt` | `userId` | snapshot per run | private |
| Research / Knowledge | `Knowledge` + `KnowledgeChunk`; `ResearchSnapshotService` | documents / chunks | tags, category | `userId` | none | private |
| Strategy / Backtest | `Strategy`, `AlgoTestRun` | strategy IR, backtest metrics | many | `userId` | `Strategy` has version fields | private |
| Agent output | `AgentRun.output` + `AgentEvidence` | evidence-backed synthesis | full trace | `userId` | immutable run | private |
| Marketplace listing | `MarketplaceListing` | seller copy + AT24 trust fields | `publicationState`, `trustState` | `sellerId` | `versionId` string ref | **public** when `publicationState ∈ {READY, PUBLISHED}` |

**Conclusion:** `Article` is the one publishable *content* entity and should stay
that way for P2. Other sources feed *into* an Article's body (already
demonstrated with AI text). **Do not build a generic `Content` model** — task
§7 and the automation R&D both reach this.

---

## API / Service Architecture

**Layering (established, follow it):**

```
React ("use client")  →  app/api/private/**/route.ts  →  services/**  →  prisma / lib  →  (agent runtime / external)
```

| Convention | Implementation | Reuse for P2 |
| --- | --- | --- |
| Route wrapper | `withContext(async (req, ctx) => …)` — `ctx.requestId`, `ctx.startedAt`, `ctx.path`, structured logging, centralized error mapping | all P2 routes |
| Responses | `ApiResponse.success(data, requestId, status, startedAt)` / `ApiResponse.error({code,message,details}, …)` | all P2 routes |
| Validation errors | `Errors.validation(msg)`, `Errors.notFound(entity)`, `Errors.conflict(msg)` (typed `AppError` → HTTP) | all P2 |
| Auth | `getUserOrNull()` in handler; 401 JSON if null; `userId` from session only | all P2 |
| Dynamic route params | Middleware does **not** thread Next `params`; id is parsed from `ctx.path` (`articleIdFromPath`) — matches `conversations/[conversationId]` | keep pattern |
| Data access | `RepositoryFactory` (mock/Prisma dual mode) for 14x models; **newer services (`ArticleService`, agent framework) use `prisma` directly** | new P2 code: `prisma` directly is acceptable and current |
| Service shape | plural export of a class instance (`export const articleService = new ArticleService()`); pure helpers separate | `publishingService` / `destinationService` |
| Serverless bound | `export const maxDuration = 60` on routes that do work | cron dispatch route |
| Tests | **No Vitest.** `scripts/validate-*.ts` standalone `node:assert/strict` harness via `tsx` + `validate:*` in `package.json` | `validate-publishing-*.ts` |
| Migrations | timestamped `prisma/migrations/*`; applied with `migrate deploy` against prepared SQL — **never `migrate dev`** (resets pgvector on the shared DB) | P2 schema change |
| Audit | `auditLogService.record({ actorUserId, action, targetType, targetId, metadata })` — append-only | P2 observability |

**Which layer owns publishing logic:** `services/publishing/` (already does).
Extend `ArticleService` or add a sibling `PublishingService` /
`DestinationService`. No logic in components.

---

## Lifecycle / Status Analysis

| Enum | Where | Values | Used? |
| --- | --- | --- | --- |
| `ArticleStatus` | `prisma` L588 + `types/article.ts` | `draft, scheduled, published, failed` | **Yes.** `failed` is declared but **never set by any code** (no executor to fail). |
| `ArticleHistoryEntry.action` | `types/article.ts` | `created, edited, scheduled, published, deleted` | Yes — append-only `history` JSON, rendered in `ArticlePreview`. |
| `JobStatus` | `types/publishing-job.ts` | `queued, running, done, failed` | **No** — dead type. |
| `RunStatus` | `prisma` L309 (14E) | `queued, running, success, failed` | Read model only. |
| `AgentRunStatus` | `prisma` L1476 | 14 states incl. `queued, planning, running, awaiting_approval, succeeded, failed, cancelled, credit_limit, …` | Yes — real runtime. |
| `MarketplaceListing.publicationState` | `prisma` L984 (string) | `DRAFT, SUBMITTED, UNDER_REVIEW, EVIDENCE_PENDING, VALIDATION_PENDING, READY, PUBLISHED, SUSPENDED, RETIRED` | Yes — real product-listing machine. |

**Is there a compatible contract to reuse?** `ArticleStatus` is the closest and
should remain the **content** status. It is missing the states a real engine
needs for the *distribution* step: `publishing` (in-flight),
`partially_published` (some destinations ok), `unpublished`, `cancelled`.
Recommendation: **keep `ArticleStatus` for the Article**, and introduce a
**separate `PublishingJob`/`PublishingAttempt` status axis** (mirroring how
`MarketplaceListing` keeps `publicationState` separate from `trustState`, and how
the automation R&D keeps `AutomationRun` status separate from child `AgentRun`
status). Do not overload one enum with both "is the content ready" and "did the
push to WordPress succeed."

---

## Idempotency / Duplicate-Publishing Analysis

| Protection | Exists today? | Detail |
| --- | --- | --- |
| Double *publish* of one Article | **Weak.** `update()` rejects edits to a `published` row (`Errors.conflict`), but `publish()` itself has no "already published" guard — a second `POST /publish` re-runs the validation gate, re-sets `status=published` + a fresh `publishedAt`, and appends another `published` history entry. Harmless today (no distribution) but wrong for P2. |
| Duplicate draft from a re-dispatched automation | **None.** `createDraft` always inserts. `@@unique([userId, slug])` would collide only if the title (→ slug) is identical; `generateArticle` derives the slug from a fixed `CATEGORY_TITLES[category]`, so **two AI drafts in the same category for the same user DO collide on the unique index** → the second `create` throws a Prisma P2002. (Incidental, not a designed guard, and a poor UX.) |
| Duplicate external post | **N/A** — no external post. |
| Repeated webhook processing | **N/A** — no inbound webhook. |
| Retry-created duplicates | **N/A** — no retry. |
| Idempotent metered charge | **Available, unused by Publishing:** `CreditLedger.charge()` is atomic + idempotent on a unique `idempotencyKey` (`AgentCreditLedgerEntry`). |

**P2 requirement.** Needs: (a) a unique `(articleId, destinationId, contentHash)`
or `(automationRunId, stepIndex)` key on the job/attempt row; (b) a
`publish()` no-op-or-conflict guard when already `published`; (c) store the
external provider's returned id (`externalId`) and treat "provider already has
this" as success, not a new post.

---

## Observability Analysis

| Facility | Exists | Publishing uses it? |
| --- | --- | --- |
| Structured request logs | `services/backend/Logger.ts` via `withContext` (requestId, method, path, durationMs) | Yes (automatic) |
| Error mapping + log | `services/backend/ErrorHandler.ts` | Yes (automatic) |
| Append-only audit trail | `AuditLog` + `AuditLogService.record()` — immutable, no update/delete path | **No `article.*` actions yet.** Article `history` JSON is the only trail. |
| Per-article history | `Article.history` (Json, append-only in service) — `{action, actor, timestamp, metadata?}` | Yes — rendered in `ArticlePreview`. Not queryable across articles. |
| Analytics events | `AnalyticsEvent` model | No publishing events |
| Agent run trace / evidence | `AgentStep` / `AgentToolCall` / `AgentEvidence` (immutable, ordered) + `getRunObservability(runId,{requesterId})` (ownership-scoped) | Only if publishing runs through an agent |
| Provider call logs | `ProviderCallLog`, `ProviderQuota` (market-data / news providers) | Good prior art for logging external-destination API calls + rate limits |

**Required future visibility (task §11) vs today:**

| Need | Today | P2 source |
| --- | --- | --- |
| who initiated | `history[].actor` = `userId` | keep + `AuditLog.actorUserId` |
| what was published | article row | `PublishingJob.articleId` + `contentHash` |
| where | — | `PublishingJob.destinationId` |
| when | `publishedAt`, `history[].timestamp` | + per-attempt `completedAt` |
| result | `status` | `PublishingAttempt.status` |
| external reference | — | `PublishingAttempt.externalId` / `externalUrl` |
| failure reason | — (`failed` never set) | `PublishingAttempt.error` |
| retry count | — | `PublishingAttempt.attempt` |

**Recommendation:** add `article.drafted / scheduled / published / unpublished /
publish_failed` to `AuditLogService`'s `AuditAction` union (mirrors the
`marketplace.*` precedent), and model per-destination attempts explicitly.

---

## UI ↔ Backend Gap Matrix

| UI capability | In the UI? | Backend exists | Real or mock | Gap |
| --- | --- | --- | --- | --- |
| Create draft | Yes ("Generate AI Draft" + category) | `POST /articles` → `createDraft` | **Real** (AI text persisted, quality-gated) | Slug collision on a 2nd same-category draft (`@@unique([userId,slug])` → P2002). |
| Preview | Yes (`ArticlePreview`) | client render of persisted row | **Real** | Not a rendered "as it will appear publicly" preview — there is no public template. |
| Select destination | **No** (category selector only) | **None** | — | **Total gap.** No destination concept in UI or backend. |
| Publish now | Yes ("Publish now") | `POST /articles/:id/publish` → validation-gated `status=published` | **Real DB write / mock distribution** | Nothing renders or transmits the published article. `canonicalUrl` is a 404. No `publishing` in-flight state. No double-publish guard. |
| Schedule | Yes (`datetime-local` + "Schedule") | `POST /articles/:id/schedule` → `status=scheduled` + `scheduledFor` | **Real write / no execution** | No worker/cron reads `scheduledFor`. A scheduled article stays scheduled forever. |
| Cancel | **No** | **None** | — | Can't return a `scheduled` article to `draft`; can't cancel an in-flight publish. |
| Retry | **No** | **None** | — | `failed` is never set; nothing to retry; no retry endpoint. |
| Publish history | Yes (`ArticlePreview` history list) | `Article.history` JSON | **Real** | Per-article only; not cross-article queryable; not in `AuditLog`. |
| Status | Yes (`PublishingStatus` badge; `PublishingQueue` table) | `Article.status` | **Real** | `failed` badge styling exists but is unreachable. |
| Error display | Yes (`actionError`, validation `issues[]` surfaced) | route returns `code:"VALIDATION", details.issues` | **Real** | No surface for distribution/transport errors (none occur). |
| Content calendar | Yes (`ContentCalendar`) | `content-planner.getDailySchedule()` | **Mock** — hardcoded static array | Not connected to scheduling, not user-editable, not persisted. |
| Publishing queue | Yes (`PublishingQueue`) | derived from `articles` list (status `scheduled`/`draft`) | **Real data, cosmetic** | It's a filtered table, not a job queue; no queue table backs it. |

---

## Security Findings

**No secrets are printed here. No publishing secrets exist to print.**

| Config name | Where used | Server-only? | Exposure risk |
| --- | --- | --- | --- |
| `CRON_SECRET` / `INTELLIGENCE_EVALUATION_CRON_SECRET` | `lib/intelligence/cron-auth.ts`, intelligence cron routes | Yes (never referenced client-side; no `NEXT_PUBLIC_` prefix) | None found. Constant-time compare. Would be **reused** by a P2 publish-dispatch cron. |
| `STRIPE_WEBHOOK_SECRET` / `STRIPE_SECRET_KEY` / `NOWPAYMENTS_*` | payment webhooks / checkout | Yes | Out of scope for Publishing. |
| Gemini / AI provider keys | `services/ai/*`, prompt engine | Yes | Used indirectly by "Generate AI Draft" via `/api/private/knowledge/chat`. No key touches the publishing layer directly. |
| **(none)** WordPress / Ghost / Telegram / X / LinkedIn / SMTP | — | — | **These do not exist.** P2 introduces the first publishing-provider credentials — that is a **new secret-storage surface** and the highest-value security design task in P2. |

**Findings:**

1. **No publishing code handles any secret today** → clean slate, no leak to
   remediate.
2. **Article `history` and `AuditLog.metadata` are the injection points to
   watch in P2** — when destination adapters are added, an adapter must never
   write a token/response-with-token into `history`, `metadata`, `log`, or a
   thrown error message. (The codebase already has this discipline: `AuditLog`
   comment says "real before/after values, never a summary" but adapters will
   need an explicit redaction rule.)
3. **`Article.seo.canonicalUrl` is a hardcoded `https://algotraders24.ai/blog/`
   prefix** in `seo.service.ts` — currently a dead link, but if a `/blog` route
   is added in P2 it will publish user-authored `sections[].body` HTML/markdown
   verbatim → **stored-XSS surface**. Sanitize on render.
4. **No plan/credit enforcement on AI draft generation** → an authenticated
   free user can call the Gemini-backed generate path without limit. Not a
   secret exposure, but a cost/abuse vector to close in P2.
5. **Cron/dispatch routes must use `isValidCronSecret` OR `requireAdmin`** (the
   `ingest-news` pattern) — never a plain session — when P2 adds a
   scheduled-publish trigger.

---

## Reusable Components

**Directly reusable, no change:**

- `services/publishing/article.service.ts` — content CRUD + lifecycle + validation gate + ownership scoping.
- `services/ai/publishing/{content-generator,seo,article-validator}.service.ts` — pure, deterministic helpers.
- `prisma model Article` + `enum ArticleStatus` + `@@unique([userId, slug])` + `@@index([userId, status])`.
- `AuditLog` + `AuditLogService.record()` — append-only observability (add action strings).
- `lib/intelligence/cron-auth.ts` — `isValidCronSecret` for a dispatch route.
- `lib/auth/{protectedRoute,adminRoute}.ts` — `getUserOrNull`, `assertRole`, `requireAdmin`.
- `services/backend/{Middleware,ApiResponse,ErrorHandler,Logger}.ts` — route conventions.
- **Agent Framework** (`services/agent-framework/`) — resumable runtime, `CreditLedger` (idempotent `charge/refund`), `AgentEvidence` lineage, `getRunObservability` (ownership-scoped), `AgentRunTrigger.schedule` (reserved, unused). Use as the *execution substrate* if P2 publishing needs bounded/resumable multi-destination jobs.
- `scripts/validate-*.ts` harness + `validate:*` package scripts — P2 test pattern.
- **Prior art to copy, not import:** `services/marketplace/factory/{submissionState,auditTrail}.ts` + `MarketplaceListing.publicationState` + `MarketplaceCatalogue` `PUBLICLY_VISIBLE_STATES` gate — a working, audited, derived-state publish machine.
- **Prior art:** `ProviderCallLog` / `ProviderQuota` — logging + rate-limiting external provider calls.
- The `frontend/docs/architecture/AUTOMATION_*.md` R&D set — already contains the reuse analysis, the Hobby-cron constraint analysis, and the Publishing↔Automation contract (`AUTOMATION_DECISION.md` §10).

**Reusable UI:** all 6 `components/publishing/*` (thin, presentational) + `page.tsx` fetch orchestration.

---

## Missing Components

1. **A public reader surface** — `publish()` produces nothing a reader can see. Either a `/blog` (or `/insights`) route rendering published Articles, or a real external destination. Until one exists, "published" is a private label.
2. **`PublishingDestination` model** — the first-class concept of "a target to publish to" (kind, config/credentials-ref, per-user vs shared, enabled).
3. **`PublishingJob` / `PublishingAttempt` model** — one row per (article → destination) push, with `status`, `externalId`, `externalUrl`, `attempt`, `error`, `contentHash`, idempotency key. Separate status axis from `ArticleStatus`.
4. **A `DestinationAdapter` interface** — `publish() / update() / unpublish()` returning `{ externalId, externalUrl }`; one implementation per real channel. `publisher.service.ts` gestures at this but is dead and channel-string-based, not interface-based.
5. **A scheduled-publish executor** — a cron-authed dispatch route that scans `Article.status = "scheduled" AND scheduledFor <= now()` (and `PublishingAttempt` retryable failures) and drives them. Constrained by the Hobby daily-cron limit → fixed UTC slots for Beta.
6. **Idempotency + double-publish guard** — as in *Idempotency Analysis*.
7. **`article.*` audit actions** in `AuditLogService`.
8. **Plan/credit enforcement** decision for AI generation + (maybe) publishing.
9. **Content sanitization** on any public render of `sections[].body`.
10. **Reconciliation of the three automation models** (PENDING-1) — a hard dependency only if P2 wants automation-triggered drafts in the same sprint; not a dependency for a user-driven publishing engine.

---

## Risks / Blockers

| # | Risk / Blocker | Severity | Notes |
| --- | --- | --- | --- |
| R1 | **Vercel Hobby: 1 cron run / path / day.** A sub-daily `vercel.json` schedule silently blocks all production deploys (prior ~1-day outage, PR #34). | **High** | No minute-resolution scheduling on the current plan. Beta must use fixed daily UTC slots, or upgrade to Pro, or an external scheduler. Same as `AUTOMATION_DECISION.md` PENDING-2. |
| R2 | **Three overlapping automation/workflow models**, `AUTOMATION_DECISION.md` NOT LOCKED (PENDING-1/-2/-3), implementation STOPPED. | **High** (only if P2 wants automation-triggered publishing) | Publishing's own draft/schedule/publish flow is independent of this and can proceed. |
| R3 | **`published` currently means nothing to a reader.** Shipping "real publishing" without a reader surface or a real destination would be a no-fabrication-policy problem (claiming distribution that doesn't happen). | **High** | P2 must ship at least one genuine destination (internal `/blog` counts) or explicitly scope-limit the claim. |
| R4 | `migrate dev` resets pgvector on the shared DB. | Medium | Any P2 schema change uses prepared SQL + `migrate deploy`. |
| R5 | Slug uniqueness collision on same-category AI drafts (`P2002`) is a live UX bug today. | Low–Medium | Fixable in P2 (dedupe slug with a counter / date). |
| R6 | `content-planner` calendar is hardcoded and disconnected — users may believe it drives scheduling. | Low | Clarify or wire in P2. |
| R7 | Dead code (`publisher.service.ts`, `publishing-job.ts`, `internal-link.service.ts`, `mock-articles.ts`) invites a future dev to "just wire it up" on a wrong (channel-string, no-interface, no-idempotency) foundation. | Low | Delete or clearly supersede in P2. |
| R8 | New provider-credential storage in P2 is a new secret surface + adapter redaction discipline. | Medium | Design explicitly; don't let tokens reach `history`/`metadata`/logs. |
| R9 | No plan/credit gate on AI generation. | Medium | Cost/abuse vector. |

---

## P2 Recommendations

**(Design only — see the STOP notice in the next section. Nothing here is to be
implemented in P1 or without the owner sign-offs P2 requires.)**

### Proposed implementation order

1. **Decide the P2 destination scope.** Recommendation: **internal `/blog`
   first** — a real, owned, sanitized public render of a published `Article`.
   It is a genuine destination (closes R3), needs no third-party credentials
   (defers R8), and validates the whole pipeline. External adapters (WordPress
   etc.) come after.
2. **Publishing Contract (types + Zod-style guards, no schema yet).**
   - `PublishingDestination { id, userId?, kind: "internal_blog" | "wordpress" | …, label, config, enabled }` — `config` is a credential *reference*, never a raw secret returned to the client.
   - `PublishingJob { id, articleId, userId, destinationId, status, scheduledFor?, contentHash, idempotencyKey, createdAt }`.
   - `PublishingAttempt { id, jobId, attempt, status, externalId?, externalUrl?, error?, startedAt, completedAt }`.
   - `PublishingJobStatus = pending | publishing | published | partially_published | failed | cancelled` — **a separate axis** from `ArticleStatus`.
3. **`DestinationAdapter` interface** in `services/publishing/destinations/`:
   `publish(article, config): Promise<{ externalId; externalUrl }>`,
   `update(...)`, `unpublish(externalId, config)`. One `InternalBlogAdapter`
   implementation. Delete `publisher.service.ts` / `publishing-job.ts` /
   `internal-link.service.ts` (dead) in the same PR to avoid two competing
   foundations.
4. **Idempotency + retry policy.**
   - Unique index `PublishingJob (articleId, destinationId, contentHash)`.
   - `publish()` on an already-`published` Article → conflict/no-op, not a 2nd write.
   - Retry: `PublishingAttempt.attempt` capped (e.g. 3), exponential slot-based backoff; only the daily cron re-attempts; a job with a live `externalId` is never re-created.
   - If metered: reuse `CreditLedger.charge({ idempotencyKey: "pub:<jobId>:<attempt>" })`.
5. **Scheduling.** A `POST /api/private/publishing/dispatch` route, auth =
   `isValidCronSecret(req) || requireAdmin(...)`, `maxDuration = 60`, capped
   batch per invocation. `vercel.json` gets **one daily slot cron** (Hobby
   limit); per-article time is a preset aligned to a slot, not a free clock
   (mirror `AUTOMATION_ARCHITECTURE.md §4`). Owner sign-off on the slot list.
6. **Publish history + audit trail.** Add `article.drafted/scheduled/published/
   unpublished/publish_failed` to `AuditLogService.AuditAction`; write one row
   per real transition (mirror `marketplace.*`). Keep `Article.history` for the
   per-article view; `AuditLog` for the cross-article/admin view.
7. **Automation seam (only if in scope).** Expose exactly
   `articleService.createDraft` to automation, per `AUTOMATION_DECISION.md`
   §10 — no `publish`/`schedule`/`delete`. Requires PENDING-1 resolved.
8. **First real external destination** (WordPress/Ghost REST) — after 1–6 are
   proven on `internal_blog`. This is where R8 (secret storage, adapter
   redaction, rate-limit handling via a `ProviderCallLog`-style record) gets
   its full design.

### Explicitly NOT in P2 Beta (recommend)

- Email/newsletter/RSS/Telegram/X/LinkedIn (no service or credentials exist; large surface).
- A generic `Content` model (Article is the entity).
- Automation-level whole-run retry.
- Event/price/indicator-triggered publishing.
- A second execution runtime (use the Agent Framework's if needed).

---

## P2 MUST NOT Be Implemented

Per the sprint rules, this document is the P1 deliverable. **P2 (Publishing
Contract, Publishing Job, Publishing Status, Destination Adapter interface,
idempotency, retry policy, scheduling, publish history, audit trail, first real
destination) is design-only above and must not be implemented now.** It also
inherits the STOP conditions the sibling automation sprint is under
(`AUTOMATION_DECISION.md`: PENDING-1 model reconciliation, PENDING-2/-3
scheduler) wherever P2 touches automation-triggered publishing or sub-daily
scheduling.

Do not begin P2 automatically.

---

# Final Output

### P1 STATUS

**PASS** — the audit is complete; no blocker to *designing* P2. (Shipping P2 has
real blockers: R1 Hobby cron limit, R3 no reader surface, and R2/PENDING-1 if
automation-triggered drafts are in scope.)

### Existing Publishing (what actually exists today)

A real, per-user, DB-backed **article CMS** at `/dashboard/publishing`:
`Article` model with `draft → scheduled → published → failed` status,
deterministic SEO scoring, a validation gate on schedule/publish, an append-only
`history` log, AI-draft generation wired to the live Gemini path, and
duplicate-as-draft for revising published rows. Ownership is correctly enforced
(404, not 403, on another user's row). **`publish()` is a status flip with no
reader and no transport. `scheduled` is never executed. No destination, queue,
job, retry, webhook, `externalId`, or `externalUrl` exists in real code.**

### Reusable (build directly on)

`Article` model + `ArticleStatus`; `services/publishing/article.service.ts`;
the pure `content-generator` / `seo` / `article-validator` helpers; `AuditLog` +
`AuditLogService`; `lib/intelligence/cron-auth.ts`; the
`withContext`/`ApiResponse`/`Errors` route conventions; `getUserOrNull` /
`requireAdmin`; the **Agent Framework** runtime + idempotent `CreditLedger` +
evidence/observability as an execution substrate; the `scripts/validate-*.ts`
test pattern; `MarketplaceListing.publicationState` + marketplace
`submissionState`/`auditTrail` as working prior art; the committed
`AUTOMATION_*` R&D docs.

### Missing (must be implemented in P2)

A public reader surface (or a real external destination); `PublishingDestination`
+ `PublishingJob`/`PublishingAttempt` models; a `DestinationAdapter` interface
with ≥1 real implementation; a cron-authed scheduled-publish executor
(Hobby-slot-constrained); idempotency + double-publish guard; `article.*` audit
actions; a plan/credit-gate decision; content sanitization on public render.

### Critical Findings

1. **`published` has no reader** — `seo.canonicalUrl` (`/blog/<slug>`) is a 404;
   no route renders an `Article`. Shipping "publishing" without fixing this
   risks claiming distribution that doesn't occur.
2. **`scheduled` is inert** — nothing reads `Article.scheduledFor`.
3. **All channel/job/destination artifacts are dead code** —
   `publisher.service.ts`, `types/publishing-job.ts`, `internal-link.service.ts`,
   `data/mock-articles.ts` have zero live references. Do not build P2 on them.
4. **Vercel Hobby: one cron per path per day** (R1) — hard constraint on any
   scheduler; a sub-daily cron silently blocks deploys.
5. **Three overlapping automation models, decision NOT LOCKED** — automation
   cannot trigger publishing today; the integration contract is written but
   PENDING owner sign-off. Publishing's user-driven flow is independent.
6. **Auth is sound today** — `userId` always from session, every op
   ownership-scoped. P2's new risk surface is destination credentials
   (per-user isolation, write-only from client, adapter redaction).
7. **No plan/credit enforcement** on AI draft generation despite declared
   `requiredPlan` FeatureMeta.

### Recommended P2 (exact implementation order)

1. Scope P2 destinations → **internal `/blog` first**.
2. Publishing Contract types (`PublishingDestination`, `PublishingJob`,
   `PublishingAttempt`, separate `PublishingJobStatus` axis).
3. `DestinationAdapter` interface + `InternalBlogAdapter`; delete the dead
   channel code.
4. Idempotency (unique `(articleId, destinationId, contentHash)`) + retry
   policy + double-publish guard.
5. Cron-authed `dispatch` route + one daily Hobby slot cron; preset-slot
   scheduling.
6. `article.*` audit actions + publish-history read model.
7. (If in scope) automation seam = `createDraft` only — needs PENDING-1.
8. First external adapter (WordPress/Ghost) — full secret-storage +
   rate-limit design here.

### Files Inspected

```
frontend/app/dashboard/publishing/page.tsx
frontend/app/platform/publishing/page.tsx
frontend/services/publishing/article.service.ts
frontend/services/ai/publishing/{publisher,content-planner,content-generator,seo,article-validator,internal-link}.service.ts
frontend/app/api/private/publishing/articles/route.ts
frontend/app/api/private/publishing/articles/[id]/{route,publish/route,schedule/route,duplicate/route}.ts
frontend/components/publishing/{ArticleCard,ArticlePreview,ContentCalendar,PublishingQueue,PublishingStatus,SEOScoreCard}.tsx
frontend/types/{article,publishing-job}.ts
frontend/data/mock-articles.ts
frontend/prisma/schema.prisma  (models User, Plan, Subscription, Product, Conversation, Message, Agent, AgentTask/Memory/Activity, Automation, Workflow/WorkflowRun/WorkflowQueueItem, Article + enum ArticleStatus, IntelligenceAnalysisRun, MarketplaceListing, ReleaseArtifact, Strategy, AgentRun/AgentStep/AgentToolCall/AgentEvidence, AgentCreditLedgerEntry, AuditLog)
frontend/prisma/migrations/{20260804100000_add_article,20260804110000_add_article_source_type,20260906040000_add_ai_news_pipeline}/migration.sql
frontend/app/api/private/{workflows,automations}/route.ts
frontend/repositories/PrismaWorkflowRepository.ts
frontend/services/api/WorkflowsApi.ts
frontend/vercel.json
frontend/lib/intelligence/cron-auth.ts
frontend/app/api/private/admin/intelligence/ingest-news/route.ts
frontend/lib/auth/{protectedRoute,adminRoute}.ts
frontend/services/backend/Middleware.ts
frontend/app/dashboard/layout.tsx
frontend/config/dashboard.config.ts
frontend/services/admin/AuditLogService.ts
frontend/services/agent-framework/  (agent-type-registry, api/agent-run-service, tools/registry-manifest, runtime/*, credits/*)
frontend/app/api/private/agents/framework/runs/route.ts
frontend/services/marketplace/factory/{submissionState,auditTrail}.ts
frontend/services/marketplace/MarketplaceCatalogue.ts  (publish gate)
frontend/.env.example
docs/AI-Publishing-Architecture.md
frontend/docs/architecture/AUTOMATION_RND.md
frontend/docs/architecture/AUTOMATION_DECISION.md  (headings + publishing/§10 contract)
git log: 661106d, 16c4526 (D2.3.S4), 7a11afd (D2.3.S1)
```

### Files Changed

`NONE` — except this audit document
(`frontend/docs/publishing/P1_EXISTING_SYSTEM_AUDIT.md`), which the sprint
permits.

### Final Recommendation

**Is AT24 ready to start P2 Publishing Contract implementation?**

**Yes — with two conditions.** The existing `Article` model, service layer,
auth, audit table, cron-auth primitive, and Agent-Framework substrate are a
sound, real foundation, and the Publishing Contract / Destination Adapter /
Job model can be *designed and built* on them without rework. The two
conditions:

1. **P2 must ship at least one genuine destination** (an internal, sanitized
   `/blog` render qualifies) — otherwise "published" remains a label with no
   effect and the build would overstate what it does.
2. **P2 scheduling must be designed around the Vercel Hobby one-cron-per-day
   limit** (fixed UTC slots), or the owner must approve a plan upgrade /
   external scheduler first.

Automation-triggered publishing is **not** a prerequisite for P2 and should be
deferred until `AUTOMATION_DECISION.md` PENDING-1 is signed off. Do not begin
P2 automatically.
