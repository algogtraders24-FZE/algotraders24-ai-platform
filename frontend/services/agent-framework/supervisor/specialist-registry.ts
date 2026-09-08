// services/agent-framework/supervisor/specialist-registry.ts
// AT24 Agent Framework - A5. Maps an agent type to its planning/reasoning
// specialist. Missing -> the generic tool-walk specialist. Adding a
// specialist for RESEARCH / STRATEGY_RESEARCH / RISK / ... later is one
// entry here - they all reuse the same runtime, registry and governance.

import type { AgentType } from "../agent-type-registry";
import type { Specialist } from "./specialist";
import { genericSpecialist } from "./specialists/generic.specialist";
import { marketIntelligenceSpecialist } from "./specialists/market-intelligence.specialist";
import { researchSpecialist } from "./specialists/research.specialist";
import { strategyResearchSpecialist } from "./specialists/strategy-research.specialist";

const SPECIALISTS: Partial<Record<AgentType, Specialist>> = {
  MARKET_INTELLIGENCE: marketIntelligenceSpecialist,
  RESEARCH: researchSpecialist,
  STRATEGY_RESEARCH: strategyResearchSpecialist,
};

export function selectSpecialist(agentType: string): Specialist {
  return SPECIALISTS[agentType as AgentType] ?? genericSpecialist;
}

export { genericSpecialist };
