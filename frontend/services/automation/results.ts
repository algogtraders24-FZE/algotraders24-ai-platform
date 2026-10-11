// services/automation/results.ts
// AT24 Automation Phase 2 - the "Latest results" feed: what the user's
// automations actually concluded, newest first. Reads the artifacts that the
// workspace_save step already writes (no new table) and renders each through
// the same pure brief formatter as Run Detail and the notifications.
//
// Ownership: scoped by userId on both the artifact and its run. Artifacts that
// say nothing (e.g. a research brief with 0 citations) are left out so the
// feed is signal, not noise.

import type { AgentBrief } from "@/types/automation";
import { automationRepository } from "./automation-repository";
import { composeAgentBrief } from "./brief";

export interface AutomationResultItem {
  artifactId: string;
  title: string;
  runId: string;
  automationId: string | null;
  automationName: string | null;
  createdAt: string;
  brief: AgentBrief;
}

export async function getLatestResults(userId: string, limit = 20): Promise<AutomationResultItem[]> {
  const rows = await automationRepository.listArtifactsWithAutomation(userId, limit * 2);
  const items: AutomationResultItem[] = [];
  for (const r of rows) {
    const brief = composeAgentBrief(r.artifact.payload);
    if (!brief || brief.empty) continue;
    items.push({
      artifactId: r.artifact.id,
      title: r.artifact.title,
      runId: r.artifact.automationRunId,
      automationId: r.automationId,
      automationName: r.automationName,
      createdAt: r.artifact.createdAt.toISOString(),
      brief,
    });
    if (items.length >= limit) break;
  }
  return items;
}
