// repositories/PrismaBaseRepository.ts
// Sprint 14D - Generic Prisma-backed repository.
// Implements the same IRepository<T> contract as the in-memory BaseRepository,
// adding pagination, filtering, sorting, soft delete, audit timestamps,
// query timing/logging, transactions, and typed error handling.
import type { BaseEntity, IRepository } from "@/types/backend";
import {
  DatabaseConnectionError,
  DuplicateEntityError,
  RepositoryError,
  type PaginatedResult,
  type QueryOptions,
} from "@/types/repository";
import { repositoryConfig } from "@/config/repository.config";
import { prisma } from "@/lib/prisma";

// Minimal shape of a Prisma model delegate (prisma.user, prisma.product, ...).
export interface PrismaDelegate {
  findMany: (args?: Record<string, unknown>) => Promise<unknown[]>;
  findUnique: (args: Record<string, unknown>) => Promise<unknown>;
  findFirst: (args: Record<string, unknown>) => Promise<unknown>;
  create: (args: Record<string, unknown>) => Promise<unknown>;
  update: (args: Record<string, unknown>) => Promise<unknown>;
  delete: (args: Record<string, unknown>) => Promise<unknown>;
  count: (args?: Record<string, unknown>) => Promise<number>;
}

export abstract class PrismaBaseRepository<T extends BaseEntity, TRow>
  implements IRepository<T>
{
  protected abstract entityName: string;
  protected abstract delegate: PrismaDelegate;

  // Maps a raw Prisma row to the domain entity (dates -> ISO strings).
  protected abstract toEntity(row: TRow): T;

  // Maps domain input to Prisma create/update data.
  protected abstract toCreateData(
    input: Omit<T, "id" | "createdAt" | "updatedAt">
  ): Record<string, unknown>;

  protected abstract toUpdateData(
    patch: Partial<Omit<T, "id" | "createdAt">>
  ): Record<string, unknown>;

  // ---------- instrumentation ----------

  protected async run<R>(operation: string, fn: () => Promise<R>): Promise<R> {
    const started = Date.now();
    try {
      const result = await fn();
      this.log(operation, Date.now() - started);
      return result;
    } catch (error) {
      this.log(operation, Date.now() - started, error);
      throw this.translateError(operation, error);
    }
  }

  private log(operation: string, ms: number, error?: unknown): void {
    if (!repositoryConfig.enableQueryLogging) return;
    const slow = ms >= repositoryConfig.slowQueryThresholdMs;
    const level = error ? "ERROR" : slow ? "WARN" : "INFO";
    const suffix = error ? ` failed: ${String(error)}` : slow ? " (slow)" : "";
    console.log(
      `[repo:${level}] ${this.entityName}.${operation} ${ms}ms${suffix}`
    );
  }

  private translateError(operation: string, error: unknown): RepositoryError {
    const code = (error as { code?: string })?.code;

    if (code === "P2002") {
      const target = (error as { meta?: { target?: string[] } })?.meta?.target;
      return new DuplicateEntityError(
        this.entityName,
        target?.join(", ") ?? "field"
      );
    }

    if (code === "P1001" || code === "P1002" || code === "P1017") {
      return new DatabaseConnectionError(this.entityName, operation, error);
    }

    if (error instanceof RepositoryError) {
      return error;
    }

    return new RepositoryError({
      code: "UNKNOWN",
      entity: this.entityName,
      operation,
      message: `${this.entityName}.${operation} failed`,
      cause: error,
    });
  }

  // ---------- soft delete helpers ----------

  protected notDeleted(includeDeleted = false): Record<string, unknown> {
    return includeDeleted ? {} : { deletedAt: null };
  }

  // ---------- IRepository contract ----------

  async findAll(): Promise<T[]> {
    return this.run("findAll", async () => {
      const rows = (await this.delegate.findMany({
        where: this.notDeleted(),
        orderBy: { createdAt: "asc" },
      })) as TRow[];
      return rows.map((r) => this.toEntity(r));
    });
  }

  async findById(id: string): Promise<T | null> {
    return this.run("findById", async () => {
      const row = (await this.delegate.findFirst({
        where: { id, ...this.notDeleted() },
      })) as TRow | null;
      return row ? this.toEntity(row) : null;
    });
  }

  async create(
    input: Omit<T, "id" | "createdAt" | "updatedAt">
  ): Promise<T> {
    return this.run("create", async () => {
      const row = (await this.delegate.create({
        data: this.toCreateData(input),
      })) as TRow;
      return this.toEntity(row);
    });
  }

  async update(
    id: string,
    patch: Partial<Omit<T, "id" | "createdAt">>
  ): Promise<T | null> {
    return this.run("update", async () => {
      const existing = await this.delegate.findFirst({
        where: { id, ...this.notDeleted() },
      });
      if (!existing) return null;

      const row = (await this.delegate.update({
        where: { id },
        data: this.toUpdateData(patch),
      })) as TRow;
      return this.toEntity(row);
    });
  }

  // Soft delete by default (sets deletedAt). Audit trail preserved.
  async delete(id: string): Promise<boolean> {
    return this.run("delete", async () => {
      const existing = await this.delegate.findFirst({
        where: { id, ...this.notDeleted() },
      });
      if (!existing) return false;

      await this.delegate.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return true;
    });
  }

  // Permanent removal. Use deliberately.
  async hardDelete(id: string): Promise<boolean> {
    return this.run("hardDelete", async () => {
      try {
        await this.delegate.delete({ where: { id } });
        return true;
      } catch {
        return false;
      }
    });
  }

  async restore(id: string): Promise<T | null> {
    return this.run("restore", async () => {
      const row = (await this.delegate.update({
        where: { id },
        data: { deletedAt: null },
      })) as TRow;
      return row ? this.toEntity(row) : null;
    });
  }

  async count(): Promise<number> {
    return this.run("count", async () =>
      this.delegate.count({ where: this.notDeleted() })
    );
  }

  // ---------- query: filter + sort + paginate ----------

  async query(options: QueryOptions<T> = {}): Promise<PaginatedResult<T>> {
    return this.run("query", async () => {
      const page = Math.max(1, options.pagination?.page ?? 1);
      const requested =
        options.pagination?.pageSize ?? repositoryConfig.defaultPageSize;
      const pageSize = Math.min(
        Math.max(1, requested),
        repositoryConfig.maxPageSize
      );

      const where: Record<string, unknown> = {
        ...(options.where ?? {}),
        ...this.notDeleted(options.includeDeleted),
      };

      const orderBy = options.sort
        ? { [options.sort.field]: options.sort.direction }
        : { createdAt: "desc" };

      const [rows, total] = await Promise.all([
        this.delegate.findMany({
          where,
          orderBy,
          skip: (page - 1) * pageSize,
          take: pageSize,
        }) as Promise<TRow[]>,
        this.delegate.count({ where }),
      ]);

      const totalPages = Math.max(1, Math.ceil(total / pageSize));

      return {
        items: rows.map((r) => this.toEntity(r)),
        total,
        page,
        pageSize,
        totalPages,
        hasNext: page < totalPages,
        hasPrevious: page > 1,
      };
    });
  }

  // ---------- transactions (foundation) ----------

  // Runs a set of repository operations atomically.
  protected async transaction<R>(
    fn: (tx: typeof prisma) => Promise<R>
  ): Promise<R> {
    return this.run("transaction", async () =>
      prisma.$transaction(async (tx) => fn(tx as unknown as typeof prisma))
    );
  }
}
