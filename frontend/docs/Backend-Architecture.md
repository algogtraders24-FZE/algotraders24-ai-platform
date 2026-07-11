# Backend Architecture

Sprint 14A — Backend Foundation
Algotraders24 AI Platform

---

## Overview

This sprint establishes the backend architecture that all future modules will migrate to. It introduces a Next.js Route Handler API layer, a repository pattern with a generic base and a factory, and a set of core backend services. Everything runs on in-memory mock data — no database, no auth, no Stripe yet. Swapping mock storage for PostgreSQL/Prisma later requires changing the repository internals only, not the callers.

---

## API Layer

All routes are Next.js Route Handlers wrapped by withContext(). The wrapper creates a RequestContext, logs the request, times it, and catches errors through ErrorHandler. Handlers return through ApiResponse.success() or ApiResponse.error() for a consistent envelope with status, data/error, and meta (requestId, timestamp, durationMs).

Three endpoints ship in this sprint:
- GET /api/health — status, version, environment, timestamp, uptime.
- GET /api/version — platform version, build version, release, sprint.
- GET /api/system/status — per-subsystem health plus an overall rollup. Database reports "down" until connected.

---

## Repository Pattern

BaseRepository implements IRepository<T> with an in-memory Map: findAll, findById, create, update, delete, count. Concrete repositories extend it, declare their entity shape, seed mock rows, and add domain queries. RepositoryFactory exposes lazy singletons and is the single seam where a Prisma-backed implementation is swapped in later.

---

## Core Services

- Logger — DEBUG/INFO/WARN/ERROR with timestamps.
- ErrorHandler — AppError with code + HTTP status; normalize() and handle().
- RequestContext — request id, method, path, timing, mock user.
- HealthService / VersionService — read from backend.config.ts.
- BackendEngine — orchestrator exposing repositories, health, version, logger, feature flags.

Feature flags gate everything future: databaseConnected, authEnabled, stripeEnabled, nowPaymentsEnabled, redisEnabled.

---

## Future PostgreSQL & Prisma

A PrismaBaseRepository<T> will implement the same IRepository<T> contract against a Prisma client, and RepositoryFactory will return those when databaseConnected is true. schema.prisma defines one model per entity. Because entities carry id/createdAt/updatedAt and callers depend only on the interface, no service or route needs editing.

---

## Future Authentication

When authEnabled flips true, RequestContext resolves the real user from a session or token instead of defaulting to "u1". Middleware gains a withAuth() guard. Route handlers already receive ctx.userId.

---

## Future Stripe & NOWPayments

Billing moves to real via a provider seam. Stripe and NOWPayments both update the same BillingRepository via webhooks, gated by feature flags.

---

## Future Redis

Redis will back caching, rate limiting, and session storage, slotting in behind existing interfaces without touching route handlers.

---

## Design Principles

- Strict TypeScript with a single IRepository<T> contract.
- Repository pattern — one seam to swap mock for Prisma.
- Consistent response envelopes.
- Centralized logging, errors, timing, context.
- Additive only — no existing module modified.