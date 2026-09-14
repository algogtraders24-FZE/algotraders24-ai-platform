// scripts/validate-knowledge-loop-telemetry.ts
// Sprint K3-C (C8) — observability & cost boundary
// (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12.6, D-K3C-8). Pure + one
// integration section. ZERO DB, ZERO LLM, ZERO network.
//
// Run: npm run validate:knowledge-loop-telemetry
//
// Part A — positive: every required operational/evidence field is correctly
// populated across success, fallback, web-failure, continuation-exhaustion,
// safe-failure, cache, and cost-usage paths.
// Part B — negative leakage: TelemetryLine is structurally incapable of
// carrying content (no nested object, no array, only primitives); a fuzz
// test with fake secrets/markers proves none of it survives into the line.
// Part C — integration: the REAL orchestrator, `console.info` intercepted,
// proves exactly one telemetry line per turn, an honest `provenanceWritten`,
// and end-to-end no-leakage on a turn whose message/knowledge carry markers.

import assert from "node:assert/strict";
import {
  buildProvenance,
  type ProvenanceFacts,
  type ProvenanceOutcome,
} from "../services/knowledge-loop/orchestrator/build-provenance";
import {
  buildTelemetryLine,
  TELEMETRY_EVENT_NAME,
  type TelemetryLine,
} from "../services/knowledge-loop/orchestrator/telemetry";
import { KnowledgeAnswerOrchestrator } from "../services/knowledge-loop/orchestrator/knowledge-answer-orchestrator";
import {
  FakeRetrieval,
  FakeProviderSlot,
  InMemoryProvenanceStore,
} from "../services/knowledge-loop/orchestrator/in-memory-adapters";
import type { AnswerProviderAttempt, AnswerTurn, Classification, Sufficiency } from "../types/knowledge-loop";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

// ── fixtures (mirrors validate-knowledge-loop-provenance-integrity.ts) ──
const cls = (over: Partial<Classification> = {}): Classification => ({
  intent: "other",
  freshnessNeed: "PERIODIC",
  privacyClass: "public",
  explicitFreshnessRequest: false,
  ...over,
});

function facts(over: {
  sufficiency?: Sufficiency;
  hits?: Array<{ content?: string; similarity?: number }>;
  contextBlockNonEmpty?: boolean;
  skipped?: boolean;
  fromCache?: boolean;
  webSearchOffered?: boolean;
  gateReason?: string;
  outcome?: ProvenanceOutcome;
  attempts?: AnswerProviderAttempt[];
  latencyMs?: number;
} = {}): ProvenanceFacts {
  const hits = (over.hits ?? [{}]).map((h, i) => ({
    knowledgeId: `k${i}`,
    chunkId: `k${i}:c0`,
    chunkIndex: 0,
    similarity: h.similarity ?? 0.7,
    content: h.content ?? "AT24 supports MT5 and MT4.",
    freshnessClass: "PERIODIC" as string | null,
  }));
  const outcome: ProvenanceOutcome =
    over.outcome ?? {
      kind: "generated",
      providerUsed: "claude",
      webSources: [],
      searchCount: 0,
      webSearchUsed: false,
      webSearchFailed: false,
      webSearchPartialFailure: false,
      continuationCount: 0,
      continuationBudgetExhausted: false,
      truncated: false,
    };
  return {
    turn: { requestId: "req_c8", callerUserId: "u1", conversationId: "c1", messageId: "m1" },
    classification: cls(),
    retrieval: {
      sufficiency: over.sufficiency ?? "SUFFICIENT",
      bestSimilarity: hits[0]?.similarity ?? 0,
      contextBlockNonEmpty: over.contextBlockNonEmpty ?? true,
      conflict: null,
      skipped: over.skipped ?? false,
      fromCache: over.fromCache ?? false,
      hits,
    },
    decision: { webSearchOffered: over.webSearchOffered ?? false, gateReason: over.gateReason ?? "not-needed" },
    outcome,
    attempts: over.attempts ?? [{ provider: "claude", attempted: true, ok: true, latencyMs: 10 }],
    latencyMs: over.latencyMs ?? 42,
  };
}

const turn = (over: Partial<AnswerTurn> = {}): AnswerTurn => ({
  requestId: "req_c8_orch",
  callerUserId: "user_c8",
  callerRole: "user",
  conversationId: "conv_c8",
  messageId: "msg_c8",
  message: "What is a moving average?",
  ...over,
});

