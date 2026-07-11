// services/backend/ApiResponse.ts
// Sprint 14A — Backend Foundation
// Typed success/error envelope builder for route handlers.

import { NextResponse } from "next/server";
import type {
  ApiError,
  ApiMeta,
  ApiSuccessResponse,
  ApiErrorResponse,
  HttpStatusCode,
} from "@/types/api";

function buildMeta(requestId: string, startedAt?: number): ApiMeta {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    durationMs: startedAt != null ? Date.now() - startedAt : undefined,
  };
}

export class ApiResponse {
  static success<T>(
    data: T,
    requestId: string,
    status: HttpStatusCode = 200,
    startedAt?: number
  ): NextResponse {
    const body: ApiSuccessResponse<T> = {
      status: "ok",
      data,
      meta: buildMeta(requestId, startedAt),
    };
    return NextResponse.json(body, { status });
  }

  static error(
    error: ApiError,
    requestId: string,
    status: HttpStatusCode = 500,
    startedAt?: number
  ): NextResponse {
    const body: ApiErrorResponse = {
      status: "error",
      error,
      meta: buildMeta(requestId, startedAt),
    };
    return NextResponse.json(body, { status });
  }
}
