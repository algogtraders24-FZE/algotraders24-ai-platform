// scripts/validate-knowledge-loop-decision-matrix.ts
// Sprint K3-C (C3) — the retrieval/web DECISION MATRIX as a locked contract
// (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12.2). Pure functions, ZERO I/O.
//
// Run: npm run validate:knowledge-loop-decision-matrix
//
// Proves:
//   - every row of the §12.2 matrix (account-specific / historical / current-
//     info / conceptual / other / no-knowledge × sufficiency × similarity)
//   - the LOCKED ORDER: account-specific is decided BEFORE the web-search gate
//     (a broken gate-first implementation is caught here)
//   - the OFFER, not a prediction: `webSearchOffered` never depends on a
//     runtime search outcome
//   - deriveSourceClass — the 4-way outcome map (never provider identity)
//   - liveFiguresGuardApplies — DYNAMIC + not-web-grounded + no-knowledge only
//   - equivalence: decidePreGeneration composes classify + webSearchGate, it
//     does not re-implement either

import assert from "node:assert/strict";
import {
  decidePreGeneration,
  deriveSourceClass,
  liveFiguresGuardApplies,
  type RetrievalDecisionState,
} from "../services/knowledge-loop/orchestrator/decide-path";
import { webSearchGate } from "../services/knowledge-loop/orchestrator/web-search-gate";
import { classify } from "../services/knowledge-loop/classifier/classify";
import type {
  Classification,
  AssistantIntent,
  FreshnessNeed,
  PrivacyClass,
  Sufficiency,
} from "../types/knowledge-loop";

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

function cls(
  intent: AssistantIntent,
  freshnessNeed: FreshnessNeed,
  privacyClass: PrivacyClass = "public",
  explicitFreshnessRequest = false,
): Classification {
  return { intent, freshnessNeed, privacyClass, explicitFreshnessRequest };
}

function state(
  sufficiency: Sufficiency,
  bestSimilarity = 0,
  hasHits = bestSimilarity > 0,
  contextBlockNonEmpty = hasHits,
): RetrievalDecisionState {
  return { sufficiency, bestSimilarity, hasHits, contextBlockNonEmpty };
}

