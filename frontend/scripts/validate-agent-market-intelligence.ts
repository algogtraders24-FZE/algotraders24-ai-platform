// scripts/validate-agent-market-intelligence.ts
// Sprint AN, step A12 - the Market Intelligence Agent (G12 target).
//
// House style (node:assert/strict, tsx). Run: npm run validate:agent-market-intelligence
//
// A12 adds an agent DEFINITION + a thin entrypoint. The planning/synthesis
// SPECIALISATION (marketIntelligenceSpecialist) and the tool
// (market.intelligence -> RealTimeIntelligenceService ->
// MarketIntelligencePipelineService) already exist from A5/A2. A12 adds NO
// new runtime, planner, store, engine, score, or persistence model.
//
// Proves:
//   - marketIntelligenceAgentDefinition() is a valid AF-v1 AgentDefinition
//     (MARKET_INTELLIGENCE type, autonomy 1, bound to market.snapshot +
//     market.intelligence only, seeded permissions, no signal permission)
//   - MARKET_INTELLIGENCE -> marketIntelligenceSpecialist; deterministic
//     plan market.snapshot -> market.intelligence, NO LLM
//   - E2E on a FAKE registry: a resolved pipeline context -> a faithful
//     bullish/bearish/neutral LEAN, evidence lineage, A6 integrity PASS,
//     A10 evaluation persisted, NO prohibited trading field / signal language
//   - the agent relays the pipeline's OWN classification - it does not
//     compute a second regime/score (structural + behavioural)
//   - graceful behaviour when the pipeline is unresolved (insufficient-data)
//     -> neutral, resolved:false, honest reason - still A6 PASS
//   - E2E on the REAL registry (best-effort): clean terminal state either way

process.env.AGENT_CREDIT_INMEMORY = "1"; // A9: harness ledger, no real rows
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateAgentDefinition,
  AGENT_EVALUATION_DIMENSIONS,
} from "../types/agent-framework/index";
import { isKnownAgentType, autonomyCapForType } from "../services/agent-framework/agent-type-registry";
import { selectSpecialist, SupervisorService } from "../services/agent-framework/supervisor/index";
import { ToolRegistry } from "../services/agent-framework/tools/tool-registry";
import { buildToolRegistry } from "../services/agent-framework/tools/registry-manifest";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { AgentRuntime } from "../services/agent-framework/runtime/agent-runtime";
import { agentRunRepository } from "../services/agent-framework/runtime/agent-run.repository";
import {
  marketIntelligenceAgentDefinition,
  runMarketIntelligenceAgent,
  MARKET_INTELLIGENCE_AGENT_TOOL_IDS,
} from "../services/agent-framework/agents/market-intelligence-agent";
import { CreditLedger, InMemoryCreditStore, FixedAllowanceResolver } from "../services/agent-framework/credits/index";
import { EvaluationService } from "../services/agent-framework/evaluation/evaluation-service";
import { InMemoryEvaluationStore } from "../services/agent-framework/evaluation/evaluation-store";
import { prisma } from "../lib/prisma";

