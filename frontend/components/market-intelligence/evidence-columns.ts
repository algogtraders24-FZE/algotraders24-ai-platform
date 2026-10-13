// components/market-intelligence/evidence-columns.ts
// Pure: decides what the report's right-hand evidence column shows (see splitEvidenceColumns).
import type { ExplanationLine } from "@/types/explainable-analysis";

const isCalendarLine = (line: ExplanationLine) => line.basis.some((b) => /economic calendar/i.test(b.source));

/**
 * The right-hand evidence column. With real opposing evidence it is shown as-is. With none, an
 * empty "None available" box said nothing, so the column shows what is actually worth watching:
 * the upcoming high-impact calendar events (neutral by nature - neither for nor against, so they
 * move out of Supporting), else the measured risk categories rated medium or high. When there is
 * neither, the column is dropped.
 */
export function splitEvidenceColumns(
  supporting: ExplanationLine[],
  opposing: ExplanationLine[],
  riskCategories: ReadonlyArray<{ category: string; level: string; rationale: string[]; basis: unknown[] }>,
): { leftLines: ExplanationLine[]; rightColumn: { title: string; lines: ExplanationLine[]; tone: "gold" | "down" | "neutral" } | null } {
  if (opposing.length > 0) return { leftLines: supporting, rightColumn: { title: "Opposing Evidence", lines: opposing, tone: "down" } };
  const events = supporting.filter(isCalendarLine);
  if (events.length > 0) {
    return { leftLines: supporting.filter((l) => !isCalendarLine(l)), rightColumn: { title: "Events to watch", lines: events, tone: "neutral" } };
  }
  const risks: ExplanationLine[] = riskCategories
    .filter((c) => c.basis.length > 0 && c.level !== "low")
    .map((c) => ({ text: `${c.category} risk is ${c.level}: ${c.rationale.join("; ")}`, basis: [] }));
  if (risks.length > 0) return { leftLines: supporting, rightColumn: { title: "Risks to watch", lines: risks, tone: "neutral" } };
  return { leftLines: supporting, rightColumn: null };
}

