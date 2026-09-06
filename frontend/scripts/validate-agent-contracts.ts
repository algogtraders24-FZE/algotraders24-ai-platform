// scripts/validate-agent-contracts.ts
// Sprint AN, step A1 - Agent Framework contract closure.
//
// Standalone validation for the declarative contract layer under
// types/agent-framework/ and the code registry under
// services/agent-framework/agent-type-registry.ts. Pure/in-memory only - no
// database, no network, no provider SDKs (same discipline as
// scripts/validate-decision-context.ts). Run via
// `npm run validate:agent-contracts`.
//
// A1 is CONTRACTS ONLY. This script also asserts, structurally, that no
// runtime behavior has leaked into the contract layer.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  AGENT_FRAMEWORK_CONTRACT_VERSION,
  // common
  contractOk,
  contractResult,
  isUnitInterval,
  isIsoTimestamp,
  // autonomy
  AUTONOMY_LEVELS,
  DEFAULT_AUTONOMY_LEVEL,
  MAX_CONFIGURABLE_AUTONOMY_V1,
  TRADING_DECISION_MAX_AUTONOMY_V1,
  LIVE_EXECUTION_MIN_AUTONOMY,
  isAutonomyLevel,
  canRunAtAutonomy,
  // permission
  PERMISSION_KEYS,
  DANGEROUS_PERMISSIONS,
  LIVE_EXECUTION_DEFAULT,
  evaluatePermission,
  validatePermissionPolicy,
  isPermissionKey,
  // evidence
  AGENT_EVIDENCE_TYPES,
  validateAgentEvidence,
  type AgentEvidence,
  // memory
  MEMORY_LAYERS,
  DEFAULT_MEMORY_POLICY,
  validateMemoryPolicy,
  isTableBackedLayer,
  // tool
  TOOL_CATEGORIES,
  validateToolDefinition,
  type ToolDefinition,
  // run
  AGENT_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  RUN_STATUS_TRANSITIONS,
  DEFAULT_RUN_LIMITS,
  isValidRunTransition,
  isTerminalRunStatus,
  validateRunTransition,
  validateRunLimits,
  // agent
  validateAgentDefinition,
  makeDefaultAgentDefinitionBase,
  type AgentDefinition,
} from "../types/agent-framework/index";

import {
  AGENT_TYPES,
  AGENT_TYPE_REGISTRY,
  LEGACY_AGENT_TYPE_ALIASES,
  isRegisteredAgentType,
  isKnownAgentType,
  resolveAgentType,
  autonomyCapForType,
} from "../services/agent-framework/agent-type-registry";

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
    console.error(err instanceof Error ? `    ${err.message}` : `    ${String(err)}`);
  }
}

// ------------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------------

const NOW = "2026-09-05T12:00:00.000Z";

function validDefinition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    ...makeDefaultAgentDefinitionBase(),
    id: "agt_1",
    slug: "gold-intraday-analyst",
    version: "1.0.0",
    name: "Gold Intraday Analyst",
    description: "Analyses current XAUUSD conditions.",
    type: "MARKET_INTELLIGENCE",
    status: "draft",
    objective: "Produce a decision-support brief for XAUUSD every session.",
    instructions: "Use only verified pipeline evidence. Never emit a BUY/SELL call.",
    modelPolicy: { preferred: "model-fast", fallback: ["model-strong"], allowed: ["model-fast", "model-strong"] },
    tools: [{ toolId: "market.intelligence" }, { toolId: "news.search" }],
    knowledgeSources: [],
    autonomyLevel: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const VALIDATION_OPTS = {
  isRegisteredType: isKnownAgentType,
  autonomyCapForType,
};

function validEvidence(overrides: Partial<AgentEvidence> = {}): AgentEvidence {
  return {
    id: "ev_1",
    runId: "run_1",
    stepId: "step_1",
    toolCallId: "tc_1",
    type: "market_data",
    claim: "XAUUSD last print 2611.4",
    source: "twelve-data",
    sourceId: "XAUUSD:5m",
    timestamp: NOW,
    data: { price: 2611.4 },
    relevance: 0.8,
    confidence: 0.9,
    provenance: { producer: "twelve-data", retrievedAt: NOW, pipelineVersion: "15D.12.0" },
    createdAt: NOW,
    ...overrides,
  };
}

function validTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: "market.intelligence",
    name: "Market Intelligence",
    description: "Runs the deterministic real-time intelligence orchestrator.",
    version: "1.0.0",
    category: "MARKET_DATA",
    inputSchema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] },
    outputSchema: { type: "object" },
    requiredPermissions: ["CAN_READ_MARKET_DATA"],
    autonomyFloor: 0,
    creditCost: { model: "flat", credits: 2 },
    status: "active",
    wraps: "services/intelligence/orchestration/real-time-intelligence.service.ts",
    ...overrides,
  };
}

// ------------------------------------------------------------------
// 1. Contract is versioned
// ------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Framework contract validation\n");

  await test("contract version is present and is AF-v1", () => {
    assert.equal(AGENT_FRAMEWORK_CONTRACT_VERSION, "AF-v1");
  });

  await test("AgentDefinition carries a version field and it is required", () => {
    const res = validateAgentDefinition(validDefinition({ version: "" }), VALIDATION_OPTS);
    assert.equal(res.valid, false);
    assert.ok(res.violations.some((x) => x.path === "version"));
  });

  await test("common helpers behave deterministically", () => {
    assert.equal(contractOk().valid, true);
    assert.equal(contractResult([{ path: "x", message: "y" }]).valid, false);
    assert.equal(isUnitInterval(0), true);
    assert.equal(isUnitInterval(1), true);
    assert.equal(isUnitInterval(1.0001), false);
    assert.equal(isUnitInterval(-0.1), false);
    assert.equal(isIsoTimestamp(NOW), true);
    assert.equal(isIsoTimestamp("not-a-date"), false);
  });

  // ----------------------------------------------------------------
  // 2. Agent types validated against the registry
  // ----------------------------------------------------------------

  await test("registry exposes exactly the 8 locked canonical types", () => {
    assert.deepEqual(
      [...AGENT_TYPES].sort(),
      [
        "BACKTEST_OPTIMIZATION",
        "MARKET_INTELLIGENCE",
        "NEWS_EVENT",
        "PORTFOLIO",
        "RESEARCH",
        "RISK",
        "STRATEGY_RESEARCH",
        "TRADING_DECISION",
      ],
    );
  });

  await test("every registry spec is internally consistent and v1-capped at autonomy <= 1", () => {
    for (const key of AGENT_TYPES) {
      const spec = AGENT_TYPE_REGISTRY[key];
      assert.equal(spec.key, key, `${key} spec.key mismatch`);
      assert.ok(spec.label.length > 0);
      assert.ok(spec.description.length > 0);
      assert.ok(spec.autonomyCap <= 1, `${key} autonomyCap must be <= 1 in v1`);
      assert.ok(spec.autonomyCap <= TRADING_DECISION_MAX_AUTONOMY_V1 + 0); // documents the cap source
      for (const perm of spec.defaultPermissions) {
        assert.ok(isPermissionKey(perm), `${key} has unknown default permission ${perm}`);
        assert.ok(
          !(DANGEROUS_PERMISSIONS as readonly string[]).includes(perm),
          `${key} must not seed a dangerous permission`,
        );
      }
    }
  });

  await test("RISK type is marked independentOfDecision", () => {
    assert.equal(AGENT_TYPE_REGISTRY.RISK.independentOfDecision, true);
  });

  await test("legacy aliases resolve to canonical keys; unknown legacy types do not", () => {
    assert.equal(resolveAgentType("market-analyst"), "MARKET_INTELLIGENCE");
    assert.equal(resolveAgentType("risk-manager"), "RISK");
    assert.equal(resolveAgentType("strategy-generator"), "STRATEGY_RESEARCH");
    assert.equal(resolveAgentType("MARKET_INTELLIGENCE"), "MARKET_INTELLIGENCE");
    // seo-writer / customer-support intentionally stay on the legacy layer
    assert.equal(resolveAgentType("seo-writer"), null);
    assert.equal(resolveAgentType("customer-support"), null);
    assert.equal(resolveAgentType("nonsense"), null);
    assert.equal(isRegisteredAgentType("market-analyst"), false);
    assert.equal(isKnownAgentType("market-analyst"), true);
    assert.equal(isKnownAgentType("nonsense"), false);
  });

  await test("every legacy alias target is a real canonical key", () => {
    for (const target of Object.values(LEGACY_AGENT_TYPE_ALIASES)) {
      assert.ok(isRegisteredAgentType(target), `alias target ${target} is not canonical`);
    }
  });

  await test("valid AgentDefinition passes; unknown type is rejected deterministically", () => {
    assert.equal(validateAgentDefinition(validDefinition(), VALIDATION_OPTS).valid, true);
    const bad = validateAgentDefinition(validDefinition({ type: "totally-made-up" }), VALIDATION_OPTS);
    assert.equal(bad.valid, false);
    assert.ok(bad.violations.some((x) => x.path === "type"));
    // determinism: same input, same output
    const again = validateAgentDefinition(validDefinition({ type: "totally-made-up" }), VALIDATION_OPTS);
    assert.deepEqual(bad, again);
  });

  // ----------------------------------------------------------------
  // 3. Tool contract
  // ----------------------------------------------------------------

  await test("tool categories are the 10 locked categories", () => {
    assert.deepEqual([...TOOL_CATEGORIES].sort(), [
      "BACKTEST",
      "EXECUTION",
      "INDICATORS",
      "MARKET_DATA",
      "NEWS",
      "PORTFOLIO",
      "QUANT_ENGINE",
      "RESEARCH",
      "RISK_ENGINE",
      "STRATEGY_LIBRARY",
    ]);
  });

  await test("valid ToolDefinition passes", () => {
    assert.equal(validateToolDefinition(validTool()).valid, true);
  });

  await test("ToolDefinition invalid states are rejected deterministically", () => {
    const cases: Array<[Partial<ToolDefinition>, string]> = [
      [{ id: "Market Intelligence" }, "id"],
      [{ category: "NONSENSE" as ToolDefinition["category"] }, "category"],
      [{ requiredPermissions: ["CAN_FLY" as never] }, "requiredPermissions"],
      [{ autonomyFloor: 9 as never }, "autonomyFloor"],
      [{ creditCost: { model: "flat", credits: -1 } }, "creditCost.credits"],
      [{ creditCost: { model: "estimated", estimatorId: "", ceiling: 0 } }, "creditCost.estimatorId"],
      [{ wraps: "" }, "wraps"],
    ];
    for (const [override, expectedPath] of cases) {
      const res = validateToolDefinition(validTool(override));
      assert.equal(res.valid, false, `expected invalid for ${JSON.stringify(override)}`);
      assert.ok(res.violations.some((x) => x.path === expectedPath), `expected violation at ${expectedPath}`);
    }
  });

  await test("EXECUTION-category tool must be autonomyFloor >= 3 and never active in v1", () => {
    const res = validateToolDefinition(
      validTool({ id: "execution.place_order", category: "EXECUTION", autonomyFloor: 0, status: "active", wraps: "n/a" }),
    );
    assert.equal(res.valid, false);
    assert.ok(res.violations.some((x) => x.path === "autonomyFloor"));
    assert.ok(res.violations.some((x) => x.path === "status"));

    const ok = validateToolDefinition(
      validTool({ id: "execution.place_order", category: "EXECUTION", autonomyFloor: 3, status: "disabled", wraps: "future" }),
    );
    assert.equal(ok.valid, true);
  });

  await test("Planner != Executor boundary types are all exported and distinct", () => {
    // structural: the three role types exist as named exports in tool-contract
    const src = readContractFile("tool-contract.ts");
    for (const t of ["PlannerToolRequest", "AuthorizedToolIntent", "ExecutorInvocation"]) {
      assert.ok(new RegExp(`export interface ${t}\\b`).test(src), `${t} must be an exported interface`);
    }
    // the planner request must NOT carry a handler / authority field
    const plannerBlock = src.slice(src.indexOf("interface PlannerToolRequest"), src.indexOf("interface AuthorizedToolIntent"));
    assert.ok(!/handler|authoriz|execute\(/i.test(plannerBlock), "PlannerToolRequest must carry no handler/authority");
  });

  // ----------------------------------------------------------------
  // 4. Run / state contract
  // ----------------------------------------------------------------

  await test("run status set includes every locked terminal + non-terminal state", () => {
    for (const s of [
      "queued", "planning", "running", "awaiting_approval", "succeeded",
      "failed", "timeout", "credit_limit", "step_limit", "tool_call_limit",
      "permission_denied", "tool_error", "model_error", "cancelled",
    ]) {
      assert.ok((AGENT_RUN_STATUSES as readonly string[]).includes(s), `missing run status ${s}`);
    }
  });

  await test("terminal statuses have no outgoing transitions", () => {
    for (const s of TERMINAL_RUN_STATUSES) {
      assert.deepEqual(RUN_STATUS_TRANSITIONS[s], [], `${s} must be a dead end`);
      assert.equal(isTerminalRunStatus(s), true);
    }
  });

  await test("run transitions are rejected deterministically", () => {
    assert.equal(isValidRunTransition("queued", "planning"), true);
    assert.equal(isValidRunTransition("planning", "running"), true);
    assert.equal(isValidRunTransition("running", "succeeded"), true);
    assert.equal(isValidRunTransition("queued", "succeeded"), false); // must plan first
    assert.equal(isValidRunTransition("succeeded", "running"), false); // terminal
    assert.equal(isValidRunTransition("running", "queued"), false); // no going back

    const bad = validateRunTransition("succeeded", "running");
    assert.equal(bad.valid, false);
    assert.ok(bad.violations[0].message.includes("terminal"));

    const unknown = validateRunTransition("weird" as never, "running");
    assert.equal(unknown.valid, false);

    assert.deepEqual(validateRunTransition("queued", "planning"), contractOk());
  });

  await test("every transition target is itself a known run status (table integrity)", () => {
    for (const [from, targets] of Object.entries(RUN_STATUS_TRANSITIONS)) {
      assert.ok((AGENT_RUN_STATUSES as readonly string[]).includes(from));
      for (const to of targets) {
        assert.ok((AGENT_RUN_STATUSES as readonly string[]).includes(to), `${from} -> ${to} target unknown`);
      }
    }
  });

  await test("default run limits are valid and every limit maps to a terminal status", () => {
    assert.equal(validateRunLimits(DEFAULT_RUN_LIMITS).valid, true);
    const bad = validateRunLimits({ ...DEFAULT_RUN_LIMITS, maxSteps: 0 });
    assert.equal(bad.valid, false);
  });

  // ----------------------------------------------------------------
  // 5. Evidence contract
  // ----------------------------------------------------------------

  await test("evidence types are the locked closed vocabulary", () => {
    assert.ok(AGENT_EVIDENCE_TYPES.length >= 8);
    assert.ok((AGENT_EVIDENCE_TYPES as readonly string[]).includes("web_result"));
    assert.ok((AGENT_EVIDENCE_TYPES as readonly string[]).includes("backtest"));
  });

  await test("valid evidence passes; out-of-range relevance/confidence rejected; provenance required", () => {
    assert.equal(validateAgentEvidence(validEvidence()).valid, true);
    assert.equal(validateAgentEvidence(validEvidence({ relevance: 1.5 })).valid, false);
    assert.equal(validateAgentEvidence(validEvidence({ confidence: -0.2 })).valid, false);
    const noProv = validateAgentEvidence(validEvidence({ provenance: undefined as never }));
    assert.equal(noProv.valid, false);
    assert.ok(noProv.violations.some((x) => x.path === "provenance"));
    const missingProducer = validateAgentEvidence(
      validEvidence({ provenance: { producer: "", retrievedAt: NOW } }),
    );
    assert.equal(missingProducer.valid, false);
    assert.ok(missingProducer.violations.some((x) => x.path === "provenance.producer"));
  });

  await test("evidence requires run + step linkage (traceability)", () => {
    assert.equal(validateAgentEvidence(validEvidence({ runId: "" })).valid, false);
    assert.equal(validateAgentEvidence(validEvidence({ stepId: "" })).valid, false);
  });

  // ----------------------------------------------------------------
  // 6. Memory contract
  // ----------------------------------------------------------------

  await test("memory layers include the 7 locked layers; RUN_STATE is not table-backed", () => {
    for (const l of [
      "SHORT_TERM", "RUN_STATE", "LONG_TERM", "USER_CONTEXT",
      "RESEARCH_MEMORY", "STRATEGY_MEMORY", "PERFORMANCE_MEMORY",
    ]) {
      assert.ok((MEMORY_LAYERS as readonly string[]).includes(l));
    }
    assert.equal(isTableBackedLayer("RUN_STATE"), false);
    assert.equal(isTableBackedLayer("LONG_TERM"), true);
  });

  await test("default memory policy is valid (short-term, run-scoped, own-read)", () => {
    assert.equal(validateMemoryPolicy(DEFAULT_MEMORY_POLICY).valid, true);
  });

  await test("memory policy invalid states rejected deterministically", () => {
    assert.equal(validateMemoryPolicy({ layers: ["NOPE" as never], retention: {}, readPolicy: {}, writePolicy: {} }).valid, false);
    // config for a layer not in `layers`
    const orphan = validateMemoryPolicy({
      layers: ["SHORT_TERM"],
      retention: { LONG_TERM: { mode: "persistent" } },
      readPolicy: {},
      writePolicy: {},
    });
    assert.equal(orphan.valid, false);
    assert.ok(orphan.violations.some((x) => x.path === "retention.LONG_TERM"));
    // RUN_STATE writable through the memory layer is rejected
    const runStateWrite = validateMemoryPolicy({
      layers: ["RUN_STATE"],
      retention: {},
      readPolicy: {},
      writePolicy: { RUN_STATE: "allow" },
    });
    assert.equal(runStateWrite.valid, false);
    assert.ok(runStateWrite.violations.some((x) => x.path === "writePolicy.RUN_STATE"));
  });

  // ----------------------------------------------------------------
  // 7. Permission + autonomy contracts
  // ----------------------------------------------------------------

  await test("permission keys are the 9 locked keys; live execution default is DENY", () => {
    assert.equal(PERMISSION_KEYS.length, 9);
    assert.equal(LIVE_EXECUTION_DEFAULT, "DENY");
    assert.deepEqual([...DANGEROUS_PERMISSIONS].sort(), ["CAN_CREATE_ORDER", "CAN_EXECUTE_ORDER"]);
  });

  await test("evaluatePermission is a pure allowlist check", () => {
    const policy = { granted: ["CAN_READ_MARKET_DATA", "CAN_USE_MEMORY"] as const };
    assert.deepEqual(evaluatePermission({ granted: [...policy.granted] }, ["CAN_READ_MARKET_DATA"]), {
      allowed: true,
      missing: [],
    });
    const denied = evaluatePermission({ granted: [...policy.granted] }, ["CAN_RUN_BACKTEST"]);
    assert.equal(denied.allowed, false);
    assert.deepEqual(denied.missing, ["CAN_RUN_BACKTEST"]);
  });

  await test("LIVE_EXECUTION = DENY: dangerous permissions rejected at the parser layer without BOTH gates", () => {
    const policy = { granted: ["CAN_EXECUTE_ORDER" as const] };
    // no context -> denied
    assert.equal(validatePermissionPolicy(policy).valid, false);
    // only env flag -> denied
    assert.equal(
      validatePermissionPolicy(policy, { liveExecutionEnabled: true, userAllowlisted: false }).valid,
      false,
    );
    // only allowlist -> denied
    assert.equal(
      validatePermissionPolicy(policy, { liveExecutionEnabled: false, userAllowlisted: true }).valid,
      false,
    );
    // BOTH -> allowed at parser layer (tool gate still applies later)
    assert.equal(
      validatePermissionPolicy(policy, { liveExecutionEnabled: true, userAllowlisted: true }).valid,
      true,
    );
  });

  await test("an AgentDefinition granting CAN_EXECUTE_ORDER cannot be saved by default", () => {
    const res = validateAgentDefinition(
      validDefinition({ permissionPolicy: { granted: ["CAN_EXECUTE_ORDER"] } }),
      VALIDATION_OPTS,
    );
    assert.equal(res.valid, false);
    assert.ok(res.violations.some((x) => x.path.startsWith("permissionPolicy.")));
  });

  await test("autonomy: default is 0, v1 config max is 2, live-execution floor is 3", () => {
    assert.equal(DEFAULT_AUTONOMY_LEVEL, 0);
    assert.equal(MAX_CONFIGURABLE_AUTONOMY_V1, 2);
    assert.equal(LIVE_EXECUTION_MIN_AUTONOMY, 3);
    assert.deepEqual([...AUTONOMY_LEVELS], [0, 1, 2, 3, 4]);
    assert.equal(isAutonomyLevel(2), true);
    assert.equal(isAutonomyLevel(5), false);
    assert.equal(canRunAtAutonomy(1, 0), true);
    assert.equal(canRunAtAutonomy(0, 1), false);
  });

  await test("AgentDefinition rejects autonomy above the v1 cap and above the registry type cap", () => {
    const overV1 = validateAgentDefinition(validDefinition({ autonomyLevel: 3 }), VALIDATION_OPTS);
    assert.equal(overV1.valid, false);
    assert.ok(overV1.violations.some((x) => x.path === "autonomyLevel"));

    // TRADING_DECISION cap is 1; asking for 2 must fail on the registry cap
    const overType = validateAgentDefinition(
      validDefinition({ type: "TRADING_DECISION", autonomyLevel: 2 }),
      VALIDATION_OPTS,
    );
    assert.equal(overType.valid, false);
    assert.ok(overType.violations.some((x) => x.path === "autonomyLevel"));
  });

  // ----------------------------------------------------------------
  // 8. AgentDefinition composite invalid-state coverage
  // ----------------------------------------------------------------

  await test("AgentDefinition invalid states each surface a pathed violation", () => {
    const cases: Array<[Partial<AgentDefinition>, string]> = [
      [{ slug: "Not A Slug" }, "slug"],
      [{ objective: "" }, "objective"],
      [{ instructions: "" }, "instructions"],
      [{ status: "live" as never }, "status"],
      [{ modelPolicy: { preferred: "x", fallback: [], allowed: [] } }, "modelPolicy.allowed"],
      [{ modelPolicy: { preferred: "x", fallback: ["y"], allowed: ["x"] } }, "modelPolicy.fallback"],
      [{ creditPolicy: { perRunCeiling: 10, perDayCeiling: 5, requireEstimateUnder: 10 } }, "creditPolicy.perRunCeiling"],
      [{ triggerPolicy: { manual: false, schedule: null, events: [] } }, "triggerPolicy"],
      [{ tools: [{ toolId: "market.snapshot" }, { toolId: "market.snapshot" }] }, "tools[1].toolId"],
      [{ outputSchema: null as never }, "outputSchema"],
    ];
    for (const [override, expectedPath] of cases) {
      const res = validateAgentDefinition(validDefinition(override), VALIDATION_OPTS);
      assert.equal(res.valid, false, `expected invalid for ${JSON.stringify(override)}`);
      assert.ok(
        res.violations.some((x) => x.path === expectedPath),
        `expected violation at "${expectedPath}", got ${JSON.stringify(res.violations.map((x) => x.path))}`,
      );
    }
  });

  await test("makeDefaultAgentDefinitionBase yields autonomy 0 + no permissions + short-term memory", () => {
    const base = makeDefaultAgentDefinitionBase();
    assert.equal(base.autonomyLevel, 0);
    assert.deepEqual(base.permissionPolicy.granted, []);
    assert.deepEqual(base.memoryPolicy.layers, ["SHORT_TERM"]);
    assert.equal(base.status, "draft");
  });

  // ----------------------------------------------------------------
  // 9. Structural: vendor-neutrality + no runtime implementation
  // ----------------------------------------------------------------

  await test("vendor-neutrality: no contract file names or imports a provider/vendor", () => {
    const banned = [
      "@google/genai", "openai", "@anthropic", "anthropic",
      "gemini", "claude", "deepseek", "ollama", "langchain", "langgraph",
      "@openai/agents",
    ];
    for (const file of contractFiles()) {
      const src = readContractFile(file).toLowerCase();
      for (const needle of banned) {
        assert.ok(!src.includes(needle.toLowerCase()), `${file} must not reference "${needle}"`);
      }
    }
  });

  await test("contract layer imports ONLY from within itself (relative ./ paths)", () => {
    for (const file of contractFiles()) {
      const src = readContractFile(file);
      const importLines = src.split("\n").filter((l) => /^\s*(import|export)\b.*\bfrom\s+["']/.test(l));
      for (const line of importLines) {
        const spec = line.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
        assert.ok(spec.startsWith("./"), `${file}: contract imports must be relative, found "${spec}"`);
      }
    }
  });

  await test("no runtime behavior in the contract layer (no I/O, no DB, no network, no scheduling)", () => {
    const banned = [
      "prisma", "PrismaClient", "@/lib/prisma",
      "fetch(", "XMLHttpRequest", "axios", "node-fetch",
      "process.env", "setTimeout(", "setInterval(", "node-cron",
      "@/services/", "next/server", "fs.readFile", "require(",
    ];
    for (const file of contractFiles()) {
      const src = readContractFile(file);
      for (const needle of banned) {
        assert.ok(!src.includes(needle), `${file} must not contain "${needle}" (A1 = contracts only)`);
      }
    }
  });

  await test("agent-type-registry is declarative: imports only type-level from the contract layer", () => {
    const src = readFileSync(join(agentFrameworkServiceDir(), "agent-type-registry.ts"), "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      const spec = line.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
      assert.ok(
        spec.startsWith("@/types/agent-framework/"),
        `agent-type-registry may only import from @/types/agent-framework/*, found "${spec}"`,
      );
      assert.ok(/import\s+type\b/.test(line), `agent-type-registry imports must be type-only, found: ${line.trim()}`);
    }
    for (const needle of ["prisma", "fetch(", "process.env", "@/services/", "setInterval("]) {
      assert.ok(!src.includes(needle), `agent-type-registry must not contain "${needle}"`);
    }
  });

  await test("only the 8 locked contract files + index + common exist under types/agent-framework", () => {
    const files = readdirSync(contractDir()).filter((f) => f.endsWith(".ts")).sort();
    assert.deepEqual(files, [
      "agent-contract.ts",
      "agent-run-contract.ts",
      "autonomy-contract.ts",
      "common.ts",
      "evidence-contract.ts",
      "index.ts",
      "memory-contract.ts",
      "permission-contract.ts",
      "tool-contract.ts",
    ]);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

// ------------------------------------------------------------------
// fs helpers
// ------------------------------------------------------------------

function contractDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "types", "agent-framework");
}
function agentFrameworkServiceDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "services", "agent-framework");
}
function contractFiles(): string[] {
  return readdirSync(contractDir()).filter((f) => f.endsWith(".ts"));
}
function readContractFile(name: string): string {
  return readFileSync(join(contractDir(), name), "utf8");
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