const TEST_USER = "validate-agent-mi-user";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL - ${name}`);
    console.error(err instanceof Error ? `    ${err.stack ?? err.message}` : `    ${String(err)}`);
  }
}

// ------------------------------------------------------------------
// Fake, dependency-free stand-ins for the two bound tools, under the
// SAME ids so the agent definition's bindings resolve. The
// market.intelligence fake returns a pipeline-context-shaped payload -
// the specialist reads envelope.regime / envelope.hypotheses.
// ------------------------------------------------------------------

const RESOLVED_CTX = {
  status: "resolved",
  generatedAt: new Date().toISOString(),
  envelope: {
    symbol: "XAUUSD",
    timeframe: "1h",
    regime: {
      regimeType: "trending-bullish",
      confidence: 0.62,
      basis: ["price above a rising 50-period average", "higher highs and higher lows across the session"],
    },
    hypotheses: [
      { type: "momentum-bullish", statement: { claim: "momentum favours continuation" } },
      { type: "structure-bullish", statement: { claim: "structure has not broken down" } },
    ],
    intelligenceScore: { value: 0.6 },
    pipelineVersion: "test-15D.x",
  },
};

function fakeSnapshot(): ToolImplementation<Record<string, never>, unknown> {
  return {
    definition: {
      id: "market.snapshot", name: "market.snapshot", description: "fake", version: "1.0.0", category: "MARKET_DATA",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_READ_MARKET_DATA"], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 1 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["market_data"], provenanceProducer: "fake-snapshot" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      return {
        output: { symbol: "XAUUSD", price: 2600, provider: "fake", timestamp: now },
        evidence: [{
          type: "market_data", claim: "XAUUSD quote anchored", source: "fake", sourceId: "XAUUSD:1h",
          timestamp: now, data: { price: 2600 }, relevance: 0.5, confidence: 0.9,
          provenance: { producer: "fake-snapshot", retrievedAt: now },
        }],
      };
    },
  };
}

function fakeIntelligence(ctx: unknown): ToolImplementation<Record<string, never>, unknown> {
  return {
    definition: {
      id: "market.intelligence", name: "market.intelligence", description: "fake", version: "1.0.0", category: "MARKET_DATA",
      inputSchema: { type: "object" }, outputSchema: { type: "object" },
      requiredPermissions: ["CAN_READ_MARKET_DATA"], autonomyFloor: 0,
      creditCost: { model: "flat", credits: 4 }, executionMode: "sync",
      evidence: { producesEvidence: true, evidenceTypes: ["regime"], provenanceProducer: "fake-pipeline" },
      status: "active", wraps: "n/a (test fixture)",
    },
    parseInput: () => ({ ok: true, value: {} }),
    checkOutput: () => ({ valid: true, violations: [] }),
    handler: async () => {
      const now = new Date().toISOString();
      const resolved = (ctx as { status?: string }).status === "resolved";
      return {
        output: ctx,
        evidence: resolved
          ? [{
              type: "regime", claim: "pipeline classified the regime as trending-bullish", source: "intelligence-pipeline",
              sourceId: "XAUUSD:1h:regime", timestamp: now,
              data: { regimeType: "trending-bullish", confidence: 0.62 }, relevance: 0.9, confidence: 0.62,
              provenance: { producer: "fake-pipeline", retrievedAt: now, pipelineVersion: "test-15D.x" },
            }]
          : [],
      };
    },
  };
}

function fakeRegistry(ctx: unknown = RESOLVED_CTX): ToolRegistry {
  return new ToolRegistry().register(fakeSnapshot()).register(fakeIntelligence(ctx)).freeze();
}

function harness(registry: ToolRegistry) {
  const ledger = new CreditLedger({ store: new InMemoryCreditStore(), allowances: new FixedAllowanceResolver(100000) });
  const evaluation = new EvaluationService({ registry, creditLedger: ledger, store: new InMemoryEvaluationStore() });
  const rt = new AgentRuntime({ registry, creditLedger: ledger, evaluation });
  return { rt, evaluation };
}

const FORBIDDEN_KEYS = ["entry", "entryzone", "stoploss", "stop_loss", "takeprofit", "take_profit", "target", "positionsize", "position_size", "signal", "side", "direction", "recommendation", "order", "trade"];
const FORBIDDEN_TEXT = [/\bbuy\b/i, /\bsell\b/i, /\bgo (?:long|short)\b/i, /win[- ]?rate/i, /probability of profit/i, /\d+\s*%\s*(?:chance|probability|win)/i];

async function cleanup(): Promise<void> {
  await agentRunRepository._deleteRunsForUser(TEST_USER);
}

async function main(): Promise<void> {
  console.log("\nAN1.14 - Market Intelligence Agent (A12) validation\n");
  await cleanup();

  // ----------------------------------------------------------------
  // 1. definition
  // ----------------------------------------------------------------

  await test("marketIntelligenceAgentDefinition(): valid AF-v1, MARKET_INTELLIGENCE, autonomy 1, snapshot + intelligence", () => {
    const def = marketIntelligenceAgentDefinition();
    const res = validateAgentDefinition(def, { isRegisteredType: isKnownAgentType, autonomyCapForType });
    assert.equal(res.valid, true, JSON.stringify(res.violations));
    assert.equal(def.type, "MARKET_INTELLIGENCE");
    assert.equal(def.autonomyLevel, 1);
    assert.deepEqual(def.tools.map((t) => t.toolId), [...MARKET_INTELLIGENCE_AGENT_TOOL_IDS]);
    assert.deepEqual(def.tools.map((t) => t.toolId).sort(), ["market.intelligence", "market.snapshot"]);
    for (const p of def.permissionPolicy.granted) {
      assert.ok(p !== "CAN_CREATE_ORDER" && p !== "CAN_EXECUTE_ORDER" && p !== "CAN_GENERATE_SIGNAL", `must not hold ${p}`);
    }
    // NOT bound to a second engine's worth of tools
    assert.ok(!def.tools.some((t) => t.toolId === "indicators.compute"));
  });

  await test("the two bound tools ARE registered and wrap the existing pipeline (not a rebuild)", () => {
    const reg = buildToolRegistry();
    assert.ok(reg.has("market.snapshot"));
    assert.ok(reg.has("market.intelligence"));
    const wraps = reg.describe("market.intelligence").wraps;
    assert.match(wraps, /RealTimeIntelligenceService|intelligence/i, "market.intelligence wraps the existing service");
  });

  // ----------------------------------------------------------------
  // 2. deterministic planning
  // ----------------------------------------------------------------

  await test("MARKET_INTELLIGENCE -> marketIntelligenceSpecialist; plan: market.snapshot -> market.intelligence, no LLM", async () => {
    assert.equal(selectSpecialist("MARKET_INTELLIGENCE").key, "MARKET_INTELLIGENCE");
    const sup = new SupervisorService({ registry: fakeRegistry(), llmAssist: false });
    const plan = await sup.plan(
      marketIntelligenceAgentDefinition(),
      { question: "Is gold trending up or down right now?", symbol: "XAUUSD", timeframe: "1h" },
      { userId: TEST_USER, runId: "test-run" },
    );
    assert.deepEqual(plan.requests.map((r) => r.toolId), ["market.snapshot", "market.intelligence"]);
    assert.equal(plan.planMetadata?.specialist, "MARKET_INTELLIGENCE");
    assert.equal(plan.planMetadata?.planningPath, "deterministic");
  });

  await test("structural: A12 added no new infra - agents/ holds only the 2 agent definitions", () => {
    const agentsDir = join(ROOT, "services", "agent-framework", "agents");
    assert.deepEqual(readdirSync(agentsDir).sort(), ["market-intelligence-agent.ts", "research-agent.ts"]);
    const src = readFileSync(join(agentsDir, "market-intelligence-agent.ts"), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b|await import\(/.test(l));
    // the agent file must NOT import the pipeline / a regime engine / lib/ai - it only builds a definition
    for (const bad of ["RealTimeIntelligence", "MarketIntelligencePipeline", "lib/ai", "regime", "tool-gateway"]) {
      assert.ok(!importLines.some((l) => l.includes(bad)), `agent file must not import "${bad}"`);
    }
  });

  // ----------------------------------------------------------------
  // 3. E2E on a fake registry (deterministic) - resolved
  // ----------------------------------------------------------------

  await test("E2E (fake, resolved): faithful bullish-leaning relay, lineage, A6 PASS, A10 evaluation, not a signal", async () => {
    const registry = fakeRegistry(RESOLVED_CTX);
    const { rt, evaluation } = harness(registry);
    const final = await runMarketIntelligenceAgent({
      userId: TEST_USER,
      goal: { question: "Gold regime?", symbol: "XAUUSD", timeframe: "1h" },
      runtime: rt,
    });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);

    const trace = await agentRunRepository.getRunTrace(final!.id);
    assert.deepEqual(trace.toolCalls.map((t) => t.toolId), ["market.snapshot", "market.intelligence"]);

    const out = final!.output as Record<string, unknown>;
    assert.equal(out.kind, "market-intelligence-conclusion");
    assert.equal(out.resolved, true);
    assert.equal(out.bias, "bullish-leaning", "relays the pipeline's own trending-bullish regime + bullish hypotheses");
    assert.equal(out.regimeType, "trending-bullish");
    assert.ok(Array.isArray(out.basis) && (out.basis as unknown[]).length > 0);
    assert.ok(Array.isArray(out.evidenceIds) && (out.evidenceIds as string[]).length === trace.evidence.length);

    // A6 integrity gate ran and PASSED before "succeeded"
    const evalStep = trace.steps.find((s) => s.kind === "evaluation");
    assert.ok(evalStep && (evalStep.output as { passed?: boolean }).passed === true, "integrity PASS");
    assert.ok((evalStep!.output as { lineage?: { complete?: boolean } }).lineage?.complete, "evidence lineage complete");

    // governance: decision support, NOT a signal
    const json = JSON.stringify(out).replace(JSON.stringify(out.disclaimer), '""');
    for (const k of Object.keys(out)) assert.ok(!FORBIDDEN_KEYS.includes(k.toLowerCase()), `key "${k}"`);
    for (const re of FORBIDDEN_TEXT) assert.ok(!re.test(json), `text ${re}`);
    assert.ok(typeof out.disclaimer === "string" && (out.disclaimer as string).includes("Decision support only"));

    // A10 evaluation persisted, structured
    const ev = await evaluation.getForRun(final!.id);
    assert.ok(ev, "A10 evaluation was written at the terminal transition");
    assert.equal(ev!.terminalStatus, "succeeded");
    assert.deepEqual(ev!.scores.map((s) => s.dimension).sort(), [...AGENT_EVALUATION_DIMENSIONS].sort());
    assert.equal(ev!.measurableSignals.specialist, "MARKET_INTELLIGENCE");
    console.log(`      -> ${out.symbol}: ${out.bias} (regime ${out.regimeType}), composite ${ev!.compositeScore}`);
  });

  await test("behavioural: the agent does NOT compute a second score/regime - it echoes envelope.regime.regimeType", async () => {
    const altCtx = {
      ...RESOLVED_CTX,
      envelope: { ...RESOLVED_CTX.envelope, regime: { ...RESOLVED_CTX.envelope.regime, regimeType: "trending-bearish" },
        hypotheses: [{ type: "momentum-bearish", statement: { claim: "momentum fading" } }] },
    };
    const { rt } = harness(fakeRegistry(altCtx));
    const final = await runMarketIntelligenceAgent({ userId: TEST_USER, goal: { symbol: "XAUUSD" }, runtime: rt });
    assert.equal(final?.status, "succeeded");
    const out = final!.output as Record<string, unknown>;
    // flip the pipeline's regime -> the conclusion flips with it (no independent classification)
    assert.equal(out.regimeType, "trending-bearish");
    assert.equal(out.bias, "bearish-leaning");
  });

  // ----------------------------------------------------------------
  // 4. graceful when the pipeline is unresolved
  // ----------------------------------------------------------------

  await test("E2E (fake, unresolved): insufficient-data -> neutral, resolved:false, honest reason, still A6 PASS", async () => {
    const { rt } = harness(fakeRegistry({ status: "insufficient-data", generatedAt: new Date().toISOString() }));
    const final = await runMarketIntelligenceAgent({ userId: TEST_USER, goal: { symbol: "XAUUSD" }, runtime: rt });
    assert.equal(final?.status, "succeeded", `status ${final?.status} / ${final?.errorCode}`);
    const out = final!.output as Record<string, unknown>;
    assert.equal(out.resolved, false);
    assert.equal(out.bias, "neutral");
    assert.ok(typeof out.reason === "string" && (out.reason as string).length > 0);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    const evalStep = trace.steps.find((s) => s.kind === "evaluation");
    assert.equal((evalStep!.output as { passed?: boolean }).passed, true, "an honest unresolved conclusion still passes A6");
  });

  // ----------------------------------------------------------------
  // 5. E2E on the REAL registry (best-effort)
  // ----------------------------------------------------------------

  await test("E2E (real registry): clean terminal state either way; MI plan executed; trace intact", async () => {
    const final = await runMarketIntelligenceAgent({
      userId: TEST_USER,
      goal: { question: "Analyze XAUUSD current regime", symbol: "XAUUSD" },
    });
    assert.ok(["succeeded", "tool_error"].includes(final!.status), `unexpected status ${final!.status} (${final!.errorCode})`);
    const trace = await agentRunRepository.getRunTrace(final!.id);
    const planStep = trace.steps.find((s) => s.kind === "plan");
    assert.ok(planStep, "a plan step was persisted");
    if (final!.status === "succeeded") {
      const out = final!.output as Record<string, unknown>;
      assert.equal(out.kind, "market-intelligence-conclusion");
      assert.ok(["bullish-leaning", "bearish-leaning", "neutral"].includes(out.bias as string));
      const json = JSON.stringify(out).replace(JSON.stringify(out.disclaimer), '""');
      for (const re of FORBIDDEN_TEXT) assert.ok(!re.test(json), `live output must not contain ${re}`);
      console.log(`      -> (live) ${out.symbol}: ${out.bias}${out.resolved ? ` (regime ${out.regimeType})` : " (unresolved)"}, ${trace.evidence.length} evidence`);
    } else {
      console.log(`      -> (live) provider unavailable -> clean ${final!.errorCode}; trace intact`);
    }
  });

  await cleanup();
  await prisma.$disconnect();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error("Validation script crashed:", err);
  try { await cleanup(); await prisma.$disconnect(); } catch { /* ignore */ }
  process.exit(1);
});
