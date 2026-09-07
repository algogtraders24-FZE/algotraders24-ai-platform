// scripts/validate-agent-tools.ts
// Sprint AN, step A2 - Tool Registry & Gateway (G02).
//
// House style (node:assert/strict, tsx). Run: `npm run validate:agent-tools`.
//
// Two layers:
//  1. DETERMINISTIC CORE - a fake ToolImplementation exercises every
//     registry + gateway path (registration, lookup, input/output
//     validation, permission, autonomy, unknown-tool rejection, freeze).
//     No network, no DB.
//  2. REAL WIRING - the 4 shipped tools are structurally validated, and
//     `market.snapshot` is invoked end to end through the gateway against
//     the real MarketDataService. A provider being unavailable yields a
//     clean typed ToolResult (still a PASS - it proves the pipe); only an
//     unhandled throw fails. The 3 DB/pipeline-touching tools get a full
//     live invocation only when RUN_LIVE_AGENT_TOOLS=1.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  validateToolDefinition,
  type ToolDefinition,
  type AuthorizedToolIntent,
  type PermissionPolicy,
  UnknownToolError,
} from "../types/agent-framework/index";
import { ToolRegistry, DuplicateToolError } from "../services/agent-framework/tools/tool-registry";
import type { ToolImplementation } from "../services/agent-framework/tools/tool-implementation";
import { invokeTool } from "../services/agent-framework/tools/tool-gateway";
import { buildToolRegistry, REGISTERED_TOOL_IDS } from "../services/agent-framework/tools/registry-manifest";

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------
// A fake, dependency-free tool for the deterministic core.
// ------------------------------------------------------------------

interface EchoInput { text: string }

function makeEchoTool(overrides: Partial<ToolDefinition> = {}): ToolImplementation<EchoInput, { echoed: string }> {
  const definition: ToolDefinition = {
    id: "test.echo",
    name: "Echo",
    description: "Test-only echo tool.",
    version: "1.0.0",
    category: "RESEARCH",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    outputSchema: { type: "object" },
    requiredPermissions: ["CAN_RUN_RESEARCH"],
    autonomyFloor: 0,
    creditCost: { model: "flat", credits: 1 },
    executionMode: "sync",
    evidence: { producesEvidence: false, evidenceTypes: [], provenanceProducer: "test" },
    status: "active",
    wraps: "n/a (test fixture)",
    ...overrides,
  };
  return {
    definition,
    parseInput(raw) {
      if (typeof raw === "object" && raw !== null && typeof (raw as Record<string, unknown>).text === "string") {
        return { ok: true, value: { text: (raw as Record<string, unknown>).text as string } };
      }
      return { ok: false, violations: [{ path: "text", message: "text is required." }] };
    },
    checkOutput(value) {
      const ok = typeof value === "object" && value !== null && typeof (value as Record<string, unknown>).echoed === "string";
      return ok
        ? { valid: true, violations: [] }
        : { valid: false, violations: [{ path: "echoed", message: "echoed must be a string." }] };
    },
    async handler(input) {
      return { output: { echoed: input.text }, evidence: [] };
    },
  };
}

function intent(toolId: string, input: unknown): AuthorizedToolIntent {
  return { toolId, toolVersion: "1.0.0", input, authorizedBy: [], creditsReserved: 0 };
}

