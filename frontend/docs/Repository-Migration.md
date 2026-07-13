# Repository Migration - Sprint 14D

Persistence layer migration from in-memory mock repositories to Prisma-backed
repositories on Supabase Postgres, with a configuration-driven dependency
injection switch and automatic mock fallback.

---

## 1. Migration Strategy

The mock repositories from Sprint 14A were not replaced in place. Instead, a
parallel Prisma implementation was introduced for each entity, and
`RepositoryFactory` decides which implementation to hand out. Callers are
untouched.

| Entity | Mock (14A) | Prisma (14C/14D) |
|---|---|---|
| User | removed | `UserRepository` (Prisma since 14C) |
| Product | `ProductRepository` | `PrismaProductRepository` |
| Conversation | `ConversationRepository` | `PrismaConversationRepository` |
| Agent | `AgentRepository` | `PrismaAgentRepository` |
| Knowledge | `KnowledgeRepository` | `PrismaKnowledgeRepository` |
| Automation | `AutomationRepository` | `PrismaAutomationRepository` |
| Billing | `BillingRepository` | `PrismaBillingRepository` |

Both implementations satisfy the same `IRepository<T>` contract plus their
entity-specific methods, so the swap is invisible to consumers.

---

## 2. Repository Activation

Mode is resolved from `config/repository.config.ts`:

| Mode | Behaviour |
|---|---|
| `mock` | Always in-memory repositories |
| `prisma` | Always Prisma repositories |
| `auto` (default) | Prisma when the database is reachable, otherwise mock |

Set via the `REPOSITORY_MODE` environment variable.

### Connection probe

`lib/db-health.ts` issues a real `SELECT 1` against Postgres and caches the
verdict for 30 seconds. Repository resolution is synchronous, so the factory
reads the cached flag while a background probe keeps it fresh.

The same probe backs `HealthService.getSystemStatusAsync()`, so
`/api/system/status` now reports genuine database health.

---

## 3. Mock Fallback

In `auto` mode a database outage degrades the platform to mock repositories
rather than failing hard. `/api/system/status` reflects this: the database
subsystem reports `down` and overall health becomes `degraded`.

`RepositoryFactory.reset()` clears cached singletons so a mode change can take
effect without a process restart.

---

## 4. Dependency Injection

`RepositoryFactory` is the single injection point. Call sites are unchanged
from Sprint 14A:

    const agents = await RepositoryFactory.agents().findByUser(userId);

Return types are now interfaces (`IAgentRepository`, `IProductRepository`, ...)
rather than concrete classes, which is what allows either implementation to be
returned. `RepositoryFactory.mode()` exposes the active mode; API responses
include it as a `mode` field for observability.

---

## 5. PrismaBaseRepository

All Prisma repositories extend a single generic base, which provides:

- **CRUD** - findAll, findById, create, update, delete
- **Soft delete** - `delete()` sets `deletedAt`; `hardDelete()` and `restore()` are explicit
- **Pagination / filtering / sorting** - `query()` returns a `PaginatedResult<T>`
- **Audit timestamps** - `createdAt` / `updatedAt` maintained by Prisma
- **Query timing and logging** - every operation logs its duration; slow queries (over `SLOW_QUERY_MS`, default 300ms) are flagged
- **Typed exceptions** - Prisma error codes translated into `DuplicateEntityError`, `DatabaseConnectionError`, `EntityNotFoundError`, or `RepositoryError`
- **Transactions** - `transaction()` wraps `prisma.$transaction`

Subclasses supply only three mappers: `toEntity`, `toCreateData`, `toUpdateData`.

---

## 6. Seed Strategy

`prisma/seed.ts` (run with `npx prisma db seed`) is idempotent and safe to
re-run. It seeds:

- 4 plans: Free, Pro, Elite, Enterprise (with feature lists)
- An admin user (`admin@algotraders24.ai`, role `admin`)
- 4 products
- For the owner: 3 agents, 3 knowledge documents, 3 automation workflows,
  3 conversations, 3 billing records, 1 active subscription

**Owner resolution**: the seed links demo data to the first real
Supabase-authenticated user when one exists, so the dashboard renders against
the account you actually log in with. If no authenticated user is present it
provisions a demo user instead.

Plans and products use `upsert` keyed on stable identifiers. User-scoped data
is cleared and reinserted per owner, keeping repeated runs clean.


---

## 7. Schema Additions

| Model | Added in 14D |
|---|---|
| All models | `deletedAt DateTime?` + index (soft delete) |
| `Plan` | New: id, name, price, interval, features[], isActive, sortOrder |
| `Subscription` | New: userId, planId, status, period start/end, cancelAtPeriodEnd |

`Plan.id` is a plain string (`free`, `pro`, `elite`, `enterprise`) so existing
`User.planId` and `Billing.planId` values remain valid.

---

## 8. API

New authenticated routes under `/api/private/*` (guarded by middleware) read
through the repositories:

| Route | Scope |
|---|---|
| `GET /api/private/products` | Global, paginated |
| `GET /api/private/plans` | Global catalogue |
| `GET /api/private/agents` | Current user |
| `GET /api/private/knowledge` | Current user |
| `GET /api/private/automations` | Current user |
| `GET /api/private/billing` | Current user |

All use the existing `ApiResponse` envelope; response contracts are unchanged.

---

## 9. Scope Boundary

Sprint 14D migrated **persistence and API**. The dashboard service layer
(`services/agents/*`, `services/knowledge/*`, `services/automation/*`,
`services/billing/*`) still reads from mock data and remains synchronous.

Migrating those services to consume the repositories is **Sprint 14E - Service
Layer Migration**, deliberately kept separate so the UI is not disturbed while
persistence lands.

---

## 10. Future Scaling

- **Read replicas** - the factory is the only place repositories are constructed, so a read/write split can be introduced there
- **Caching** - a caching decorator can wrap any `IRepository<T>` without touching callers
- **Cursor pagination** - `query()` can grow a cursor variant alongside offset pagination
- **Multi-tenancy** - user-scoped queries already filter by `userId`; a tenant column extends the same pattern
- **Retention** - soft-deleted rows accumulate; a purge job can use `hardDelete()` past a threshold
