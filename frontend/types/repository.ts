// types/repository.ts
// Sprint 14D - Query primitives (pagination, filtering, sorting) and typed
// exceptions shared by every Prisma-backed repository.

export type SortDirection = "asc" | "desc";

export interface SortOption<T> {
  field: keyof T & string;
  direction: SortDirection;
}

export interface PaginationOption {
  page: number; // 1-based
  pageSize: number;
}

export interface QueryOptions<T> {
  where?: Partial<Record<keyof T & string, unknown>>;
  sort?: SortOption<T>;
  pagination?: PaginationOption;
  includeDeleted?: boolean; // soft-delete aware
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

// ---------- Typed exceptions ----------

export type RepositoryErrorCode =
  | "NOT_FOUND"
  | "DUPLICATE"
  | "VALIDATION"
  | "CONNECTION"
  | "TRANSACTION"
  | "UNKNOWN";

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;
  readonly entity: string;
  readonly operation: string;
  readonly cause?: unknown;

  constructor(params: {
    code: RepositoryErrorCode;
    entity: string;
    operation: string;
    message: string;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "RepositoryError";
    this.code = params.code;
    this.entity = params.entity;
    this.operation = params.operation;
    this.cause = params.cause;
  }
}

export class EntityNotFoundError extends RepositoryError {
  constructor(entity: string, id: string) {
    super({
      code: "NOT_FOUND",
      entity,
      operation: "findById",
      message: `${entity} not found: ${id}`,
    });
    this.name = "EntityNotFoundError";
  }
}

export class DuplicateEntityError extends RepositoryError {
  constructor(entity: string, field: string) {
    super({
      code: "DUPLICATE",
      entity,
      operation: "create",
      message: `${entity} already exists with this ${field}`,
    });
    this.name = "DuplicateEntityError";
  }
}

export class DatabaseConnectionError extends RepositoryError {
  constructor(entity: string, operation: string, cause?: unknown) {
    super({
      code: "CONNECTION",
      entity,
      operation,
      message: `Database unavailable during ${entity}.${operation}`,
      cause,
    });
    this.name = "DatabaseConnectionError";
  }
}
