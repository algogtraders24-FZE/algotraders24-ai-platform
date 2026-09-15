// scripts/validate-knowledge-loop-route-contract.ts
// Sprint K3-C (C6) — route/envelope regression lock
// (AI_ASSISTANT_ORCHESTRATION_CONTRACT.md §12 / K3C_DECISION D-K3C-6).
//
// `app/api/private/knowledge/chat/route.ts` depends on session auth,
// Prisma, RepositoryFactory, ConversationMessageService, and
// IntelligencePresentationService — none of which this codebase's plain
// `tsx` + `node:assert` validators mock (no jest/vitest module-mocking
// anywhere in K1/K2/K3). Dynamically invoking the real handler offline is
// therefore not the house-style option here. Instead, this is a STRUCTURAL
// regression lock on the route's real source — the same technique
// `validate-knowledge-loop-schema.ts` uses for its INV-1 checks — pinning
// the exact envelope shapes so a later edit that silently renames, drops, or
// reorders a field is a test failure, not a silent breaking change for the
// publishing / trading-copilot / agents callers.
//
// C6 made NO route code change (confirmed: `git diff` on this file is empty
// for this step) — every one of these assertions passes against the
// UNMODIFIED route left by K3-B-3, because C5 did not change `AnswerResult`'s
// shape (locked separately by `validate-knowledge-loop-c5-integration`'s
// test 15).
//
// Run: npm run validate:knowledge-loop-route-contract
//
// Proves:
//   - the K3-B non-stream envelope keys: content, ragApplied, sourcesCount,
//     sources, webSources, conversationId, knowledge — unchanged
//   - the K3-B NDJSON stream emits stage -> token -> done, in order, with the
//     same keys as `done`
//   - `ChatSource` / `knowledgeMeta` / `webSources` mapping shapes unchanged
//   - the market-intelligence branch's envelope + stream shapes are BYTE
//     IDENTICAL (K3-C touched nothing on that path)
//   - the route only reads AnswerResult fields that actually exist on it
//   - BOUNDARY: assistant.service.ts, every file under services/intelligence/**,
//     and research-knowledge-search.tool.ts import NOTHING from
//     services/knowledge-loop/orchestrator/** (market-intel / Support-tool
//     independence, re-asserted from the route side)

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTE = join(ROOT, "app", "api", "private", "knowledge", "chat", "route.ts");

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

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** pull the `{ ... }` object-literal keys, top-level only (no nested `{`). */
function objectKeys(block: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  const re = /[{}]|(\w+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    if (m[0] === "{") depth += 1;
    else if (m[0] === "}") depth -= 1;
    else if (depth === 1 && m[1]) keys.push(m[1]);
  }
  return keys;
}

