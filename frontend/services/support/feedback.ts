// services/support/feedback.ts
// AT24 Copilot Phase 4: thumbs up / down on an answer. Stored on the run's own metadata Json (the
// same zero-migration pattern as the resolution confirmation), ownership-scoped, SUPPORT runs only.
import { agentRunRepository } from "@/services/agent-framework/runtime/agent-run.repository";

export type FeedbackValue = "up" | "down";

export class FeedbackNotAllowedError extends Error {
  constructor(runId: string, reason: string) {
    super(`feedback not allowed for run ${runId}: ${reason}`);
    this.name = "FeedbackNotAllowedError";
  }
}

export function isFeedbackValue(v: unknown): v is FeedbackValue {
  return v === "up" || v === "down";
}

/** Record (or change) the caller's rating of one SUPPORT answer. Returns null when the run does not
 *  exist or is not the caller's (indistinguishable, like every other ownership-scoped read). */
export async function recordSupportFeedback(
  userId: string,
  runId: string,
  value: FeedbackValue,
): Promise<{ value: FeedbackValue; at: string } | null> {
  const run = await agentRunRepository.getRunForUser(runId, userId);
  if (!run) return null;
  const metadata = (run.metadata ?? {}) as Record<string, unknown> & { definition?: { type?: string } };
  if (metadata.definition?.type !== "SUPPORT") throw new FeedbackNotAllowedError(runId, "not a SUPPORT run");

  const feedback = { value, at: new Date().toISOString() };
  await agentRunRepository.patchRun(runId, { metadata: { ...metadata, feedback } });
  return feedback;
}
