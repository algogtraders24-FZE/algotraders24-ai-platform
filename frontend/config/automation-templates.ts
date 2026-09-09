// config/automation-templates.ts
// AT24 Automation (MVP) - the small set of Beta templates. Each is a
// ready-to-use versioned workflow definition (types/automation.ts). Creating
// from a template produces a REAL DRAFT automation - never a demo run
// (AUTOMATION_DECISION_LOCK.md; sprint §17).
//
// Not a DB table - product configuration, like config/plan-limits.ts.

import type { AutomationWorkflowDefinition } from "@/types/automation";

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  /** Fields a user may override at creation. `symbol` is substituted into
   *  every agent_run step's action.input.symbol. */
  overridable: ("name" | "symbol" | "slot")[];
  definition: AutomationWorkflowDefinition;
}

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: "daily-market-brief",
    name: "Daily Market Brief",
    description:
      "Every weekday morning: run Market Intelligence, then AI Research, and save the result to your Workspace.",
    overridable: ["name", "symbol"],
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "weekly",
        timezone: "Asia/Kolkata",
        slot: "morning_ist",
        daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
      },
      steps: [
        { id: "s1", kind: "agent_run", action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD", timeframe: "1h" } } },
        { id: "s2", kind: "agent_run", action: { agentType: "RESEARCH", input: { question: "Daily market brief", symbol: "XAUUSD" } } },
        { id: "s3", kind: "workspace_save", action: { title: "Daily Market Brief", from: "$.steps.s2.result" } },
      ],
      metadata: { templateId: "daily-market-brief" },
    },
  },
  {
    id: "gold-morning-intelligence",
    name: "Gold Morning Intelligence",
    description:
      "Weekdays at 08:00 IST: Gold Market Intelligence, and if confidence is high enough, run the research agent and create a publication draft.",
    overridable: ["name", "symbol"],
    definition: {
      schemaVersion: 1,
      trigger: {
        type: "weekly",
        timezone: "Asia/Kolkata",
        slot: "morning_ist",
        daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
      },
      steps: [
        {
          id: "s1",
          kind: "agent_run",
          action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD", timeframe: "1h" } },
          outputBindings: { confidence: "$.result.confidence" },
        },
        { id: "s2", kind: "condition", condition: { left: "$.steps.s1.confidence", op: "gte", right: 0.7 } },
        { id: "s3", kind: "agent_run", action: { agentType: "RESEARCH", input: { question: "Gold morning intelligence", symbol: "XAUUSD" } } },
        { id: "s4", kind: "publication_draft", action: { category: "gold-analysis", aiOverviewFrom: "$.steps.s3.summary" } },
        { id: "s5", kind: "workspace_save", action: { title: "Gold Morning Intelligence", from: "$.steps.s3.result" } },
      ],
      metadata: { templateId: "gold-morning-intelligence" },
    },
  },
  {
    id: "research-publication-monitor",
    name: "Research Publication Monitor",
    description:
      "Every evening: run AI Research, and if the result status is successful, create a publication draft for review.",
    overridable: ["name", "symbol"],
    definition: {
      schemaVersion: 1,
      trigger: { type: "daily", timezone: "Asia/Kolkata", slot: "evening_ist" },
      steps: [
        {
          id: "s1",
          kind: "agent_run",
          action: { agentType: "RESEARCH", input: { question: "End-of-day research monitor", symbol: "XAUUSD" } },
          outputBindings: { status: "$.result.status" },
        },
        { id: "s2", kind: "condition", condition: { left: "$.steps.s1.status", op: "neq", right: "FAILED" } },
        { id: "s3", kind: "publication_draft", action: { category: "market-outlook", aiOverviewFrom: "$.steps.s1.summary" } },
      ],
      metadata: { templateId: "research-publication-monitor" },
    },
  },
] as const;

const BY_ID = new Map(AUTOMATION_TEMPLATES.map((t) => [t.id, t]));

export function getAutomationTemplate(id: string): AutomationTemplate | undefined {
  return BY_ID.get(id);
}
