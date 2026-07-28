// scripts/validate-reasoning-engine.ts
// Sprint 15D.5 - Standalone validation for the Reasoning Intelligence
// Engine (ReasoningEngineService). No test framework exists in this
// project; run via `npm run validate:reasoning-engine`.
//
// Pure Node, no DB, no network, no AI call, no clock/randomness
// dependency - every timestamp is a literal fixture. Bundles are built
// with the real, unmodified Sprint 15D.4 EvidenceRankingService, so this
// also exercises the actual EvidenceBundle contract end to end, not a
// hand-rolled stand-in for it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { EvidenceItem } from "../types/evidence";
import { EvidenceRankingService } from "../services/ai/evidence/evidence-ranking.service";
import { ReasoningEngineService } from "../services/ai/reasoning/reasoning-engine.service";

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

const T1 = "2026-01-01T00:00:00.000Z"; // generatedAt reference point
const FRESH = "2026-01-01T00:00:00.000Z"; // 0 min old
const STALE_HEAVY = "2025-12-31T22:00:00.000Z"; // 120 min old

const ranking = new EvidenceRankingService();
const engine = new ReasoningEngineService();

function item(overrides: Partial<EvidenceItem>): EvidenceItem {
  return {
    type: "price",
    symbol: "XAUUSD",
    claim: "Spot price: 2685.4000 USD",
    source: "provider-a",
    asOf: FRESH,
    retrievedAt: FRESH,
    ...overrides,
  };
}

