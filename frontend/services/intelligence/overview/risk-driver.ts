// services/intelligence/overview/risk-driver.ts
// What is behind a symbol's overall risk level on the AI Signals page. The
// overall level is the WORST of eight categories, several of which are honest
// "unmeasured" defaults, so on its own it reads the same for every market. This
// names the categories sitting at that level and the engine's own first reason
// - a pure passthrough of RiskEngine's text, nothing added.

export interface RiskDriver {
  categories: string[];
  reason: string;
}

export function riskDriverOf(risk: { overallLevel?: string; categories: readonly { category: string; level: string; rationale: readonly string[] }[] }): RiskDriver | undefined {
  if (!risk.overallLevel) return undefined;
  const at = risk.categories.filter((c) => c.level === risk.overallLevel);
  if (at.length === 0) return undefined;
  return { categories: at.map((c) => c.category), reason: at[0].rationale[0] ?? "" };
}
