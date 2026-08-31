# Q0 Architecture Audit

Date: 2026-08-23
Scope: Phase 0 discovery for the AT24 Quant Engine (Q0). Read-only research; no production code was changed to produce this document.

## 0. Pre-existing "Quant Engine" work (must-read before anything else)

Before this sprint, three **uncommitted, untracked** top-level directories already existed in the repo, all touched the same day this audit was written:

- `quant-engine/` — a Python "idea → code" engine (JSON Spec → Python backtest / MQL5 / MQL4 / Pine Script v5 codegen), with a pre-computed 1,764-strategy library (`spec_engine/strategy_library.db`).
- `quant_engine/` (underscore) — a different, smaller module (`engine.py`, `db.py`, `data_import.py`) plus a 1.4 GB `market.db` SQLite candle store.
- `quant-engine-handoff/` — a handoff note (`HANDOFF_SPRINT_idea_to_code.md`) recording that this prior engine was built **before** its own session knew about the `ea-research/marketplace-research/` M0–M12 pipeline, is **not integrated** with M-Series Evidence/Validation/Trust-Status, explicitly says **"do not call this M13"** (that number is reserved for seller economy/pricing), and leaves the integration decision (feeder into M-series vs. standalone tool vs. narrow technique reuse) **unresolved**.

None of these three directories are tracked in git, so this Q0 sprint has full latitude, but they were **not touched, read into, merged with, or deleted** by this sprint — per the hard guardrails' spirit (document discoveries, leave them untouched) and because reconciling them is a decision for the repo owner, not something to resolve silently. The new Quant Engine foundation was built as a **fourth, distinctly-named** directory (`at24-quant-engine/`) to guarantee zero collision. **Open item for a future sprint: decide whether to reconcile, merge, rename, or retire `quant-engine/` and `quant_engine/`.**

## 1. Existing Architecture

- No root `package.json`, no workspace tooling (no pnpm-workspace.yaml/turbo.json/nx.json/lerna.json). Not a monorepo.
- Top-level: `frontend/` (Next.js 16.2.9 / React 19.2.4 / TypeScript ^5 production app), `ea-research/` (MQL5 EA research + the Python M-Series marketplace research pipeline), `mt5-bridge/` (standalone Python MT5 connectivity bridge), `docs/` (early architecture notes, unrelated to M-Series).
- `frontend/tsconfig.json`: `strict: true`, path alias `"@/*": ["./*"]`, `moduleResolution: "bundler"`, target ES2017. `frontend/AGENTS.md` warns this is a recent, unfamiliar Next.js version — read `node_modules/next/dist/docs/` before touching it.
- Frontend layout is flat (no `src/`): `app/` (App Router routes), `components/<domain>/`, `lib/` (+ `lib/generated/prisma`), `services/<domain>/<subdomain>/`, `repositories/` (interface + Prisma-impl pairs), `types/` (flat files), `scripts/` (`validate-*.ts` one-off scripts).
- **The M-Series computation engines are pure Python**, not TypeScript, and live entirely under `ea-research/marketplace-research/` — not inside `frontend/`. `frontend/` only has a thin consumption/persistence layer for marketplace data (see §3).

## 2. Quant Engine Boundary