function main(): void {
  // ---------------------------------------------------------------------
  // Consumes the real Sprint 15D.4 EvidenceBundle contract
  // ---------------------------------------------------------------------
  test("consumes a real EvidenceBundle produced by the unmodified EvidenceRankingService", () => {
    const bundle = ranking.buildBundle("XAUUSD", [item({ source: "a" })], T1);
    const result = engine.reason(bundle);
    assert.equal(result.symbol, "XAUUSD");
    assert.equal(result.generatedAt, T1);
  });

  // ---------------------------------------------------------------------
  // Determinism
  // ---------------------------------------------------------------------
  test("determinism: reason() produces byte-identical output across two calls on the same bundle", () => {
    const bundle = ranking.buildBundle(
      "XAUUSD",
      [item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2700.0 })],
      T1,
    );
    const first = engine.reason(bundle);
    const second = engine.reason(bundle);
    assert.deepEqual(first, second);
  });

  // ---------------------------------------------------------------------
  // Conflict detection / classification
  // ---------------------------------------------------------------------
  test("conflict: a symmetric 2-item disagreement has no determinable majority - both unresolved, neither supporting nor opposing", () => {
    const bundle = ranking.buildBundle(
      "XAUUSD",
      [item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2700.0 })],
      T1,
    );
    const result = engine.reason(bundle);
    assert.equal(result.supportingEvidence.length, 0);
    assert.equal(result.opposingEvidence.length, 0);
    assert.equal(result.unresolvedItems.length, 2);
    assert.equal(result.conflicts.length, 1);
  });

  test("conflict: a 2-against-1 split within a type produces a determinable majority (supporting) and minority (opposing)", () => {
    const bundle = ranking.buildBundle(
      "XAUUSD",
      [
        item({ source: "a", magnitude: 2685.4 }),
        item({ source: "b", magnitude: 2685.42 }), // agrees with a
        item({ source: "c", magnitude: 2750.0 }), // disagrees with both
      ],
      T1,
    );
    const result = engine.reason(bundle);
    assert.equal(result.supportingEvidence.length, 2);
    assert.equal(result.opposingEvidence.length, 1);
    assert.equal(result.opposingEvidence[0].source, "c");
    assert.equal(result.unresolvedItems.length, 0);
  });

  test("conflict: no disagreement at all - a single item and a fully-agreeing pair are both entirely supporting", () => {
    const bundle = ranking.buildBundle(
      "XAUUSD",
      [item({ source: "a", magnitude: 2685.4 }), item({ source: "b", magnitude: 2685.41 })],
      T1,
    );
    const result = engine.reason(bundle);
    assert.equal(result.supportingEvidence.length, 2);
    assert.equal(result.opposingEvidence.length, 0);
    assert.equal(result.conflicts.length, 0);
  });

  test("conflict: cross-type items never conflict and are always supporting", () => {
    const bundle = ranking.buildBundle(
      "XAUUSD",
      [item({ type: "price", source: "a", magnitude: 2685.4 }), item({ type: "technical", source: "b", claim: "RSI overbought" })],
      T1,
    );
    const result = engine.reason(bundle);
    assert.equal(result.supportingEvidence.length, 2);
    assert.deepEqual(result.conflicts, []);
  });

  // ---------------------------------------------------------------------
  // Reasoning consistency
  // ---------------------------------------------------------------------
  test("consistency: every input item appears in exactly one of supporting/opposing/unresolved", () => {
    const items = [
      item({ source: "a", magnitude: 2685.4 }),
      item({ source: "b", magnitude: 2700.0 }),
      item({ type: "news", source: "c", claim: "Gold rallies" }),
    ];
    const bundle = ranking.buildBundle("XAUUSD", items, T1);
    const result = engine.reason(bundle);
    const classified = [...result.supportingEvidence, ...result.opposingEvidence, ...result.unresolvedItems];
    assert.equal(classified.length, items.length, "every item must be classified exactly once");
    for (const original of items) {
      const matches = classified.filter((c) => c === original);
      assert.equal(matches.length, 1, `item from ${original.source} must appear in exactly one bucket`);
    }
  });

  // ---------------------------------------------------------------------
  // Uncertainty handling
  // ---------------------------------------------------------------------
  test("uncertainty: broader evidence-type coverage produces a lower score than sparse coverage, all else equal", () => {
    const sparse = ranking.buildBundle("XAUUSD", [item({ type: "price", source: "a" })], T1);
    const broader = ranking.buildBundle(
      "XAUUSD",
      [
        item({ type: "price", source: "a" }),
        item({ type: "technical", source: "a", claim: "RSI neutral" }),
        item({ type: "news", source: "a", claim: "headline" }),
        item({ type: "macro", source: "a", claim: "CPI in line" }),
      ],
      T1,
    );
    const sparseResult = engine.reason(sparse);
    const broaderResult = engine.reason(broader);
    assert.ok(
      broaderResult.uncertainty.score < sparseResult.uncertainty.score,
      `expected broader coverage (${broaderResult.uncertainty.score}) < sparse (${sparseResult.uncertainty.score})`,
    );
  });

  test("uncertainty: an empty bundle (zero evidence) produces a defined, non-fabricated score with a clear reason", () => {
    const bundle = ranking.buildBundle("XAUUSD", [], T1);
    const result = engine.reason(bundle);
    assert.equal(result.uncertainty.score, 50, "8 of 8 types missing -> 50-point coverage penalty, no conflicts, no staleness (nothing to be stale)");
    assert.ok(result.uncertainty.reasons.some((r) => r.includes("evidence types unavailable")));
  });

  test("uncertainty: stale evidence increases the score via a staleness reason", () => {
    const fresh = ranking.buildBundle("XAUUSD", [item({ source: "a", asOf: FRESH })], T1);
    const stale = ranking.buildBundle("XAUUSD", [item({ source: "a", asOf: STALE_HEAVY })], T1);
    const freshResult = engine.reason(fresh);
    const staleResult = engine.reason(stale);
    assert.ok(staleResult.uncertainty.score > freshResult.uncertainty.score);
    assert.ok(staleResult.uncertainty.reasons.some((r) => r.includes("minute(s) old")));
  });

  test("uncertainty: unresolved conflicts increase the score", () => {
    const agree = ranking.buildBundle("XAUUSD", [item({ source: "a", magnitude: 1 }), item({ source: "b", magnitude: 1.001 })], T1);
    const disagree = ranking.buildBundle("XAUUSD", [item({ source: "a", magnitude: 1 }), item({ source: "b", magnitude: 2 })], T1);
    assert.ok(engine.reason(disagree).uncertainty.score > engine.reason(agree).uncertainty.score);
  });

  // ---------------------------------------------------------------------
  // No fabrication
  // ---------------------------------------------------------------------
  test("no fabrication: assumptions are generated only for evidence types genuinely absent from the bundle", () => {
    const bundle = ranking.buildBundle("XAUUSD", [item({ type: "price" }), item({ type: "news", claim: "headline" })], T1);
    const result = engine.reason(bundle);
    assert.ok(!result.assumptions.some((a) => a.type === "price"), "price is present - must not get an assumption");
    assert.ok(!result.assumptions.some((a) => a.type === "news"), "news is present - must not get an assumption");
    assert.ok(result.assumptions.some((a) => a.type === "technical"), "technical is absent - must get an assumption");
    assert.equal(result.assumptions.length, 6, "8 total types - 2 present = 6 assumptions");
  });

  test("no fabrication: freshness/staleness drivers are omitted entirely (not defaulted to zero) when there is no evidence", () => {
    const bundle = ranking.buildBundle("XAUUSD", [], T1);
    const result = engine.reason(bundle);
    assert.ok(!result.confidenceDrivers.some((d) => d.factor === "freshness"), "no evidence means no freshness claim can be made");
    assert.ok(!result.riskDrivers.some((d) => d.factor === "staleness"), "no evidence means no staleness claim can be made");
  });

  test("no fabrication: conflicts array is a pass-through of the bundle's own conflicts, never re-derived or altered", () => {
    const bundle = ranking.buildBundle("XAUUSD", [item({ source: "a", magnitude: 1 }), item({ source: "b", magnitude: 2 })], T1);
    const result = engine.reason(bundle);
    assert.equal(result.conflicts, bundle.conflicts, "must be the exact same array reference/contents, not reconstructed");
  });

  // ---------------------------------------------------------------------
  // Structural: AI-provider independent, standalone
  // ---------------------------------------------------------------------
  test("structural: the reasoning engine's import statements never reach into lib/ai or market-data providers", () => {
    const files = ["types/reasoning.ts", "services/ai/reasoning/reasoning-engine.service.ts"];
    const forbidden = [
      "lib/ai",
      "@google/genai",
      "market-data-provider",
      "alpha-vantage.provider",
      "data/mock",
      "market-intelligence.service",
      "services/ai/providers/",
      "conversation-message.service",
      "context-manager.service",
      "knowledge/chat/route",
    ];
    for (const file of files) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      const importLines = source
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line));
      for (const needle of forbidden) {
        assert.ok(
          !importLines.some((line) => line.includes(needle)),
          `${file} must not import from anything matching "${needle}"`,
        );
      }
    }
  });

  test("structural: the frozen Sprint 15C chat route has zero coupling to the reasoning engine", () => {
    const source = readFileSync(
      new URL("../app/api/private/knowledge/chat/route.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!source.includes("reasoning"), "chat route must not import anything from the reasoning engine");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
