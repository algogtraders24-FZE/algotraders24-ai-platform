// services/api/FeedbackApi.ts
// Sprint R1.2 - Phase 1: client access to the user-facing feedback route.
import { ApiClient } from "./ApiClient";
import type { FeedbackType } from "@/services/feedback/FeedbackService";

export class FeedbackApi {
  static async submit(type: FeedbackType, message: string, page: string): Promise<{ id: string }> {
    return ApiClient.post<{ id: string }>("/api/private/feedback", { type, message, page });
  }
}