async function main(): Promise<void> {
  console.log("\nK3-C C8 — observability & cost boundary\n");

  // ══ Part A — positive telemetry assertions ═════════════════════════

  await test("A1: clean AT24_KNOWLEDGE success -> full field set correctly populated", () => {
    const { provenanceInput } = buildProvenance(facts({ sufficiency: "SUFFICIENT" }));
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.sourceClass, "AT24_KNOWLEDGE");
    assert.equal(line.providerUsed, "claude");
    assert.equal(line.retrievalSufficiency, "SUFFICIENT");
    assert.equal(line.hitCount, 1);
    assert.equal(line.webSearchOffered, false);
    assert.equal(line.webSearchUsed, false);
    assert.equal(line.integrityPassed, true);
    assert.equal(line.failureCategory, null);
    assert.equal(line.provenanceWritten, true);
    assert.equal(typeof line.latencyMs, "number");
  });

  await test("A2: web fallback path -> webSearchOffered/searchCount/webSearchUsed populated", () => {
    const { provenanceInput } = buildProvenance(
      facts({
        sufficiency: "INSUFFICIENT",
        webSearchOffered: true,
        gateReason: "insufficient",
        outcome: {
          kind: "generated", providerUsed: "claude",
          webSources: [{ url: "https://x.example", title: "X", citedTexts: ["fact"] }],
          searchCount: 1, webSearchUsed: true, webSearchFailed: false, webSearchPartialFailure: false,
          continuationCount: 0, continuationBudgetExhausted: false, truncated: false,
        },
      }),
    );
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.webSearchOffered, true);
    assert.equal(line.searchCount, 1);
    assert.equal(line.webSearchUsed, true);
    assert.equal(line.sourceClass, "CLAUDE_WEB_SEARCH");
  });

  await test("A3: non-web fallback winner on a web-required turn -> webSearchFailed=false, requestedButUnavailable=true (independent fields)", () => {
    const { provenanceInput } = buildProvenance(
      facts({
        sufficiency: "INSUFFICIENT",
        webSearchOffered: true,
        gateReason: "dynamic-need",
        outcome: {
          kind: "generated", providerUsed: "gemini",
          webSources: [], searchCount: 0, webSearchUsed: false, webSearchFailed: false, webSearchPartialFailure: false,
          continuationCount: 0, continuationBudgetExhausted: false, truncated: false,
        },
      }),
    );
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.providerUsed, "gemini");
    assert.equal(line.webSearchFailed, false, "gemini ran no search - no operational failure");
    assert.equal(line.webSearchRequestedButUnavailable, true, "but web was required and not obtained");
  });

  await test("A4: partial web-search failure -> webSearchFailed=true AND webSearchPartialFailure=true", () => {
    const { provenanceInput } = buildProvenance(
      facts({
        webSearchOffered: true,
        outcome: {
          kind: "generated", providerUsed: "claude",
          webSources: [{ url: "https://ok.example", title: "OK", citedTexts: ["fact"] }],
          searchCount: 2, webSearchUsed: true, webSearchFailed: true, webSearchPartialFailure: true,
          continuationCount: 0, continuationBudgetExhausted: false, truncated: false,
        },
      }),
    );
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.webSearchFailed, true);
    assert.equal(line.webSearchPartialFailure, true);
  });

  await test("A5: continuation fields flow through when the winner reports them", () => {
    const { provenanceInput } = buildProvenance(
      facts({
        outcome: {
          kind: "generated", providerUsed: "claude", webSources: [], searchCount: 1,
          webSearchUsed: false, webSearchFailed: false, webSearchPartialFailure: false,
          continuationCount: 2, continuationBudgetExhausted: false, truncated: false,
        },
      }),
    );
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.continuationCount, 2);
    assert.equal(line.continuationBudgetExhausted, false);
  });

  await test("A6: safe failure (chain exhausted) -> DETERMINISTIC, integrityPassed=false, failureCategory 'chain-exhausted'", () => {
    const { provenanceInput } = buildProvenance(
      facts({
        outcome: { kind: "deterministic", reason: "chain-exhausted" },
        attempts: [
          { provider: "claude", attempted: true, ok: false, failure: "network" },
          { provider: "gemini", attempted: true, ok: false, failure: "network" },
        ],
      }),
    );
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.sourceClass, "DETERMINISTIC");
    assert.equal(line.providerUsed, "deterministic");
    assert.equal(line.integrityPassed, false);
    assert.equal(line.failureCategory, "chain-exhausted");
  });

  await test("A7: retrieval cache hit -> retrievalFromCache=true", () => {
    const { provenanceInput } = buildProvenance(facts({ fromCache: true }));
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.retrievalFromCache, true);
  });

  await test("A8: retrieval cache miss -> retrievalFromCache=false", () => {
    const { provenanceInput } = buildProvenance(facts({ fromCache: false }));
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.retrievalFromCache, false);
  });

  await test("A9: cost usage present when the provider reports it", () => {
    const { provenanceInput } = buildProvenance(
      facts({
        outcome: {
          kind: "generated", providerUsed: "claude", webSources: [], searchCount: 0,
          webSearchUsed: false, webSearchFailed: false, webSearchPartialFailure: false,
          continuationCount: 0, continuationBudgetExhausted: false, truncated: false,
          usage: { promptTokens: 1234, completionTokens: 56 },
        },
      }),
    );
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.promptTokens, 1234);
    assert.equal(line.completionTokens, 56);
  });

  await test("A10: cost usage is null (never fabricated) when the provider doesn't report it", () => {
    const { provenanceInput } = buildProvenance(facts({})); // default outcome has no `usage`
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.promptTokens, null);
    assert.equal(line.completionTokens, null);
  });

  await test("A10b: deterministic terminal -> usage is null (no generation happened)", () => {
    const { provenanceInput } = buildProvenance(facts({ outcome: { kind: "deterministic", reason: "account-specific" }, attempts: [] }));
    const line = buildTelemetryLine(provenanceInput, true);
    assert.equal(line.promptTokens, null);
    assert.equal(line.completionTokens, null);
  });

  await test("A11: provenanceWritten reflects the actual write outcome (false on failure)", () => {
    const { provenanceInput } = buildProvenance(facts({}));
    const written = buildTelemetryLine(provenanceInput, true);
    const failed_ = buildTelemetryLine(provenanceInput, false);
    assert.equal(written.provenanceWritten, true);
    assert.equal(failed_.provenanceWritten, false);
  });

  await test("A12: attempt order + per-attempt latency remain available on the provenance row (unchanged, re-asserted)", () => {
    const attempts: AnswerProviderAttempt[] = [
      { provider: "claude", attempted: true, ok: false, failure: "boom", latencyMs: 11 },
      { provider: "gemini", attempted: true, ok: true, latencyMs: 22 },
    ];
    const { provenanceInput } = buildProvenance(facts({ attempts, outcome: { kind: "generated", providerUsed: "gemini", webSources: [], searchCount: 0, webSearchUsed: false, webSearchFailed: false, webSearchPartialFailure: false, continuationCount: 0, continuationBudgetExhausted: false, truncated: false } }));
    // telemetry line itself is a SUMMARY (no per-attempt detail by design);
    // the per-attempt trace, in order, with latency, lives on the row:
    assert.deepEqual(provenanceInput.providerAttempts.map((a) => a.provider), ["claude", "gemini"]);
    assert.equal(provenanceInput.providerAttempts[0].latencyMs, 11);
    assert.equal(provenanceInput.providerAttempts[1].latencyMs, 22);
  });

  // ══ Part B — negative leakage assertions ═══════════════════════════

  await test("B1: TelemetryLine is structurally primitives-only (no nested object, no array)", () => {
    const { provenanceInput } = buildProvenance(facts({}));
    const line = buildTelemetryLine(provenanceInput, true);
    for (const [k, v] of Object.entries(line)) {
      assert.ok(
        v === null || ["boolean", "number", "string"].includes(typeof v),
        `TelemetryLine.${k} must be a primitive, got ${typeof v}`,
      );
    }
  });

  await test("B2: TelemetryLine's key set carries NO content-bearing field", () => {
    const { provenanceInput } = buildProvenance(facts({}));
    const line = buildTelemetryLine(provenanceInput, true);
    const keys = Object.keys(line as unknown as Record<string, unknown>);
    for (const forbidden of [
      "knowledgeContributions", "webContributions", "providerAttempts", "snippet",
      "citedText", "message", "text", "answer", "history", "query", "content",
    ]) {
      assert.ok(!keys.includes(forbidden), `TelemetryLine must not carry '${forbidden}'`);
    }
  });

  await test("B3: fuzz - fake secrets/markers in the underlying facts never survive into the telemetry line", () => {
    const marker = "MARKER-FUZZ-8f2a";
    const fakeSecret = "sk-ant-totallyRealLookingKey1234567890";
    const fakeSsn = "123-45-6789";
    const { provenanceInput } = buildProvenance(
      facts({
        hits: [{ content: `${marker} AT24 knowledge chunk mentioning a card 4111111111111111 and SSN ${fakeSsn}` }],
        attempts: [
          { provider: "claude", attempted: true, ok: false, failure: `boom ${fakeSecret} for ${marker}` },
          { provider: "gemini", attempted: true, ok: true },
        ],
        outcome: { kind: "generated", providerUsed: "gemini", webSources: [], searchCount: 0, webSearchUsed: false, webSearchFailed: false, webSearchPartialFailure: false, continuationCount: 0, continuationBudgetExhausted: false, truncated: false },
      }),
    );
    const line = buildTelemetryLine(provenanceInput, true);
    const json = JSON.stringify(line);
    assert.ok(!json.includes(marker), "marker must not leak into telemetry");
    assert.ok(!json.includes(fakeSecret), "the raw secret must not leak into telemetry");
    assert.ok(!json.includes(fakeSsn), "the raw SSN-shaped string must not leak into telemetry");
    // (contrast: the PROVENANCE ROW itself legitimately carries a redacted
    // version of the failure and the knowledge excerpt - that's tested in
    // validate-knowledge-loop-provenance-integrity. Telemetry carries none
    // of it, redacted or not.)
  });

  // ══ Part C — integration: the real orchestrator + console.info ═════

  await test("C1: exactly one telemetry line per answer() turn, correct event name, honest provenanceWritten=true", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }], contextBlock: "x" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "ok", usage: { promptTokens: 100, completionTokens: 20 } });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });

    const calls: unknown[][] = [];
    const realInfo = console.info;
    console.info = (...args: unknown[]) => { calls.push(args); };
    try {
      await orch.answer(turn());
    } finally {
      console.info = realInfo;
    }

    assert.equal(calls.length, 1, "exactly one console.info call per turn");
    assert.equal(calls[0][0], TELEMETRY_EVENT_NAME);
    const line = calls[0][1] as TelemetryLine;
    assert.equal(line.provenanceWritten, true);
    assert.equal(line.promptTokens, 100);
    assert.equal(line.completionTokens, 20);
    assert.equal(line.sourceClass, "AT24_KNOWLEDGE");
  });

  await test("C2: provenanceWritten=false when the store write fails (answer still returned normally)", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }], contextBlock: "x" });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "ok" });
    const prov = new InMemoryProvenanceStore();
    prov.failWrites = true;
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: prov });

    const calls: unknown[][] = [];
    const realInfo = console.info;
    console.info = (...args: unknown[]) => { calls.push(args); };
    let result;
    try {
      result = await orch.answer(turn());
    } finally {
      console.info = realInfo;
    }

    assert.equal(calls.length, 1);
    assert.equal((calls[0][1] as TelemetryLine).provenanceWritten, false);
    assert.equal(result.text, "ok", "the answer itself is unaffected by the telemetry/persistence outcome");
  });

  await test("C3: deterministic terminal (account-specific) also emits exactly one telemetry line", async () => {
    const retrieval = new FakeRetrieval({ sufficiency: "SUFFICIENT", hits: [{ content: "x" }] });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "should not run" });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });

    const calls: unknown[][] = [];
    const realInfo = console.info;
    console.info = (...args: unknown[]) => { calls.push(args); };
    try {
      await orch.answer(turn({ message: "When does my subscription renew?" }));
    } finally {
      console.info = realInfo;
    }

    assert.equal(calls.length, 1);
    const line = calls[0][1] as TelemetryLine;
    assert.equal(line.sourceClass, "DETERMINISTIC");
    assert.equal(line.providerUsed, "deterministic");
  });

  await test("C4: end-to-end no-leakage - a turn whose message AND knowledge carry markers never surfaces them in telemetry", async () => {
    const marker = "END-TO-END-MARKER-771c";
    const retrieval = new FakeRetrieval({
      sufficiency: "SUFFICIENT",
      hits: [{ content: `${marker} some knowledge chunk` }],
      contextBlock: `${marker} some knowledge chunk`,
    });
    const claude = new FakeProviderSlot({ name: "claude", supportsWebSearch: true, text: "a normal answer" });
    const orch = new KnowledgeAnswerOrchestrator({ retrieval, slots: [claude], provenance: new InMemoryProvenanceStore() });

    const calls: unknown[][] = [];
    const realInfo = console.info;
    console.info = (...args: unknown[]) => { calls.push(args); };
    try {
      await orch.answer(turn({ message: `Tell me about ${marker} and my secret plan` }));
    } finally {
      console.info = realInfo;
    }

    const json = JSON.stringify(calls[0][1]);
    assert.ok(!json.includes(marker), "neither the message nor the knowledge marker may appear in telemetry");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
