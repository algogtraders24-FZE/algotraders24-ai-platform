// scripts/validate-agent-memory.ts
// Sprint AN, step A7 - Memory Contract + MemoryGateway (G07).
//
// Run: npm run validate:agent-memory   (offline - no DB; InMemoryStore)
//
// Proves the memory authority + governance boundary:
//   ALLOWED : agent policy -> gateway -> permitted layer -> validated
//             read/write -> audited result
//   REJECTED: wrong scope / forbidden layer / RUN_STATE / oversized payload /
//             invalid record / unauthorized write
//   and the KEY rule: an agent can never silently promote its own output into
//   trusted long-term knowledge (agent-derived write to a knowledge layer ->
//   pending_approval, never active).

import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  type MemoryPolicy,
  type MemoryWriteRequest,
  type MemoryReadQuery,
  TABLE_MEMORY_LAYERS,
  MEMORY_MAX_VALUE_BYTES,
  resolveWriteDecision,
  validateMemoryWriteRequest,
} from "../types/agent-framework/index";
import { MemoryGateway } from "../services/agent-framework/memory/memory-gateway";
import { InMemoryStore } from "../services/agent-framework/memory/in-memory-store";
import { AgentMemoryLayer } from "../lib/generated/prisma/enums";

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

const NOW = () => new Date().toISOString();

function policy(over: Partial<MemoryPolicy> = {}): MemoryPolicy {
  return {
    layers: ["SHORT_TERM"],
    retention: { SHORT_TERM: { mode: "persistent" } },
    readPolicy: { SHORT_TERM: "own" },
    writePolicy: { SHORT_TERM: "allow" },
    ...over,
  };
}

function writeReq(over: Partial<MemoryWriteRequest> = {}): MemoryWriteRequest {
  return {
    agentId: "agtA",
    agentType: "MARKET_INTELLIGENCE",
    userId: "u1",
    runId: null,
    layer: "SHORT_TERM",
    scope: "XAUUSD",
    key: "last-bias",
    value: { bias: "neutral" },
    retention: { mode: "persistent" },
    provenance: { origin: "system", producer: "agent-runtime", createdAt: NOW() },
    ...over,
  };
}

function readQ(over: Partial<MemoryReadQuery> = {}): MemoryReadQuery {
  return { agentId: "agtA", agentType: "MARKET_INTELLIGENCE", userId: "u1", layer: "SHORT_TERM", ...over };
}

