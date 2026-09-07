// services/agent-framework/supervisor/specialists/research.specialist.ts
// AT24 Agent Framework - A11. The Research specialist.
//
// PLAN: among the agent's bound tools, knowledge base first (the user's own
// curated material), then news (recent market-moving headlines).
//
// SYNTHESIS: a deterministic, EVIDENCE-FIRST research brief. The agent does
// NOT paraphrase, restate or summarise the source text - every finding is a
// typed CITATION of an AgentEvidence row (id + source + relevance), and the
// claim text stays in the immutable evidence trail where the A6 integrity
// gate can verify its lineage. NO LLM, NO fabricated "web result", NO
// invented sources. The "synthesis" is coverage + ranking + a determination
// of whether the question was answerable from the available material.

import type { AgentDefinition } from "@/types/agent-framework";
import type { ParsedGoal } from "../goal";
import type { Specialist, SpecialistPlan } from "../specialist";
import type { RunTrace, RunSynthesis } from "../run-planner";
import { shapeGoalForTool } from "../plan-shaping";

const PLAN_ORDER = ["research.knowledge_search", "news.search"];

type Coverage = "knowledge-backed" | "news-only" | "no-coverage";

interface Citation {
  evidenceId: string;
  sourceType: "knowledge" | "news" | "other";
  source: string;
  relevance: number;
  confidence: number;
}

export const researchSpecialist: Specialist = {
  key: "RESEARCH",

  planTools(_definition: AgentDefinition, goal: ParsedGoal, boundToolIds: string[]): SpecialistPlan {
    const ordered = [
      ...PLAN_ORDER.filter((id) => boundToolIds.includes(id)),
      ...boundToolIds.filter((id) => !PLAN_ORDER.includes(id)),
    ];
    const requests = ordered.map((toolId) => ({
      toolId,
      input: shapeResearchInput(toolId, goal),
      rationale:
        toolId === "research.knowledge_search"
          ? "search the owning user's own knowledge base for material on the question"
          : toolId === "news.search"
            ? "gather recent headlines from the platform news provider relevant to the question"
            : `bound tool "${toolId}"`,
    }));
    return {
      requests,
      rationale: `research plan: ${ordered.join(" -> ")} -> evidence-first citation brief`,
    };
  },

  synthesize(trace: RunTrace, _definition: AgentDefinition, goal: ParsedGoal): RunSynthesis {
    const citations: Citation[] = [];
    const sources = new Set<string>();
    let knowledgeHits = 0;
    let newsHits = 0;

    for (const e of trace.evidence) {
      const sourceType: Citation["sourceType"] =
        e.type === "research_document" ? "knowledge" : e.type === "news" ? "news" : "other";
      if (sourceType === "knowledge") knowledgeHits += 1;
      else if (sourceType === "news") newsHits += 1;
      sources.add(e.source);
      citations.push({
        evidenceId: e.id,
        sourceType,
        source: e.source,
        relevance: e.relevance,
        confidence: e.confidence,
      });
    }
    citations.sort((a, b) => b.relevance - a.relevance);

    const coverage: Coverage =
      knowledgeHits > 0 ? "knowledge-backed" : newsHits > 0 ? "news-only" : "no-coverage";
    const resolved = coverage !== "no-coverage";

    const question = goal.question || "(no explicit question)";
    const disclaimer =
      "Evidence-first research brief. Every citation points at an immutable evidence row from the user's own " +
      "knowledge base or the platform news provider - no web search, no external sources, no summarisation of " +
      "the underlying text. Decision support only; not financial advice or a trade recommendation.";

    return {
      output: {
        kind: "research-brief",
        question,
        resolved,
        coverage,
        citationCount: citations.length,
        knowledgeHits,
        newsHits,
        citations: citations.slice(0, 25),
        sources: [...sources],
        evidenceCount: trace.evidence.length,
        evidenceIds: trace.evidence.map((e) => e.id),
        disclaimer,
      },
      summary: resolved
        ? `research brief for "${truncate(question)}": ${citations.length} citation(s) from ${sources.size} source(s) (${coverage})`
        : `research brief for "${truncate(question)}": no material found in the knowledge base or news provider`,
    };
  },
};

function truncate(s: string): string {
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

function shapeResearchInput(toolId: string, goal: ParsedGoal): unknown {
  if (toolId === "research.knowledge_search") {
    const query =
      goal.question ||
      (typeof goal.raw === "string" ? goal.raw : "") ||
      goal.symbol ||
      "research";
    return { query };
  }
  if (toolId === "news.search") {
    return { symbol: goal.symbol ?? "XAUUSD" };
  }
  return shapeGoalForTool(toolId, goal);
}
