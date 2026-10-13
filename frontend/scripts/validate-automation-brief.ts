// scripts/validate-automation-brief.ts
// AT24 Automation Phase 2 - the readable-result formatter + the shipped
// templates. Pure/in-memory (no DB, no network). `npm run validate:automation-brief`.
//
// The fixtures below are the REAL output shapes read from production agent
// runs on 2026-10-12 (Market Intelligence + Research), so a change to an
// agent's output that breaks the formatter fails here first.

import assert from "node:assert/strict";
import { composeAgentBrief, briefToText, combineBriefsText } from "../services/automation/brief";
import { evaluateCondition } from "../services/automation/condition-eval";
import { emptyRunContext } from "../services/automation/context-path";
import { validateWorkflowDefinition } from "../services/automation/workflow-validator";
import { AUTOMATION_TEMPLATES } from "../config/automation-templates";

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

const REAL_MI = {
  bias: "bullish-leaning",
  kind: "market-intelligence-conclusion",
  basis: [
    "regime: trending-bullish (confidence 100)",
    "hypotheses: 1 bullish / 0 bearish of 1",
    "EMA20 (4137.54131) is above EMA50 (4132.47904).",
    "Latest price (4170.90100) is above EMA20.",
    'Direction classified as "up" from the EMA relationship and price position above.',
  ],
  symbol: "XAUUSD",
  resolved: true,
  timeframe: "1h",
  disclaimer: "Decision support only. This is the platform's deterministic regime classification for the instrument, not a trade recommendation.",
  regimeType: "trending-bullish",
  evidenceIds: ["a", "b", "c"],
  hypothesisCount: 1,
  pipelineVersion: "15D.12.0",
  regimeConfidence: 100,
};

const REAL_RESEARCH_EMPTY = {
  kind: "research-brief",
  sources: [],
  coverage: "no-coverage",
  newsHits: 0,
  question: "Daily market brief",
  resolved: false,
  citations: [],
  disclaimer: "Evidence-first research brief. Decision support only; not financial advice.",
  evidenceIds: [],
  citationCount: 0,
  evidenceCount: 0,
  knowledgeHits: 0,
};