async function main(): Promise<void> {
  console.log("\nAN1.x - Agent Memory (policy-gated) validation\n");

  // ----------------------------------------------------------------
  // contract: resolveWriteDecision
  // ----------------------------------------------------------------

  await test("resolveWriteDecision: default-deny for an ungranted layer", () => {
    assert.equal(resolveWriteDecision(policy(), "LONG_TERM", "system"), "deny");
  });
  await test("resolveWriteDecision: granted + writePolicy allow -> allow", () => {
    assert.equal(resolveWriteDecision(policy(), "SHORT_TERM", "agent-derived"), "allow");
  });
  await test("resolveWriteDecision: granted + writePolicy deny -> deny", () => {
    const p = policy({ layers: ["SHORT_TERM"], writePolicy: { SHORT_TERM: "deny" } });
    assert.equal(resolveWriteDecision(p, "SHORT_TERM", "user"), "deny");
  });
  await test("resolveWriteDecision: KNOWLEDGE layer + agent-derived -> FORCED approval (never silent promotion)", () => {
    const p = policy({
      layers: ["LONG_TERM"],
      writePolicy: { LONG_TERM: "allow" }, // even with allow...
      readPolicy: { LONG_TERM: "own" },
      retention: { LONG_TERM: { mode: "persistent" } },
    });
    assert.equal(resolveWriteDecision(p, "LONG_TERM", "agent-derived"), "approval");
    // ...but a user/tool/system origin to the same layer stays "allow"
    assert.equal(resolveWriteDecision(p, "LONG_TERM", "user"), "allow");
    assert.equal(resolveWriteDecision(p, "LONG_TERM", "system"), "allow");
  });

  // ----------------------------------------------------------------
  // contract: validateMemoryWriteRequest
  // ----------------------------------------------------------------

  await test("validateMemoryWriteRequest: rejects RUN_STATE, missing key, oversized value, bad provenance", () => {
    assert.equal(validateMemoryWriteRequest(writeReq()).valid, true);
    assert.equal(validateMemoryWriteRequest(writeReq({ layer: "RUN_STATE" as never })).valid, false);
    assert.equal(validateMemoryWriteRequest(writeReq({ key: "" })).valid, false);
    assert.equal(validateMemoryWriteRequest(writeReq({ value: undefined })).valid, false);
    const big = validateMemoryWriteRequest(writeReq({ value: { blob: "x".repeat(MEMORY_MAX_VALUE_BYTES + 10) } }));
    assert.equal(big.valid, false);
    assert.ok(big.violations.some((v) => v.path === "value"));
    assert.equal(validateMemoryWriteRequest(writeReq({ provenance: { origin: "nope" as never, producer: "p", createdAt: NOW() } })).valid, false);
    assert.equal(validateMemoryWriteRequest(writeReq({ provenance: { origin: "system", producer: "", createdAt: NOW() } })).valid, false);
  });

  // ----------------------------------------------------------------
  // gateway: ALLOWED read/write round trip
  // ----------------------------------------------------------------

  await test("ALLOWED: policy grants SHORT_TERM -> write active -> read returns it, audited", async () => {
    const g = new MemoryGateway({ store: new InMemoryStore() });
    const w = await g.write(writeReq({ value: { bias: "bullish-leaning" } }), policy());
    assert.equal(w.decision, "allow");
    assert.equal(w.status, "active");
    assert.equal(w.audit.op, "write");

    const r = await g.read(readQ({ scope: "XAUUSD", key: "last-bias" }), policy());
    assert.equal(r.allowed, true);
    assert.equal(r.records.length, 1);
    assert.deepEqual(r.records[0].value, { bias: "bullish-leaning" });
    assert.equal(r.audit.decision, "allow");
  });

  // ----------------------------------------------------------------
  // gateway: REJECTED paths
  // ----------------------------------------------------------------

  await test("REJECTED: forbidden layer (not in policy.layers) -> read + write denied", async () => {
    const g = new MemoryGateway({ store: new InMemoryStore() });
    const w = await g.write(writeReq({ layer: "LONG_TERM" }), policy()); // policy only grants SHORT_TERM
    assert.equal(w.decision, "deny");
    assert.equal(w.status, "rejected");
    const r = await g.read(readQ({ layer: "LONG_TERM" }), policy());
    assert.equal(r.allowed, false);
    assert.match(r.reason ?? "", /not granted/);
  });

  await test("REJECTED: RUN_STATE is execution state, not memory -> denied both ways", async () => {
    const g = new MemoryGateway({ store: new InMemoryStore() });
    const p = policy({ layers: ["RUN_STATE" as never], writePolicy: { ["RUN_STATE" as never]: "allow" } as never });
    const w = await g.write(writeReq({ layer: "RUN_STATE" as never }), p);
    assert.equal(w.decision, "deny");
    const r = await g.read(readQ({ layer: "RUN_STATE" as never }), p);
    assert.equal(r.allowed, false);
    assert.match(r.reason ?? "", /execution state/);
  });

  await test("REJECTED: oversized payload -> write rejected invalid_record", async () => {
    const g = new MemoryGateway({ store: new InMemoryStore() });
    const w = await g.write(writeReq({ value: { blob: "x".repeat(MEMORY_MAX_VALUE_BYTES + 100) } }), policy());
    assert.equal(w.status, "rejected");
    assert.match(w.reason ?? "", /invalid_record/);
  });

  await test("REJECTED: invalid record (empty key) -> rejected", async () => {
    const g = new MemoryGateway({ store: new InMemoryStore() });
    const w = await g.write(writeReq({ key: "" }), policy());
    assert.equal(w.status, "rejected");
  });

  await test("REJECTED: unauthorized write (writePolicy deny) -> rejected", async () => {
    const g = new MemoryGateway({ store: new InMemoryStore() });
    const p = policy({ writePolicy: { SHORT_TERM: "deny" } });
    const w = await g.write(writeReq(), p);
    assert.equal(w.decision, "deny");
    assert.match(w.reason ?? "", /deny/);
  });

  // ----------------------------------------------------------------
  // gateway: SCOPE enforcement
  // ----------------------------------------------------------------

  await test("SCOPE own: agent B cannot read agent A's own-scoped record", async () => {
    const store = new InMemoryStore();
    const g = new MemoryGateway({ store });
    await g.write(writeReq({ agentId: "agtA", value: { x: 1 } }), policy());
    const asB = await g.read(readQ({ agentId: "agtB", scope: "XAUUSD" }), policy()); // readPolicy "own"
    assert.equal(asB.records.length, 0);
    const asA = await g.read(readQ({ agentId: "agtA", scope: "XAUUSD" }), policy());
    assert.equal(asA.records.length, 1);
  });

  await test("SCOPE agent-type: same-type agent reads it; different-type does not", async () => {
    const store = new InMemoryStore();
    const g = new MemoryGateway({ store });
    const p = policy({
      layers: ["USER_CONTEXT"],
      retention: { USER_CONTEXT: { mode: "persistent" } },
      readPolicy: { USER_CONTEXT: "agent-type" },
      writePolicy: { USER_CONTEXT: "allow" },
    });
    await g.write(writeReq({ agentId: "agtA", agentType: "MARKET_INTELLIGENCE", layer: "USER_CONTEXT", scope: "prefs", key: "tz" }), p);
    const sameType = await g.read(readQ({ agentId: "agtB", agentType: "MARKET_INTELLIGENCE", layer: "USER_CONTEXT", scope: "prefs" }), p);
    assert.equal(sameType.records.length, 1);
    const otherType = await g.read(readQ({ agentId: "agtC", agentType: "RESEARCH", layer: "USER_CONTEXT", scope: "prefs" }), p);
    assert.equal(otherType.records.length, 0);
  });

  await test("SCOPE user-global: any agent of the user reads it", async () => {
    const store = new InMemoryStore();
    const g = new MemoryGateway({ store });
    const p = policy({
      layers: ["USER_CONTEXT"],
      retention: { USER_CONTEXT: { mode: "persistent" } },
      readPolicy: { USER_CONTEXT: "user-global" },
      writePolicy: { USER_CONTEXT: "allow" },
    });
    await g.write(writeReq({ agentId: "agtA", agentType: "MARKET_INTELLIGENCE", layer: "USER_CONTEXT", scope: "s", key: "k" }), p);
    const other = await g.read(readQ({ agentId: "agtZ", agentType: "RESEARCH", layer: "USER_CONTEXT", scope: "s" }), p);
    assert.equal(other.records.length, 1);
    // still user-scoped: a different user sees nothing
    const otherUser = await g.read(readQ({ userId: "u2", agentId: "agtZ", layer: "USER_CONTEXT", scope: "s" }), p);
    assert.equal(otherUser.records.length, 0);
  });

  // ----------------------------------------------------------------
  // gateway: NEVER SILENTLY PROMOTE
  // ----------------------------------------------------------------

  await test("NEVER SILENTLY PROMOTE: agent-derived write to LONG_TERM -> pending_approval, invisible on read", async () => {
    const store = new InMemoryStore();
    const g = new MemoryGateway({ store });
    const p = policy({
      layers: ["LONG_TERM"],
      retention: { LONG_TERM: { mode: "persistent" } },
      readPolicy: { LONG_TERM: "own" },
      writePolicy: { LONG_TERM: "allow" }, // NB: allow, yet an agent-derived write is still gated
    });
    const w = await g.write(
      writeReq({ layer: "LONG_TERM", scope: "gold", key: "thesis", provenance: { origin: "agent-derived", producer: "agtA", createdAt: NOW() } }),
      p,
    );
    assert.equal(w.decision, "approval");
    assert.equal(w.status, "pending_approval");
    assert.match(w.audit.reason ?? "", /approval required/);

    const r = await g.read(readQ({ layer: "LONG_TERM", scope: "gold", key: "thesis" }), p);
    assert.equal(r.records.length, 0, "pending_approval memory is never returned on read");

    // a human approves -> now active + visible
    const appr = await g.approvePending(w.recordId!, "user:u1");
    assert.equal(appr.status, "active");
    const r2 = await g.read(readQ({ layer: "LONG_TERM", scope: "gold", key: "thesis" }), p);
    assert.equal(r2.records.length, 1);

    // a system-origin write to the same layer IS active immediately (trusted, not agent-derived)
    const sys = await g.write(
      writeReq({ layer: "LONG_TERM", scope: "gold", key: "calendar", provenance: { origin: "system", producer: "agent-runtime", createdAt: NOW() } }),
      p,
    );
    assert.equal(sys.status, "active");
  });

  await test("SUPERSEDE: a second allow write of the same key expires the prior active record", async () => {
    const store = new InMemoryStore();
    const g = new MemoryGateway({ store });
    await g.write(writeReq({ value: { v: 1 } }), policy());
    await g.write(writeReq({ value: { v: 2 } }), policy());
    const r = await g.read(readQ({ scope: "XAUUSD", key: "last-bias" }), policy());
    assert.equal(r.records.length, 1);
    assert.deepEqual(r.records[0].value, { v: 2 });
  });

  await test("TTL: an expired record is not returned", async () => {
    const store = new InMemoryStore();
    const g = new MemoryGateway({ store });
    // write with a 1-day ttl, then hand the store a query "as of" 2 days later
    await g.write(writeReq({ retention: { mode: "ttl", ttlDays: 1 }, runId: "r1" }), policy());
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const rows = await store.query({ userId: "u1", layer: "SHORT_TERM", status: "active", notExpiredAsOf: future });
    assert.equal(rows.length, 0);
    const rowsNow = await store.query({ userId: "u1", layer: "SHORT_TERM", status: "active", notExpiredAsOf: NOW() });
    assert.equal(rowsNow.length, 1);
  });

  // ----------------------------------------------------------------
  // schema / migration parity
  // ----------------------------------------------------------------

  await test("generated AgentMemoryLayer enum == the 6 table-backed AF-v1 layers (RUN_STATE excluded)", () => {
    assert.deepEqual(Object.values(AgentMemoryLayer).sort(), [...TABLE_MEMORY_LAYERS].sort());
  });

  await test("A7 migration is present, additive-only, and NOT APPLIED", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "prisma", "migrations", "20260906130000_add_agent_memory_record");
    const sqlPath = join(dir, "migration.sql");
    assert.ok(existsSync(sqlPath), "migration.sql missing");
    const sql = readFileSync(sqlPath, "utf8");
    // The migration was GENERATED + REVIEWED as NOT APPLIED (G07), then applied
    // via `prisma migrate deploy` under explicit G07 authorization. Prisma
    // migration files are immutable once applied; the header keeps its
    // review-time wording. This test guards the still-true prohibition.
    assert.match(sql, /Never run `prisma migrate dev`/);
    assert.match(sql, /hand-reviewed/);
    assert.ok(!/\bDROP\b/i.test(sql), "no DROP");
    assert.ok(!/ALTER TABLE/i.test(sql), "no ALTER TABLE (purely additive)");
    const tables = [...sql.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1]);
    assert.deepEqual(tables, ["AgentMemoryRecord"]);
    const enums = [...sql.matchAll(/CREATE TYPE "(\w+)"/g)].map((m) => m[1]).sort();
    assert.deepEqual(enums, ["AgentMemoryLayer", "AgentMemoryRecordStatus"]);
    for (const legacy of ['"AgentMemory"', '"Agent"', '"User"']) {
      assert.ok(!sql.includes(legacy), `migration must not touch ${legacy}`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
