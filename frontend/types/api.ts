// types/api.ts
// Sprint 14A — Backend Foundation
// API contract types: responses, errors, request context.

export type ApiStatus = "ok" | "error";

export type HttpStatusCode =
  | 200
  | 201
  | 204
  | 400
  | 401
  | 403
  | 404
  | 409
  | 422
  | 429
  | 500
  | 503;

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  durationMs?: number;
}

export interface ApiSuccessResponse<T> {
  status: "ok";
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorResponse {
  status: "error";
  error: ApiError;
  meta: ApiMeta;
}

export type ApiResponseBody<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RequestContextData {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
  userId: string | null;
}
