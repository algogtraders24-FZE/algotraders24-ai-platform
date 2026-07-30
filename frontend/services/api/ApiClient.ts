// services/api/ApiClient.ts
// Sprint 14E - Shared HTTP client for the dashboard service layer.
// Wraps fetch with typed responses, retry, abort, timing, and a small cache.
// Talks to the /api/private/* routes introduced in Sprint 14D.

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  durationMs?: number;
}

export interface ApiSuccess<T> {
  status: "ok";
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  status: "error";
  error: { code: string; message: string };
  meta: ApiMeta;
}

export type ApiEnvelope<T> = ApiSuccess<T> | ApiFailure;

export class ApiClientError extends Error {
  readonly code: string;
  readonly httpStatus: number;

  constructor(code: string, message: string, httpStatus: number) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
  retries?: number;
  retryDelayMs?: number;
  cacheTtlMs?: number;
  query?: Record<string, string | number | undefined>;
}

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined) params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function log(path: string, ms: number, error?: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  const suffix = error ? ` failed: ${String(error)}` : "";
  console.log(`[api] GET ${path} ${ms}ms${suffix}`);
}

async function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class ApiClient {
  static invalidate(pathPrefix?: string): void {
    if (!pathPrefix) {
      cache.clear();
      return;
    }
    for (const key of cache.keys()) {
      if (key.startsWith(pathPrefix)) cache.delete(key);
    }
  }

  static async get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = buildUrl(path, options.query);
    const ttl = options.cacheTtlMs ?? 0;

    if (ttl > 0) {
      const hit = cache.get(url);
      if (hit && hit.expiresAt > Date.now()) {
        return hit.value as T;
      }
    }

    const retries = options.retries ?? 1;
    const retryDelayMs = options.retryDelayMs ?? 400;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const started = Date.now();
      try {
        const res = await fetch(url, {
          method: "GET",
          signal: options.signal,
          headers: { Accept: "application/json" },
        });

        const body = (await res.json()) as ApiEnvelope<T>;
        log(url, Date.now() - started);

        if (!res.ok || body.status === "error") {
          const err = body.status === "error" ? body.error : undefined;
          throw new ApiClientError(
            err?.code ?? "HTTP_ERROR",
            err?.message ?? `Request failed with ${res.status}`,
            res.status
          );
        }

        if (ttl > 0) {
          cache.set(url, { value: body.data, expiresAt: Date.now() + ttl });
        }
        return body.data;
      } catch (error) {
        lastError = error;
        log(url, Date.now() - started, error);

        // Aborts are intentional; never retry them.
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        // 4xx are deterministic; retrying will not help.
        if (error instanceof ApiClientError && error.httpStatus < 500) {
          throw error;
        }
        if (attempt < retries) {
          await delay(retryDelayMs * (attempt + 1));
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new ApiClientError("UNKNOWN", "Request failed", 500);
  }

  // Sprint L2.2 - JSON POST, added for the real knowledge search route.
  // No caching (POST results aren't idempotent-cacheable by URL) and no
  // retry by default (a search that failed once shouldn't silently repeat).
  static async post<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return ApiClient.send<T>("POST", path, body, options);
  }

  // Sprint L2.5 - JSON PATCH, added for real subscription mutations
  // (cancel/reactivate/change-plan). Same non-caching, non-retrying
  // contract as post() - a mutation is never safe to silently repeat.
  static async patch<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return ApiClient.send<T>("PATCH", path, body, options);
  }

  // Sprint L2.6 - DELETE with no body, added for admin moderation actions
  // (e.g. soft-deleting a Knowledge document). Same non-retrying contract.
  static async delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const started = Date.now();
    try {
      const res = await fetch(path, {
        method: "DELETE",
        signal: options.signal,
        headers: { Accept: "application/json" },
      });
      const responseBody = (await res.json()) as ApiEnvelope<T>;
      log(path, Date.now() - started);

      if (!res.ok || responseBody.status === "error") {
        const err = responseBody.status === "error" ? responseBody.error : undefined;
        throw new ApiClientError(
          err?.code ?? "HTTP_ERROR",
          err?.message ?? `Request failed with ${res.status}`,
          res.status,
        );
      }
      return responseBody.data;
    } catch (error) {
      log(path, Date.now() - started, error);
      throw error instanceof Error ? error : new ApiClientError("UNKNOWN", "Request failed", 500);
    }
  }

  private static async send<T>(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<T> {
    const started = Date.now();
    try {
      const res = await fetch(path, {
        method,
        signal: options.signal,
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });

      const responseBody = (await res.json()) as ApiEnvelope<T>;
      log(path, Date.now() - started);

      if (!res.ok || responseBody.status === "error") {
        const err = responseBody.status === "error" ? responseBody.error : undefined;
        throw new ApiClientError(
          err?.code ?? "HTTP_ERROR",
          err?.message ?? `Request failed with ${res.status}`,
          res.status,
        );
      }
      return responseBody.data;
    } catch (error) {
      log(path, Date.now() - started, error);
      throw error instanceof Error ? error : new ApiClientError("UNKNOWN", "Request failed", 500);
    }
  }
}