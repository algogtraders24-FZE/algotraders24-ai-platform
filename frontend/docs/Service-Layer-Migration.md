# Service Layer Migration - Sprint 14E

Service-layer migration from mock/config-derived data sources to the
Repository + Prisma stack established in Sprint 14D. Each dashboard-facing
module now reads live data through a typed API client backed by a private
API route, a repository, and Supabase Postgres.

---

## 1. Migration Strategy

Sprint 14D moved *persistence* behind `RepositoryFactory`. Sprint 14E moves
the *services and pages* that consume that persistence. UI is preserved
exactly; only the data source changes.

Every module follows the same request path:

    Dashboard page
      -> XxxApi (typed ApiClient wrapper, 30s cache)
        -> /api/private/xxx (withContext + auth guard)
          -> RepositoryFactory.xxx() (mock | prisma)
            -> Prisma -> Supabase Postgres

Pages fetch in a `useEffect` with loading, error, and `AbortController`
handling. The rendered markup is unchanged from the mock version.

---

## 2. Module Status

| Module | Data source before | Data source after | Notes |
|---|---|---|---|
| Billing | mock + config | DB (plans/subscription/invoices) | usage + payment methods config-derived -> 15A |
| Products | data/products.ts | DB (full catalogue) | server components, SSG intact |
| Knowledge | mock | DB (docs + collections) | RAG / embeddings deferred |
| Agents | mock | DB (agents/tasks/memory/activity) | full migration |
| Automation | data/mock-automation.ts | DB (workflows/runs/queue) | new models, see section 4 |
| Conversations | data/mock-conversations.ts | DB (conversation summaries) | AI mock responses split out, see section 5 |

All mock data files for migrated modules have been removed.

---

## 3. Per-Module Pattern

1. Extend `prisma/schema.prisma` with production models.
2. Create + apply a migration, then `prisma generate`.
3. Seed realistic data in `prisma/seed.ts` (idempotent, owner-scoped).
4. Add a Prisma repository and register it in `RepositoryFactory`.
5. Add a private API route under `app/api/private/<module>/`.
6. Add a typed `XxxApi` client under `services/api/`.
7. Wire the service / page to the API with loading, error, and abort states.

The `IRepository<T>` contract plus entity-specific methods keep the swap
invisible to callers, exactly as in Sprint 14D.

---

## 4. Automation (Workflow) Module

Automation had two independent shapes: a simple `Automation` entity from the
Sprint 14A backend foundation, and a richer dashboard shape (workflows with
steps, runs, and a queue). To avoid breaking the existing `Automation`
model, route, and repository, three dedicated models were introduced.

| Model | Purpose |
|---|---|
| Workflow | Definition: name, trigger, schedule, status, steps (JSON) |
| WorkflowRun | Execution record: status, timings, log (JSON) |
| WorkflowQueueItem | Pending execution entry |

Enums: `WorkflowTrigger` (manual / scheduled / event),
`WorkflowStatus` (active / paused / draft),
`RunStatus` (queued / running / success / failed).

The `PrismaWorkflowRepository` exposes `findByUser`, `runsByUser`, and
`queueByUser`. The `/api/private/workflows` route returns all three in one
envelope. Runs and queue rows omit `workflowName`; the page enriches them by
joining on `workflowId`, and metrics are computed client-side in
`services/api/workflowMetrics.ts`.

The self-contained `services/automation/` engine cluster was unused by any
page and was removed with the mock data.

### Deferred

`Run now` and `Pause` currently apply optimistic local-state updates only;
they do not persist. Write mutations (POST / PATCH routes) are a follow-up.

---

## 5. Conversations Module

The conversation mock file mixed two unrelated concerns:

- **Conversation list data** (`mockConversations`) - dashboard data,
  migrated to the DB via `ConversationsApi` and the
  `/api/private/conversations` route.
- **AI provider fallback** (`mockResponses`, `DEFAULT_RESPONSE`) - a
  keyword-to-reply map used by the mock AI provider, not user data.

These were separated. The AI fallback moved to `data/ai-mock-responses.ts`
(the mock provider now imports from there), and the conversation list data
was removed. `services/ai/conversation.service.ts` was rewritten as a thin
async wrapper over `ConversationsApi`, returning DB-backed summary rows.

The DB `Conversation` shape is a list summary (title, messageCount,
lastMessageAt), not a full message thread. Full threads for the AI Assistant
page are handled by the separate local/manager layer and are out of scope
for this sprint.

---

## 6. Gotchas

- **Prisma client staleness.** After any schema change, stop Node, remove
  `.next`, and regenerate the client, otherwise the delegate is undefined
  (Cannot read properties of undefined reading findMany):

      Stop-Process -Name node -Force
      Remove-Item -Recurse -Force .next
      npx prisma generate

- **BaseEntity has no userId.** User-scoped entities must declare `userId`
  explicitly; it is not inherited.

- **JSON columns.** `steps` and `log` are stored as JSON and cast through
  `unknown` on the way in and out of Prisma.

- **Mock-mode degradation.** Runs and queue are Prisma-only extras; in mock
  mode the workflows route returns empty arrays for them rather than failing.

---

## 7. Result

All six dashboard data modules read from Supabase Postgres through the
Repository + Prisma stack. Builds pass with zero TypeScript errors, all
existing routes, components, and layouts are preserved, and mock data files
for migrated modules have been removed.

Tagged as release **v0.6.0**.