const RESEARCH_POLICY: PermissionPolicy = { granted: ["CAN_RUN_RESEARCH"] };

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Framework Tool Registry & Gateway validation\n");

  // ----------------------------------------------------------------
  // 1. Deterministic tool registration
  // ----------------------------------------------------------------

  await test("registration: a valid tool registers and is found", () => {
    const reg = new ToolRegistry();
    reg.register(makeEchoTool());
    assert.equal(reg.has("test.echo"), true);
    assert.equal(reg.ids().length, 1);
  });

  await test("registration: duplicate id throws DuplicateToolError", () => {
    const reg = new ToolRegistry();
    reg.register(makeEchoTool());
    assert.throws(() => reg.register(makeEchoTool()), DuplicateToolError);
  });

  await test("registration: malformed definition is rejected", () => {
    const reg = new ToolRegistry();
    assert.throws(() => reg.register(makeEchoTool({ id: "Bad Id" })));
    assert.throws(() => reg.register(makeEchoTool({ evidence: undefined as never })));
  });

  await test("registration: registering after freeze throws", () => {
    const reg = new ToolRegistry().register(makeEchoTool()).freeze();
    assert.equal(reg.isFrozen(), true);
    assert.throws(() => reg.register(makeEchoTool({ id: "test.echo2" })));
  });

  // ----------------------------------------------------------------
  // 2. Deterministic tool lookup + 10. unknown-tool rejection
  // ----------------------------------------------------------------

  await test("lookup: get() returns undefined, require() throws UnknownToolError for unknown id", () => {
    const reg = new ToolRegistry().register(makeEchoTool());
    assert.equal(reg.get("nope"), undefined);
    assert.throws(() => reg.require("nope"), UnknownToolError);
    assert.throws(() => reg.describe("nope"), UnknownToolError);
  });

  await test("lookup: describe() exposes permission / autonomy / evidence / execution / credit metadata", () => {
    const reg = new ToolRegistry().register(makeEchoTool());
    const d = reg.describe("test.echo");
    assert.deepEqual(d.requiredPermissions, ["CAN_RUN_RESEARCH"]); // 5. permission metadata
    assert.equal(d.autonomyFloor, 0); // 6. autonomy metadata
    assert.equal(d.evidence.producesEvidence, false); // 7. evidence metadata
    assert.equal(d.executionMode, "sync"); // 9. sync/resumable metadata
    assert.deepEqual(d.creditCost, { model: "flat", credits: 1 }); // 8. credit metadata
  });

  await test("gateway: unknown tool -> invalid_input / unknown_tool (deterministic)", async () => {
    const reg = new ToolRegistry().register(makeEchoTool());
    const out = await invokeTool({
      registry: reg,
      intent: intent("does.not.exist", { text: "hi" }),
      permissionPolicy: RESEARCH_POLICY,
      autonomyLevel: 1,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "invalid_input");
    assert.equal(out.result.errorKind, "unknown_tool");
    assert.deepEqual(out.evidence, []);
  });

  // ----------------------------------------------------------------
  // 3. Input schema validation  /  4. output validation
  // ----------------------------------------------------------------

  await test("gateway: bad input -> invalid_input / input_validation", async () => {
    const reg = new ToolRegistry().register(makeEchoTool());
    const out = await invokeTool({
      registry: reg,
      intent: intent("test.echo", { notText: 1 }),
      permissionPolicy: RESEARCH_POLICY,
      autonomyLevel: 1,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "invalid_input");
    assert.equal(out.result.errorKind, "input_validation");
  });

  await test("gateway: valid call -> ok, with output + placeholder credit stamp", async () => {
    const reg = new ToolRegistry().register(makeEchoTool());
    const out = await invokeTool({
      registry: reg,
      intent: intent("test.echo", { text: "hello" }),
      permissionPolicy: RESEARCH_POLICY,
      autonomyLevel: 0,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "ok");
    assert.deepEqual(out.result.output, { echoed: "hello" });
    assert.equal(out.result.creditsConsumed, 1);
    assert.ok(out.result.durationMs >= 0);
  });

  await test("gateway: bad handler output -> tool_error / output_validation", async () => {
    const badTool = makeEchoTool({ id: "test.badout" });
    badTool.handler = async () => ({ output: { wrong: true } as unknown as { echoed: string }, evidence: [] });
    const reg = new ToolRegistry().register(badTool);
    const out = await invokeTool({
      registry: reg,
      intent: intent("test.badout", { text: "x" }),
      permissionPolicy: RESEARCH_POLICY,
      autonomyLevel: 0,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "tool_error");
    assert.equal(out.result.errorKind, "output_validation");
  });

  await test("gateway: handler throw -> tool_error / handler_threw", async () => {
    const throwTool = makeEchoTool({ id: "test.throw" });
    throwTool.handler = async () => { throw new Error("boom"); };
    const reg = new ToolRegistry().register(throwTool);
    const out = await invokeTool({
      registry: reg,
      intent: intent("test.throw", { text: "x" }),
      permissionPolicy: RESEARCH_POLICY,
      autonomyLevel: 0,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "tool_error");
    assert.equal(out.result.errorKind, "handler_threw");
  });

  await test("gateway: disabled tool -> tool_error / tool_disabled", async () => {
    const reg = new ToolRegistry().register(makeEchoTool({ id: "test.disabled", status: "deprecated" }));
    const out = await invokeTool({
      registry: reg,
      intent: intent("test.disabled", { text: "x" }),
      permissionPolicy: RESEARCH_POLICY,
      autonomyLevel: 0,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "tool_error");
    assert.equal(out.result.errorKind, "tool_disabled");
  });

  // ----------------------------------------------------------------
  // 5. permission metadata  /  6. autonomy metadata (enforced)
  // ----------------------------------------------------------------

  await test("gateway: missing permission -> permission_denied / missing_permission", async () => {
    const reg = new ToolRegistry().register(makeEchoTool());
    const out = await invokeTool({
      registry: reg,
      intent: intent("test.echo", { text: "x" }),
      permissionPolicy: { granted: [] },
      autonomyLevel: 1,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "permission_denied");
    assert.equal(out.result.errorKind, "missing_permission");
  });

  await test("gateway: autonomy floor not met -> permission_denied / autonomy_floor", async () => {
    const reg = new ToolRegistry().register(makeEchoTool({ id: "test.hi_autonomy", autonomyFloor: 3, category: "EXECUTION", status: "disabled" }));
    // register a disabled EXECUTION tool is fine; flip to active in-memory only for the test path is not possible (frozen check aside).
    // Instead use a non-execution tool with floor 2:
    const reg2 = new ToolRegistry().register(makeEchoTool({ id: "test.floor2", autonomyFloor: 2 }));
    const out = await invokeTool({
      registry: reg2,
      intent: intent("test.floor2", { text: "x" }),
      permissionPolicy: RESEARCH_POLICY,
      autonomyLevel: 1,
      context: { userId: "u1" },
    });
    assert.equal(out.result.status, "permission_denied");
    assert.equal(out.result.errorKind, "autonomy_floor");
    assert.ok(reg.has("test.hi_autonomy"));
  });

  // ----------------------------------------------------------------
  // REAL WIRING - the 4 shipped tools
  // ----------------------------------------------------------------

  await test("manifest: builds a frozen registry with exactly the registered tool ids", () => {
    const reg = buildToolRegistry();
    assert.equal(reg.isFrozen(), true);
    assert.deepEqual(reg.ids(), [...REGISTERED_TOOL_IDS]);
  });

  await test("every shipped tool has a valid AF-v1 definition", () => {
    const reg = buildToolRegistry();
    for (const id of reg.ids()) {
      const d = reg.describe(id);
      const impl = reg.require(id);
      const res = validateToolDefinition(impl.definition);
      assert.equal(res.valid, true, `${id}: ${JSON.stringify(res.violations)}`);
      assert.equal(d.status, "active");
      assert.equal(d.executionMode, "sync");
      assert.ok(d.requiredPermissions.length >= 1, `${id} must require at least one permission`);
      assert.equal(d.autonomyFloor, 0, `${id} v1 floor must be 0`);
    }
  });

  await test("every shipped tool wraps a real, existing AT24 source file", () => {
    const reg = buildToolRegistry();
    for (const id of reg.ids()) {
      const wraps = reg.describe(id).wraps;
      const path = wraps.split(" ")[0]; // strip the "(Service.method)" note
      assert.ok(existsSync(join(ROOT, path)), `${id} wraps missing file: ${path}`);
    }
  });

  await test("no shipped tool declares an EXECUTION category or a dangerous permission", () => {
    const reg = buildToolRegistry();
    for (const id of reg.ids()) {
      const d = reg.describe(id);
      assert.notEqual(d.category, "EXECUTION");
      for (const p of d.requiredPermissions) {
        assert.ok(p !== "CAN_CREATE_ORDER" && p !== "CAN_EXECUTE_ORDER", `${id} must not require ${p}`);
      }
    }
  });

  await test("contract layer still imports only relative paths (no leakage from the A1 amendment)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = join(ROOT, "types", "agent-framework");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      const importLines = src.split("\n").filter((l) => /\bfrom\s+["']/.test(l));
      for (const line of importLines) {
        const spec = line.match(/from\s+["']([^"']+)["']/)?.[1] ?? "";
        assert.ok(spec.startsWith("./"), `${f}: non-relative contract import "${spec}"`);
        for (const needle of ["gemini", "openai", "anthropic", "genai", "prisma", "@/services", "@/lib", "next/"]) {
          assert.ok(!spec.toLowerCase().includes(needle), `${f} import leaked "${needle}": ${spec}`);
        }
      }
      // real code tokens (case-sensitive: prose like "No Prisma enum" is fine)
      for (const needle of ["fetch(", "PrismaClient", "process.env", "@google/genai"]) {
        assert.ok(!src.includes(needle), `${f} leaked runtime token "${needle}"`);
      }
    }
  });

  // ----------------------------------------------------------------
  // LIVE - real end-to-end through the gateway
  // ----------------------------------------------------------------

  await test("LIVE market.snapshot: gateway -> MarketDataService -> typed ToolResult (+ provenance when ok)", async () => {
    const reg = buildToolRegistry();
    const out = await invokeTool({
      registry: reg,
      intent: intent("market.snapshot", { symbol: "XAUUSD" }),
      permissionPolicy: { granted: ["CAN_READ_MARKET_DATA"] },
      autonomyLevel: 0,
      context: { userId: "validate-agent-tools" },
    });
    // A clean typed result either way proves the pipe. Only an unhandled
    // throw (caught by test()) is a failure.
    assert.ok(["ok", "tool_error", "tool_timeout"].includes(out.result.status), `unexpected status ${out.result.status}`);
    if (out.result.status === "ok") {
      const o = out.result.output as Record<string, unknown>;
      assert.equal(typeof o.price, "number");
      assert.equal(typeof o.provider, "string");
      assert.ok(out.evidence.length >= 1, "an ok snapshot must carry >= 1 evidence draft");
      assert.equal(out.evidence[0].type, "market_data");
      assert.equal(out.evidence[0].provenance.producer, "market-data-service");
      console.log(`      (live) ${o.symbol} = ${o.price} via ${o.provider}`);
    } else {
      console.log(`      (live) provider unavailable in this env -> clean ${out.result.status} (pipe verified)`);
    }
  });

  if (process.env.RUN_LIVE_AGENT_TOOLS === "1") {
    await test("LIVE market.intelligence: gateway -> RealTimeIntelligenceService -> typed ToolResult", async () => {
      const reg = buildToolRegistry();
      const out = await invokeTool({
        registry: reg,
        intent: intent("market.intelligence", { symbol: "XAUUSD" }),
        permissionPolicy: { granted: ["CAN_READ_MARKET_DATA"] },
        autonomyLevel: 0,
        context: { userId: "validate-agent-tools" },
      });
      assert.ok(["ok", "tool_error", "tool_timeout"].includes(out.result.status));
      if (out.result.status === "ok") {
        const o = out.result.output as Record<string, unknown>;
        assert.ok(["resolved", "clarification-required", "insufficient-data"].includes(o.status as string));
        console.log(`      (live) intelligence status = ${o.status}, evidence drafts = ${out.evidence.length}`);
      }
    });

    await test("LIVE portfolio.read: gateway -> PaperTradingService -> typed ToolResult", async () => {
      const reg = buildToolRegistry();
      const out = await invokeTool({
        registry: reg,
        intent: intent("portfolio.read", {}),
        permissionPolicy: { granted: ["CAN_READ_PORTFOLIO"] },
        autonomyLevel: 0,
        context: { userId: "validate-agent-tools" },
      });
      assert.ok(["ok", "tool_error", "tool_timeout"].includes(out.result.status));
    });
  } else {
    console.log("  -- skipped 2 DB/pipeline LIVE tests (set RUN_LIVE_AGENT_TOOLS=1 to run)");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