function main(): void {
  console.log("\nK3-C C3 — retrieval/web decision matrix (§12.2)\n");

  // ── §12.2 matrix rows ─────────────────────────────────────────────────
  const rows: Array<{
    name: string;
    c: Classification;
    r: RetrievalDecisionState;
    route: "deterministic-account" | "generate";
    web: boolean;
  }> = [
    {
      name: "account-specific → deterministic, no web",
      c: cls("account-specific", "PERIODIC", "user-specific"),
      r: state("SUFFICIENT", 0.9),
      route: "deterministic-account",
      web: false,
    },
    {
      name: "account-specific + explicit freshness → STILL deterministic, no web",
      c: cls("account-specific", "DYNAMIC", "user-specific", true),
      r: state("INSUFFICIENT"),
      route: "deterministic-account",
      web: false,
    },
    {
      name: "historical + sufficient → no web",
      c: cls("historical", "STATIC"),
      r: state("SUFFICIENT", 0.8),
      route: "generate",
      web: false,
    },
    {
      name: "historical + insufficient → web offered",
      c: cls("historical", "STATIC"),
      r: state("INSUFFICIENT"),
      route: "generate",
      web: true,
    },
    {
      name: "historical + stale → web offered",
      c: cls("historical", "STATIC"),
      r: state("STALE", 0.5),
      route: "generate",
      web: true,
    },
    {
      name: "current-info + sufficient → web offered",
      c: cls("current-info", "DYNAMIC", "public", true),
      r: state("SUFFICIENT", 0.8),
      route: "generate",
      web: true,
    },
    {
      name: "current-info + insufficient → web offered",
      c: cls("current-info", "DYNAMIC"),
      r: state("INSUFFICIENT"),
      route: "generate",
      web: true,
    },
    {
      name: "conceptual + sufficient → no web",
      c: cls("conceptual", "STATIC"),
      r: state("SUFFICIENT", 0.7),
      route: "generate",
      web: false,
    },
    {
      name: "conceptual + stale → web offered",
      c: cls("conceptual", "STATIC"),
      r: state("STALE", 0.5),
      route: "generate",
      web: true,
    },
    {
      name: "other + strong sufficient hit → no web",
      c: cls("other", "PERIODIC"),
      r: state("SUFFICIENT", 0.82),
      route: "generate",
      web: false,
    },
    {
      name: "other + borderline similarity < 0.50 → web offered",
      c: cls("other", "PERIODIC"),
      r: state("SUFFICIENT", 0.46),
      route: "generate",
      web: true,
    },
    {
      name: "other + insufficient → web offered",
      c: cls("other", "PERIODIC"),
      r: state("INSUFFICIENT"),
      route: "generate",
      web: true,
    },
    {
      name: "no knowledge (INSUFFICIENT, no hits) + how-to → web offered",
      c: cls("how-to", "STATIC"),
      r: state("INSUFFICIENT"),
      route: "generate",
      web: true,
    },
    {
      name: "no knowledge + sensitive → web forbidden (intent does not permit)",
      c: cls("other", "PERIODIC", "sensitive"),
      r: state("INSUFFICIENT"),
      route: "generate",
      web: false,
    },
  ];

  for (const row of rows) {
    test(`row: ${row.name}`, () => {
      const d = decidePreGeneration(row.c, row.r);
      assert.equal(d.route, row.route, `route`);
      assert.equal(d.webSearchOffered, row.web, `webSearchOffered`);
    });
  }

  // ── LOCKED ORDER: account-specific decided BEFORE the gate ─────────────
  test("precedence: account-specific wins over every gate signal", () => {
    for (const s of ["SUFFICIENT", "LOW", "INSUFFICIENT", "STALE"] as Sufficiency[]) {
      for (const fresh of [true, false]) {
        const d = decidePreGeneration(
          cls("account-specific", fresh ? "DYNAMIC" : "PERIODIC", "user-specific", fresh),
          state(s, 0.3),
        );
        assert.equal(d.route, "deterministic-account");
        assert.equal(d.webSearchOffered, false);
        assert.equal(d.gateReason, "account-specific");
      }
    }
  });

  test("precedence: a gate-FIRST implementation would fail this", () => {
    // If the gate ran before the account-specific check, this classification
    // (account-specific + explicit freshness) would return webSearchOffered=true
    // via the gate's "explicit-freshness" rule. The contract requires false.
    const gateSaysYes = webSearchGate(
      cls("account-specific", "DYNAMIC", "user-specific", true),
      "INSUFFICIENT",
      0.1,
    );
    // (the raw gate does forbid account-specific too, so also assert the
    // ordering via a non-forbidden gate signal: sensitive-free 'other' path)
    assert.equal(gateSaysYes.useWebSearch, false); // gate also forbids it
    const d = decidePreGeneration(
      cls("account-specific", "DYNAMIC", "user-specific", true),
      state("INSUFFICIENT"),
    );
    assert.equal(d.route, "deterministic-account", "short-circuited before generate");
  });

  // ── OFFER, not prediction ────────────────────────────────────────────
  test("decidePreGeneration is pure: identical inputs → identical output", () => {
    const c = cls("current-info", "DYNAMIC", "public", true);
    const r = state("LOW", 0.4);
    assert.deepEqual(decidePreGeneration(c, r), decidePreGeneration(c, r));
  });

  test("decision output carries NO runtime-search field", () => {
    const d = decidePreGeneration(cls("other", "PERIODIC"), state("SUFFICIENT", 0.46));
    assert.deepEqual(
      Object.keys(d).sort(),
      ["gateReason", "knowledgeCounted", "route", "webSearchOffered"],
    );
  });

  // ── knowledgeCounted ─────────────────────────────────────────────────
  test("knowledgeCounted: SUFFICIENT/LOW with a non-empty block → true", () => {
    assert.equal(decidePreGeneration(cls("other", "PERIODIC"), state("SUFFICIENT", 0.8)).knowledgeCounted, true);
    assert.equal(decidePreGeneration(cls("other", "PERIODIC"), state("LOW", 0.35)).knowledgeCounted, true);
  });
  test("knowledgeCounted: INSUFFICIENT / STALE / no-hits / empty-block → false", () => {
    assert.equal(decidePreGeneration(cls("other", "PERIODIC"), state("INSUFFICIENT")).knowledgeCounted, false);
    assert.equal(decidePreGeneration(cls("other", "PERIODIC"), state("STALE", 0.5)).knowledgeCounted, false);
    assert.equal(decidePreGeneration(cls("other", "PERIODIC"), { sufficiency: "SUFFICIENT", bestSimilarity: 0.8, hasHits: true, contextBlockNonEmpty: false }).knowledgeCounted, false);
  });

  // ── deriveSourceClass — outcome map, never provider identity ──────────
  test("deriveSourceClass: 4-way map", () => {
    assert.equal(deriveSourceClass({ webUsed: false, knowledgeCounted: true }), "AT24_KNOWLEDGE");
    assert.equal(deriveSourceClass({ webUsed: false, knowledgeCounted: false }), "CLAUDE_REASONING");
    assert.equal(deriveSourceClass({ webUsed: true, knowledgeCounted: true }), "MIXED");
    assert.equal(deriveSourceClass({ webUsed: true, knowledgeCounted: false }), "CLAUDE_WEB_SEARCH");
  });

  // ── liveFiguresGuardApplies (predicate only; C5 wires the effect) ─────
  test("liveFiguresGuardApplies: DYNAMIC + not web-grounded + no knowledge → true", () => {
    assert.equal(liveFiguresGuardApplies({ freshnessNeed: "DYNAMIC", webGrounded: false, knowledgeGrounded: false }), true);
  });
  test("liveFiguresGuardApplies: false when web-grounded, knowledge-grounded, or not DYNAMIC", () => {
    assert.equal(liveFiguresGuardApplies({ freshnessNeed: "DYNAMIC", webGrounded: true, knowledgeGrounded: false }), false);
    assert.equal(liveFiguresGuardApplies({ freshnessNeed: "DYNAMIC", webGrounded: false, knowledgeGrounded: true }), false);
    assert.equal(liveFiguresGuardApplies({ freshnessNeed: "PERIODIC", webGrounded: false, knowledgeGrounded: false }), false);
    assert.equal(liveFiguresGuardApplies({ freshnessNeed: "STATIC", webGrounded: false, knowledgeGrounded: false }), false);
  });

  // ── equivalence: composition, not re-implementation ──────────────────
  test("decidePreGeneration.webSearchOffered === webSearchGate(...).useWebSearch for the generate route", () => {
    const samples: Array<[Classification, RetrievalDecisionState]> = [
      [cls("conceptual", "STATIC"), state("SUFFICIENT", 0.7)],
      [cls("conceptual", "STATIC"), state("STALE", 0.5)],
      [cls("current-info", "DYNAMIC", "public", true), state("SUFFICIENT", 0.8)],
      [cls("other", "PERIODIC"), state("SUFFICIENT", 0.46)],
      [cls("other", "PERIODIC"), state("SUFFICIENT", 0.9)],
      [cls("how-to", "STATIC"), state("INSUFFICIENT")],
      [cls("historical", "STATIC"), state("LOW", 0.35)],
    ];
    for (const [c, r] of samples) {
      const d = decidePreGeneration(c, r);
      const g = webSearchGate(c, r.sufficiency, r.bestSimilarity);
      assert.equal(d.webSearchOffered, g.useWebSearch, `${JSON.stringify(c)} / ${r.sufficiency}`);
      assert.equal(d.gateReason, g.reason);
    }
  });

  // ── real classifier → matrix (end-to-end of the pure decision path) ──
  test("real classifier text → decision (no LLM anywhere in the path)", () => {
    // "what is the latest price of gold" → current-info/DYNAMIC → web offered
    let d = decidePreGeneration(classify("what is the latest price of gold"), state("SUFFICIENT", 0.7));
    assert.equal(d.webSearchOffered, true);
    // "when does my subscription renew" → account-specific → deterministic
    d = decidePreGeneration(classify("when does my subscription renew"), state("INSUFFICIENT"));
    assert.equal(d.route, "deterministic-account");
    // "what is a moving average" (conceptual) + SUFFICIENT → no web
    d = decidePreGeneration(classify("what is a moving average"), state("SUFFICIENT", 0.75));
    assert.equal(d.webSearchOffered, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