function main(): void {
  console.log("\nK3-C C6 — route/envelope regression lock\n");
  const src = readFileSync(ROUTE, "utf8");

  // ── K3-B non-stream envelope (the one C5 could have changed) ──────────
  // A literal, in-order token sequence rather than a brace-balancing parse —
  // simpler and just as precise for a regression lock (it additionally
  // pins key ORDER, a bonus, not a requirement).
  test("K3-B non-stream envelope: exact key set + order, unchanged", () => {
    assert.match(
      src,
      /\{\s*content:\s*answer,\s*ragApplied,\s*sourcesCount:\s*sources\.length,\s*sources,\s*webSources,\s*conversationId,\s*knowledge:\s*knowledgeMeta,?\s*\}/,
      "the K3-B non-stream ApiResponse.success(...) payload literal must match exactly",
    );
  });

  test("K3-B NDJSON stream: stage -> token -> done, in order, with the done-event key set", () => {
    const streamingBlock = src.slice(src.indexOf("--- Streaming (opt-in via {stream: true}) ---"));
    const stageIdx = streamingBlock.indexOf('type: "stage"');
    const tokenIdx = streamingBlock.indexOf('type: "token"');
    const doneIdx = streamingBlock.indexOf('type: "done"');
    assert.ok(stageIdx >= 0 && tokenIdx >= 0 && doneIdx >= 0, "all three event types must be present");
    assert.ok(stageIdx < tokenIdx && tokenIdx < doneIdx, "events must be emitted stage -> token -> done, in that order");

    assert.match(
      streamingBlock,
      /ndjson\(\s*\{\s*type:\s*"done",\s*conversationId,\s*ragApplied,\s*sources,\s*webSources,\s*knowledge:\s*knowledgeMeta,?\s*\}\s*\)/,
      "the `done` event literal must match exactly",
    );
  });

  test("ChatSource shape unchanged (Sources-panel contract)", () => {
    const m = src.match(/interface ChatSource \{([\s\S]*?)\n\}/);
    assert.ok(m, "ChatSource interface not found");
    assert.deepEqual(objectKeys(`{${m![1]}}`), ["knowledgeId", "title", "chunkId", "chunkIndex", "similarity", "snippet"]);
  });

  test("knowledgeMeta shape unchanged (`knowledge` field on the wire)", () => {
    const m = src.match(/const knowledgeMeta = \{([\s\S]*?)\};/);
    assert.ok(m, "knowledgeMeta literal not found");
    assert.deepEqual(objectKeys(`{${m![1]}}`), ["sourceClass", "provider", "webSearchUsed", "webSearchRequestedButUnavailable"]);
  });

  test("webSources mapping shape unchanged (`webSources` field on the wire)", () => {
    const m = src.match(/const webSources = result\.sources[\s\S]*?\.map\(\(s\) => \(\{([\s\S]*?)\}\)\);/);
    assert.ok(m, "webSources mapping not found");
    assert.deepEqual(objectKeys(`{${m![1]}}`), ["url", "title", "citedText"]);
  });

  // ── the market-intelligence branch — K3-C touched NOTHING here ────────
  test("market-intelligence non-stream envelope BYTE IDENTICAL (K3-C did not touch this path)", () => {
    assert.match(
      src,
      /content:\s*finalAnswer,\s*ragApplied:\s*false,\s*sourcesCount:\s*0,\s*sources:\s*\[\],\s*conversationId,\s*intelligence:\s*intelligenceMeta\s*\}/,
    );
  });

  test("market-intelligence NDJSON `done` event BYTE IDENTICAL", () => {
    assert.match(
      src,
      /ndjson\(\{\s*type:\s*"done",\s*conversationId,\s*ragApplied:\s*false,\s*sources:\s*\[\],\s*intelligence:\s*intelligenceMeta\s*\}\)/,
    );
  });

  // ── the route only reads AnswerResult fields that actually exist ─────
  test("route reads only real AnswerResult fields (no stale/typo'd access)", () => {
    const knownFields = new Set([
      "text",
      "sourceClass",
      "providerUsed",
      "webSearchUsed",
      "webSearchRequestedButUnavailable",
      "sources",
      "retrievalSufficiency",
      "classification",
      "fromCache",
      "integrityPassed",
      "latencyMs",
      "provenanceId",
    ]);
    const accesses = [...src.matchAll(/\bresult\.(\w+)/g)].map((m) => m[1]);
    assert.ok(accesses.length > 0, "expected at least one result.<field> access");
    for (const f of accesses) {
      assert.ok(knownFields.has(f), `route reads result.${f}, which is not a field on AnswerResult`);
    }
  });

  test("route still imports the typed AnswerResult (not `any`)", () => {
    assert.match(src, /import type \{ AnswerResult \} from "@\/types\/knowledge-loop";/);
  });

  // ── boundary — zero orchestrator coupling outside this one route ─────
  test("BOUNDARY: services/ai/assistant.service.ts imports NOTHING from services/knowledge-loop/orchestrator", () => {
    const p = join(ROOT, "services", "ai", "assistant.service.ts");
    assert.doesNotMatch(readFileSync(p, "utf8"), /services\/knowledge-loop\/orchestrator/);
  });

  test("BOUNDARY: no file under services/intelligence/** imports services/knowledge-loop/orchestrator", () => {
    const files = walk(join(ROOT, "services", "intelligence"));
    for (const f of files) {
      assert.doesNotMatch(
        readFileSync(f, "utf8"),
        /services\/knowledge-loop\/orchestrator/,
        `${f} imports the knowledge-loop orchestrator — market-intel path must stay independent`,
      );
    }
  });

  test("BOUNDARY: research-knowledge-search.tool.ts imports NOTHING from services/knowledge-loop/orchestrator", () => {
    const p = join(ROOT, "services", "agent-framework", "tools", "impl", "research-knowledge-search.tool.ts");
    assert.doesNotMatch(readFileSync(p, "utf8"), /services\/knowledge-loop\/orchestrator/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
