// services/ai/analysis-run.service.ts
// Sprint 15D.1 - Domain service boundary for AnalysisRun. No Prisma model
// or migration exists yet (explicitly deferred per the Sprint 15D locked
// decisions) - IAnalysisRunStore + InMemoryAnalysisRunStore are a
// reference implementation only, shaped so a future
// PrismaAnalysisRunRepository can replace the storage without changing
// AnalysisRunService's public API (the same evolution Message/Conversation
// followed across Sprint 15C.3-15C.7).
//
// SECURITY: userId must be session-derived by the caller, never accepted
// from a client-supplied value - every read/update is scoped by userId,
// mirroring the ownership convention used everywhere else in this project
// (see services/ai/conversation-ownership.service.ts).
import type { AnalysisRun } from "@/types/analysis-run";
import type { MarketContext } from "@/types/market-context";
import type { MarketSymbol } from "@/types/market";
import { RepositoryError } from "@/types/repository";

export interface IAnalysisRunStore {
  create(run: Omit<AnalysisRun, "id" | "createdAt">): Promise<AnalysisRun>;
  findById(id: string, userId: string): Promise<AnalysisRun | null>;
  update(
    id: string,
    userId: string,
    patch: Partial<Omit<AnalysisRun, "id" | "userId" | "createdAt">>,
  ): Promise<AnalysisRun | null>;
}

// In-memory reference store. Not for production persistence - see the
// file header. Scoped to the process; each AnalysisRunService instance
// that constructs its own store starts empty (deliberate for tests).
class InMemoryAnalysisRunStore implements IAnalysisRunStore {
  private readonly runs = new Map<string, AnalysisRun>();
  private seq = 0;

  async create(run: Omit<AnalysisRun, "id" | "createdAt">): Promise<AnalysisRun> {
    this.seq += 1;
    const created: AnalysisRun = {
      ...run,
      id: `run-${Date.now()}-${this.seq}`,
      createdAt: new Date().toISOString(),
    };
    this.runs.set(created.id, created);
    return created;
  }

  async findById(id: string, userId: string): Promise<AnalysisRun | null> {
    const run = this.runs.get(id);
    if (!run || run.userId !== userId) return null;
    return run;
  }

  async update(
    id: string,
    userId: string,
    patch: Partial<Omit<AnalysisRun, "id" | "userId" | "createdAt">>,
  ): Promise<AnalysisRun | null> {
    const existing = await this.findById(id, userId);
    if (!existing) return null;
    const updated: AnalysisRun = { ...existing, ...patch };
    this.runs.set(id, updated);
    return updated;
  }
}

export class AnalysisRunService {
  constructor(private readonly store: IAnalysisRunStore = new InMemoryAnalysisRunStore()) {}

  private assertNonEmpty(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new RepositoryError({
        code: "VALIDATION",
        entity: "AnalysisRun",
        operation: "validate",
        message: `${field} must be a non-empty string`,
      });
    }
    return value;
  }

  async startRun(userId: string, symbol: MarketSymbol): Promise<AnalysisRun> {
    const uid = this.assertNonEmpty(userId, "userId");
    const sym = this.assertNonEmpty(symbol, "symbol");
    return this.store.create({
      userId: uid,
      symbol: sym,
      status: "pending",
      context: null,
      summary: null,
      completedAt: null,
    });
  }

  async completeRun(
    id: string,
    userId: string,
    context: MarketContext,
    summary: string,
  ): Promise<AnalysisRun | null> {
    return this.store.update(id, userId, {
      status: "completed",
      context,
      summary,
      completedAt: new Date().toISOString(),
    });
  }

  async markUnavailable(id: string, userId: string, reason: string): Promise<AnalysisRun | null> {
    return this.store.update(id, userId, {
      status: "unavailable",
      summary: reason,
      completedAt: new Date().toISOString(),
    });
  }

  // Sprint 15D.2 - distinct from markUnavailable: "unavailable" means the
  // market data provider had nothing to offer; "failed" means a
  // downstream step (the AI call) errored despite having a context to
  // work with. AnalysisRunStatus already anticipated both.
  async markFailed(id: string, userId: string, reason: string): Promise<AnalysisRun | null> {
    return this.store.update(id, userId, {
      status: "failed",
      summary: reason,
      completedAt: new Date().toISOString(),
    });
  }

  async getRun(id: string, userId: string): Promise<AnalysisRun | null> {
    return this.store.findById(id, userId);
  }
}
