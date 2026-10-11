// config/automation-templates.ts
// AT24 Automation - the Beta template set. Each is a ready-to-use versioned
// workflow definition (types/automation.ts). Creating from a template produces
// a REAL DRAFT automation - never a demo run (AUTOMATION_DECISION_LOCK.md).
//
// Phase 2 (AUTOMATION_P2_DELIVERY.md) corrected two defects found by reading
// real production runs:
//   1. A condition on `$.steps.s1.confidence` could never be met - the Market
//      Intelligence output has `regimeConfidence` (0-100) and `bias`, not
//      `confidence` - so the Gold template always halted. Conditions now use
//      the real fields.
//   2. "Save to Workspace" stored the Research step's (usually empty,
//      `no-coverage`) result instead of the Market Intelligence conclusion.
//      Saves now point at the step that actually holds the analysis.
// Every template also carries a `delivery` block: results go to the in-app
// bell, and to the user's own Telegram / push if they connected them.
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

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI"] as const;
const DELIVERY = { channels: ["bell", "telegram", "push"] } as const;

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: "daily-market-brief",
    name: "Daily Market Brief",
    description:
      "Every weekday at 08:00 IST: Market Intelligence for your instrument (bias, regime and the reasons behind it), saved to your results and sent to you.",
    overridable: ["name", "symbol"],
    definition: {
      schemaVersion: 1,
      trigger: { type: "weekly", timezone: "Asia/Kolkata", slot: "morning_ist", daysOfWeek: [...WEEKDAYS] },
      steps: [
        { id: "s1", kind: "agent_run", action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD", timeframe: "1h" } } },
        { id: "s2", kind: "workspace_save", action: { title: "Daily Market Brief", from: "$.steps.s1.result" } },
      ],
      delivery: { channels: [...DELIVERY.channels] },
      metadata: { templateId: "daily-market-brief" },
    },
  },
  {
    id: "gold-morning-intelligence",
    name: "Gold Morning Intelligence",
    description:
      "Weekdays at 08:00 IST: Market Intelligence, and only when the regime is clear (confidence 70 or more) it is saved, sent to you, and a publication draft is created for your review.",
    overridable: ["name", "symbol"],
    definition: {
      schemaVersion: 1,
      trigger: { type: "weekly", timezone: "Asia/Kolkata", slot: "morning_ist", daysOfWeek: [...WEEKDAYS] },
      steps: [
        { id: "s1", kind: "agent_run", action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD", timeframe: "1h" } } },
        { id: "s2", kind: "condition", condition: { left: "$.steps.s1.regimeConfidence", op: "gte", right: 70 } },
        { id: "s3", kind: "workspace_save", action: { title: "Gold Morning Intelligence", from: "$.steps.s1.result" } },
        { id: "s4", kind: "publication_draft", action: { category: "gold-analysis", aiOverviewFrom: "$.steps.s1.briefText" } },
      ],
      delivery: { channels: [...DELIVERY.channels] },
      metadata: { templateId: "gold-morning-intelligence" },
    },
  },
  {
    id: "research-publication-monitor",
    name: "Evening Outlook Draft",
    description:
      "Every evening at 18:30 IST: Market Intelligence, and only when the regime is clear (confidence 70 or more) a market-outlook publication draft is created for your review and you are notified.",
    overridable: ["name", "symbol"],
    definition: {
      schemaVersion: 1,
      trigger: { type: "daily", timezone: "Asia/Kolkata", slot: "evening_ist" },
      steps: [
        { id: "s1", kind: "agent_run", action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD", timeframe: "1h" } } },
        { id: "s2", kind: "condition", condition: { left: "$.steps.s1.regimeConfidence", op: "gte", right: 70 } },
        { id: "s3", kind: "publication_draft", action: { category: "market-outlook", aiOverviewFrom: "$.steps.s1.briefText" } },
      ],
      delivery: { channels: [...DELIVERY.channels] },
      metadata: { templateId: "research-publication-monitor" },
    },
  },
] as const;

const BY_ID = new Map(AUTOMATION_TEMPLATES.map((t) => [t.id, t]));

export function getAutomationTemplate(id: string): AutomationTemplate | undefined {
  return BY_ID.get(id);
}
