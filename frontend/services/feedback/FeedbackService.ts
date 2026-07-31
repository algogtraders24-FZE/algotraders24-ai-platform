// services/feedback/FeedbackService.ts
// Sprint R1.2 - Phase 1: user-facing half of the Feedback feature. Only
// submits on behalf of the session user (never a client-supplied userId) -
// the admin-facing list/status-update half lives separately in
// AdminFeedbackService, gated by requireAdmin.
import { prisma } from "@/lib/prisma";

export type FeedbackType = "bug" | "feature" | "general";

const VALID_TYPES: readonly FeedbackType[] = ["bug", "feature", "general"];

export function isFeedbackType(value: unknown): value is FeedbackType {
  return typeof value === "string" && (VALID_TYPES as readonly string[]).includes(value);
}

export class FeedbackService {
  async submit(params: { userId: string; type: FeedbackType; message: string; page: string }): Promise<{ id: string }> {
    const created = await prisma.feedback.create({
      data: {
        userId: params.userId,
        type: params.type,
        message: params.message,
        page: params.page,
      },
      select: { id: true },
    });
    return created;
  }
}

export const feedbackService = new FeedbackService();
