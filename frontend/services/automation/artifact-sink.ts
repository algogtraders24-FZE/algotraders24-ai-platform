// services/automation/artifact-sink.ts
// AT24 Automation (MVP) - the "save result to Workspace" sink
// (AUTOMATION_GAP_REPORT.md G2). An AutomationArtifact row is the durable
// record; the Workspace "Automation results" panel reads
// automationRepository.listArtifactsForUser.
//
// The payload is ALWAYS already-safe data: the child AgentRun's observability
// output or an { articleId } pointer. Never a raw provider response.

import type { AutomationArtifactKind } from "@/lib/generated/prisma/enums";
import { automationRepository } from "./automation-repository";

export interface SaveArtifactInput {
  userId: string;
  automationRunId: string;
  stepRunId: string;
  title: string;
  kind: AutomationArtifactKind;
  payload: unknown;
}

export const artifactSink = {
  async save(input: SaveArtifactInput): Promise<{ artifactId: string }> {
    const row = await automationRepository.appendArtifact({
      userId: input.userId,
      automationRunId: input.automationRunId,
      stepRunId: input.stepRunId,
      kind: input.kind,
      title: input.title.slice(0, 200) || "Automation result",
      payload: input.payload ?? null,
    });
    return { artifactId: row.id };
  },

  async listForUser(userId: string, limit = 25) {
    const rows = await automationRepository.listArtifactsForUser(userId, limit);
    return rows.map((r) => ({
      id: r.id,
      automationRunId: r.automationRunId,
      kind: r.kind,
      title: r.title,
      payload: r.payload,
      createdAt: r.createdAt.toISOString(),
    }));
  },
};
