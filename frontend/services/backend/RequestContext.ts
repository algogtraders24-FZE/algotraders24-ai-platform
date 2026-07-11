// services/backend/RequestContext.ts
// Sprint 14A — Backend Foundation
// Per-request context: id, method, path, timing, user.

import type { RequestContextData } from "@/types/api";
import { FEATURE_FLAGS } from "@/config/backend.config";

export class RequestContext {
  readonly requestId: string;
  readonly method: string;
  readonly path: string;
  readonly startedAt: number;
  userId: string | null;

  constructor(method: string, path: string) {
    this.requestId = RequestContext.generateId();
    this.method = method;
    this.path = path;
    this.startedAt = Date.now();
    this.userId = FEATURE_FLAGS.authEnabled ? null : "u1";
  }

  static generateId(): string {
    const rand = Math.random().toString(36).slice(2, 10);
    return "req_" + Date.now().toString(36) + "_" + rand;
  }

  static fromRequest(req: Request): RequestContext {
    let path = "";
    try {
      path = new URL(req.url).pathname;
    } catch {
      path = req.url;
    }
    return new RequestContext(req.method, path);
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  toData(): RequestContextData {
    return {
      requestId: this.requestId,
      method: this.method,
      path: this.path,
      startedAt: this.startedAt,
      userId: this.userId,
    };
  }
}