async function main(): Promise<void> {
  console.log("validate-automation-brief\n");

  test("real Market Intelligence output -> headline with symbol, bias, regime", () => {
    const b = composeAgentBrief(REAL_MI)!;
    assert.equal(b.empty, false);
    assert.equal(b.headline, "Gold (XAUUSD 1h): leaning bullish - trending up");
    assert.equal(b.lines.length, 2); // jargon lines (regime:/hypotheses:/Direction classified) are dropped
    assert.ok(b.lines.every((l) => !/^(regime|hypotheses):/i.test(l)));
    assert.equal(b.changed, undefined); // no previous run supplied
    assert.ok(b.disclaimer && b.disclaimer.includes("Decision support only"));
  });

  test("real EMPTY research output is flagged empty (so it is never delivered as noise)", () => {
    const b = composeAgentBrief(REAL_RESEARCH_EMPTY)!;
    assert.equal(b.empty, true);
  });

  test("research with citations is reported, with its sources", () => {
    const b = composeAgentBrief({ kind: "research-brief", citationCount: 3, coverage: "knowledge-backed", sources: ["Gold notes", "Fed minutes"], question: "gold" })!;
    assert.equal(b.empty, false);
    assert.equal(b.headline, "Research: 3 sources (knowledge-backed)");
    assert.ok(b.lines.includes("Source: Gold notes"));
  });

  test("unresolved Market Intelligence is empty, not a made-up bias", () => {
    const b = composeAgentBrief({ kind: "market-intelligence-conclusion", symbol: "EURUSD", timeframe: "1h", resolved: false })!;
    assert.equal(b.empty, true);
    assert.ok(!b.headline.includes("bullish") && !b.headline.includes("bearish"));
  });

  test("strategy research: conclusion is the headline; no conclusion is empty", () => {
    assert.equal(composeAgentBrief({ kind: "strategy-research-brief", conclusion: "Net profit positive over 40 positions", hypothesis: "EMA cross works" })!.empty, false);
    assert.equal(composeAgentBrief({ kind: "strategy-research-brief" })!.empty, true);
  });

  test("unknown agent kind: generic, non-empty, claims nothing more", () => {
    const b = composeAgentBrief({ kind: "something-new", anything: 1 })!;
    assert.equal(b.empty, false);
    assert.equal(b.headline, "Result (something-new)");
    assert.deepEqual(b.lines, []);
  });

  test("non-object output -> null; malformed fields never throw", () => {
    assert.equal(composeAgentBrief(null), null);
    assert.equal(composeAgentBrief("text"), null);
    assert.doesNotThrow(() => composeAgentBrief({ kind: "market-intelligence-conclusion", resolved: true, bias: 5, basis: "x", symbol: {} }));
  });

  test("very long basis lines are clipped; max 6 lines", () => {
    const b = composeAgentBrief({ ...REAL_MI, basis: Array.from({ length: 12 }, () => "x".repeat(500)) })!;
    assert.equal(b.lines.length, 6);
    assert.ok(b.lines.every((l) => l.length <= 220));
  });

  test("combineBriefsText drops empty briefs and joins the rest", () => {
    const text = combineBriefsText([composeAgentBrief(REAL_MI), composeAgentBrief(REAL_RESEARCH_EMPTY), null]);
    assert.ok(text.startsWith("Gold (XAUUSD 1h): leaning bullish"));
    assert.ok(!text.includes("Research"));
    assert.equal(combineBriefsText([composeAgentBrief(REAL_RESEARCH_EMPTY)]), "");
    assert.ok(briefToText(composeAgentBrief(REAL_MI)!).includes("• EMA20"));
  });

  // ── Brief v2: what changed since the last run ──
  test("no previous run -> no change claim", () => {
    const b = composeAgentBrief(REAL_MI)!;
    assert.equal(b.changed, undefined);
    assert.equal(b.changeNote, undefined);
  });

  test("same bias + regime as last run -> changed=false", () => {
    const b = composeAgentBrief(REAL_MI, { ...REAL_MI, regimeConfidence: 80 })!;
    assert.equal(b.changed, false);
    assert.equal(b.changeNote, "No change since the last brief.");
  });

  test("bias flipped since last run -> changed=true with a plain note", () => {
    const b = composeAgentBrief(REAL_MI, { ...REAL_MI, bias: "neutral" })!;
    assert.equal(b.changed, true);
    assert.equal(b.changeNote, "Changed since the last brief: was no clear direction, now leaning bullish.");
    assert.ok(briefToText(b).includes("Changed since the last brief"));
  });

  test("regime changed (same bias) -> changed=true", () => {
    const b = composeAgentBrief(REAL_MI, { ...REAL_MI, regimeType: "ranging" })!;
    assert.equal(b.changed, true);
    assert.match(b.changeNote ?? "", /was moving sideways, now trending up/);
  });

  test("an unresolved or foreign previous result is ignored, never invented against", () => {
    assert.equal(composeAgentBrief(REAL_MI, { kind: "market-intelligence-conclusion", resolved: false })!.changed, undefined);
    assert.equal(composeAgentBrief(REAL_MI, { kind: "research-brief" })!.changed, undefined);
    assert.equal(composeAgentBrief(REAL_MI, "text")!.changed, undefined);
  });

  test("plain-language headline: no raw enum or confidence number leaks", () => {
    const h = composeAgentBrief({ ...REAL_MI, bias: "neutral", regimeType: "low-volatility" })!.headline;
    assert.equal(h, "Gold (XAUUSD 1h): no clear direction - quiet");
    assert.ok(!/confidence|regime|low-volatility/.test(h));
  });

  // ── the shipped templates ──
  test("every shipped template passes the server validator", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      const r = validateWorkflowDefinition(t.definition);
      assert.equal(r.ok, true, `${t.id}: ${JSON.stringify(r.issues)}`);
    }
  });

  test("recurring-signal templates deliver on_change; the daily digest always delivers", () => {
    const mode = (id: string) => AUTOMATION_TEMPLATES.find((t) => t.id === id)!.definition.delivery?.mode;
    assert.equal(mode("gold-morning-intelligence"), "on_change");
    assert.equal(mode("research-publication-monitor"), "on_change");
    assert.equal(mode("daily-market-brief"), undefined);
  });

  test("every template carries a delivery block, and results go to a real step", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      assert.ok(t.definition.delivery && t.definition.delivery.channels.includes("bell"), `${t.id} has no delivery`);
      for (const s of t.definition.steps) {
        if (s.kind === "workspace_save") assert.match(s.action.from, /^\$\.steps\.s1\.result$/, `${t.id} saves the wrong source`);
      }
    }
  });

  test("template conditions can actually be MET by a real Market Intelligence output", () => {
    // mirror the dispatcher: ctx.steps[id] = { result, ...top-level primitives }
    const flat: Record<string, unknown> = { result: REAL_MI };
    for (const [k, v] of Object.entries(REAL_MI)) if (["string", "number", "boolean"].includes(typeof v)) flat[k] = v;
    const ctx = emptyRunContext({ type: "schedule" });
    ctx.steps.s1 = flat;
    let checked = 0;
    for (const t of AUTOMATION_TEMPLATES) {
      for (const s of t.definition.steps) {
        if (s.kind !== "condition") continue;
        const r = evaluateCondition(s.condition, ctx);
        assert.equal(r.result, true, `${t.id} condition ${s.condition.left} ${s.condition.op} ${s.condition.right} is not met by a confident real output (${r.note ?? "no note"})`);
        checked += 1;
      }
    }
    assert.ok(checked >= 2);
  });

  test("...and is correctly NOT met by a low-confidence output", () => {
    const ctx = emptyRunContext({ type: "schedule" });
    ctx.steps.s1 = { result: { ...REAL_MI, regimeConfidence: 40 }, regimeConfidence: 40 };
    const gold = AUTOMATION_TEMPLATES.find((t) => t.id === "gold-morning-intelligence")!;
    const cond = gold.definition.steps.find((s) => s.kind === "condition");
    assert.ok(cond && cond.kind === "condition");
    assert.equal(evaluateCondition(cond.condition, ctx).result, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
