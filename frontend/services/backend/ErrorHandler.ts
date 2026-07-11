// services/backend/ErrorHandler.ts
// Sprint 14A — Backend Foundation
// Centralized, typed error handling with AppError + HTTP mapping.

import { NextResponse } from "next/server";
import type { ApiError, HttpStatusCode } from "@/types/api";
import type { ErrorCode } from "@/config/backend.config";
import { ERROR_CODES } from "@/config/backend.config";
import { ApiResponse } from "./ApiResponse";
import { logger } from "./Logger";

// Application-level typed error carrying an HTTP status + machine code.
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: HttpStatusCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus: HttpStatusCode = 500,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toApiError(): ApiError {
    return { code: this.code, message: this.message, details: this.details };
  }
}

// Convenience factories for common cases.
export const Errors = {
  notFound(resource: string, details?: Record<string, unknown>): AppError {
    return new AppError(
      ERROR_CODES.NOT_FOUND,
      resource + " not found",
      404,
      details
    );
  },
  validation(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(ERROR_CODES.VALIDATION, message, 422, details);
  },
  unauthorized(message = "Authentication required"): AppError {
    return new AppError(ERROR_CODES.UNAUTHORIZED, message, 401);
  },
  forbidden(message = "Access denied"): AppError {
    return new AppError(ERROR_CODES.FORBIDDEN, message, 403);
  },
  conflict(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(ERROR_CODES.CONFLICT, message, 409, details);
  },
  badRequest(message: string, details?: Record<string, unknown>): AppError {
    return new AppError(ERROR_CODES.BAD_REQUEST, message, 400, details);
  },
  serviceUnavailable(message = "Service temporarily unavailable"): AppError {
    return new AppError(ERROR_CODES.SERVICE_UNAVAILABLE, message, 503);
  },
  internal(message = "Internal server error"): AppError {
    return new AppError(ERROR_CODES.INTERNAL, message, 500);
  },
};

export class ErrorHandler {
  // Turns any thrown value into a typed AppError.
  static normalize(err: unknown): AppError {
    if (err instanceof AppError) return err;
    if (err instanceof Error) {
      return new AppError(ERROR_CODES.INTERNAL, err.message, 500);
    }
    return new AppError(ERROR_CODES.INTERNAL, "Unknown error", 500);
  }

  // Produces a ready NextResponse from any thrown value.
  static handle(err: unknown, requestId: string, startedAt?: number): NextResponse {
    const appError = ErrorHandler.normalize(err);

    logger.error(appError.message, {
      code: appError.code,
      httpStatus: appError.httpStatus,
      requestId,
      details: appError.details,
    });

    return ApiResponse.error(
      appError.toApiError(),
      requestId,
      appError.httpStatus,
      startedAt
    );
  }
}