The Quant Engine (`at24-quant-engine/`) is a **standalone npm package** with its own `package.json`, `node_modules`, `tsconfig.json`, and test runner (Node's built-in `node:test`, executed via `tsx`). It is not a workspace member of anything, has zero runtime dependencies, and is never imported by `frontend/` or any M-Series Python module. This is enforced by an automated isolation test (`test/isolation.test.ts`) that statically scans all source files for forbidden import patterns (`@/`, `.../frontend/`, `.../ea-research/`, `prisma`) and asserts the package declares zero runtime `dependencies`.

## 3. Files/Modules Quant May Touch

Only files under `at24-quant-engine/`. Nothing else was created or modified by this sprint.

## 4. Files/Modules Quant MUST NOT Touch

- **M-Series Python engines** (`ea-research/marketplace-research/`): `m2-evidence-engine/evidence_engine.py`, `m3-evidence-verification/`, `m4-validation-engine/validation_engine.py` + `regime_classifier.py`, `m5-risk-analysis/risk_analysis_engine.py`, `m6-history-engine/history_engine.py`, `m7-trust-status/trust_status_engine.py`, `m8-marketplace-platform/`, `m9-product-factory/`, `m10-m12-*` applied case studies.
- **Frontend marketplace layer**: `frontend/services/marketplace/**` (`MarketplaceCatalogue.ts`, `listingMutationGuard.ts`, `tableGuard.ts`, `factory/{adapters,auditTrail,eligibility,ingestion,mt5EvidenceAdapter,submissionState}.ts`), `frontend/components/marketplace/**`.
- **Prisma schema and DB**: `frontend/prisma/schema.prisma`, `frontend/prisma/migrations/**`, `frontend/lib/prisma.ts`. No migration was created; no model was added, removed, or altered.
- **Draft M1 schema**: `ea-research/marketplace-research/M1_schema.prisma` — a **draft that was never applied** to the real database. `TradingSystem`/`Version`/`Evidence`/`Validation`/`RiskAnalysis`/`HistoryEvent`/`TrustStatus`/`Score` do not exist as real Prisma models; the live schema only carries flat, unconstrained string fields (`tradingSystemId`, `versionId`, `evidenceHash`, etc.) on `MarketplaceListing` and `MarketplaceEvidenceRecord`. Q0 does not touch or assume this schema will exist in any particular shape.
- **The pre-existing `quant-engine/`, `quant_engine/`, `quant-engine-handoff/`** directories (see §0) — left untouched pending a reconciliation decision.
- Any existing API route, `frontend/app/api/**`, or production behavior.

## 5. Reusable Infrastructure (considered, not adopted)

- `frontend/services/backend/Logger.ts` (a `Logger` class/singleton) and the `MarketIntelligenceOutcome`-style tagged-union result idiom (`frontend/types/market-intelligence-result.ts`) are good precedents, but reusing them directly would require an import from `frontend/`, breaking isolation. The Quant Engine instead defines its own minimal `ValidationResult` shape (`src/domain/validation-result.ts`) — small enough that duplicating it is cheaper than coupling to `frontend/`.
- `zod` is present only as a transitive dependency in `frontend/node_modules` (no first-party code imports it) — not treated as an existing convention to inherit.
- No standalone ID-generation utility exists outside Prisma's `@default(cuid())`; the Quant Engine does not need ID generation yet (Q0 defines contracts, not a runtime that mints IDs).

## 6. Naming Conflicts

- **"Risk Engine"**: the repo already has *two* same-named-but-different things: `frontend/services/ai/risk/risk-engine.service.ts` and `frontend/services/ai/trading/risk-engine.service.ts` (AI Market Intelligence copilot risk scoring) — unrelated to both M-Series' `m5-risk-analysis` and to the Quant Engine's `RiskSpecification`. The Quant Engine uses the type name `RiskSpecification`, never `RiskEngine`, to avoid adding a third collision.
- **"Indicator"**: `frontend/lib/chart-engine/indicators/**` is a charting/technical-overlay system for the UI, unrelated to strategy-signal indicators. The Quant Engine's `IndicatorReference` type is intentionally a bare name+params address, not a computation engine, so it cannot be confused with the chart indicator system.
- **"StrategySpec"**: no such identifier exists anywhere in `frontend/`. The only prior "spec" shape is `quant-engine/spec_engine/schema.py`'s JSON format (`VALID_INDICATOR_TYPES`, `indicators`/`entry_long`/`entry_short`/`risk` keys) — the new `StrategySpec` here uses a different, TypeScript-native shape (`entryRules`/`exitRules`/`risk`/`execution`) and does not attempt to be schema-compatible with it, since that prior engine's integration status is itself unresolved (§0).
- **"quant-engine" naming**: three prior directories already use variants of this name (§0); this sprint's package is named `at24-quant-engine` and lives at `at24-quant-engine/` specifically to avoid a fourth ambiguous "quant-engine"-ish path.

## 7. Future Integration Points

Documented, not implemented (per guardrails):
- `BacktestResult` → future Evidence Adapter → M-Series `Evidence` (Python, `m2-evidence-engine`).
- `StrategySpec`/`RiskSpecification` → future Risk Adapter → M-Series `m5-risk-analysis`.
- `StrategySpec` → future Validation Adapter → M-Series `m4-validation-engine`.
- `StrategyVersionRecord` → future mapping onto the still-draft M1 `TradingSystem`/`Version` Prisma models, if and when that schema is ever applied for real.

## 8. Architectural Risks

- **Directory sprawl**: a fourth "quant engine"-shaped directory increases the risk that a future session picks the wrong one to extend. Flagged in §0 as an open item requiring a human decision.
- **Two languages, two runtimes**: M-Series is Python, the production app is TypeScript, and the Quant Engine (this sprint) is also TypeScript but standalone. Any future adapter connecting the Quant Engine to M-Series will need to cross a language boundary (subprocess, HTTP, or a serialized file format) — this is a real integration cost that Q0 deliberately defers rather than papering over with a shared in-process module.
- **Draft M1 schema drift**: because `TradingSystem`/`Version` only exist as a draft, any strategy-versioning work here (`StrategyVersionRecord`) is provisional and may need reshaping once/if that schema is ever finalized and migrated for real.
- **No existing JS/TS test runner** in `frontend/` (it uses ad hoc `validate-*.ts` scripts, not jest/vitest) — the Quant Engine instead uses Node's built-in `node:test` runner to avoid introducing a testing-framework opinion that the rest of the repo hasn't adopted.

## 9. Recommended Quant Module Location

`at24-quant-engine/` at the repository root, as a fully standalone npm package (own `package.json`, `tsconfig.json`, `node_modules`, test runner). This satisfies the isolation guardrails literally — it cannot accidentally end up in `frontend/`'s build (`next build` / `prisma generate`) or dependency graph, and it does not require deciding anything about the pre-existing `quant-engine`/`quant_engine` directories before starting.
