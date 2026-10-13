// Trading Copilot on the platform evidence engine: context sources feed the analysis and the
// AI prompt, failures/timeouts/unconfigured sources only remove context, and a busy AI is
// reported in plain words. Offline: fake data provider, fake sources, fake AI.
import assert from "node:assert/strict";
import { TradingCopilotService } from "../services/ai/trading-copilot.service";
import { MarketContextBuilderService } from "../services/ai/market-context-builder.service";
import { collectContextEvidence, contextLabel } from "../services/evidence-sources/collect-context";
import type { EvidenceExtraSource } from "../types/evidence-fusion";
import type { EvidenceItem } from "../types/evidence";
import type { MarketSnapshot } from "../types/market-snapshot";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${(e as Error).message}`);
  }
}

const NOW = new Date().toISOString();
const item = (type: EvidenceItem["type"], claim: string): EvidenceItem => ({ type, symbol: "XAUUSD", claim, source: "x", asOf: NOW, retrievedAt: NOW });
const src = (name: string, items: EvidenceItem[] | "throw" | "hang", configured = true): EvidenceExtraSource => ({
  name,
  sourceType: "macro-drivers",
  isConfigured: () => configured,
  collect: async () => {
    if (items === "throw") throw new Error("boom");
    if (items === "hang") return new Promise<EvidenceItem[]>(() => {});
    return items;
  },
});

const snapshot: MarketSnapshot = {
  symbol: "XAUUSD", assetClass: "commodities", price: 4150, quoteCurrency: "USD", timestamp: NOW, timezone: "UTC",
  marketStatus: "open", provider: "fake", retrievedAt: NOW,
} as MarketSnapshot;
const data = { name: "fake", isConfigured: () => true, getSnapshot: async () => snapshot, getTimeSeries: async () => [] } as never;

async function main() {
  await test("collect: failed, hanging and unconfigured sources contribute nothing; the rest are kept", async () => {
    const out = await collectContextEvidence(
      [src("a", [item("macro", "CPI in 3h")]), src("b", "throw"), src("c", "hang"), src("d", [item("news", "x")], false)],
      "XAUUSD",
      50,
    );
    assert.deepEqual(out.map((i) => i.claim), ["CPI in 3h"]);
  });

  await test("labels: calendar / macro drivers / market structure / news", () => {
    assert.equal(contextLabel("macro"), "Economic calendar");
    assert.equal(contextLabel("cross-asset"), "Macro drivers");
    assert.equal(contextLabel("technical"), "Market structure");
    assert.equal(contextLabel("news"), "News");
  });

  await test("copilot: context reaches the analysis and the AI prompt; no sources = no context", async () => {
    let prompt = "";
    const ai = { complete: async (p: string) => { prompt = p; return { content: "**Summary**\nok" } as never; } };
    const withCtx = new TradingCopilotService(data, undefined, new MarketContextBuilderService(data, ai), [
      src("a", [item("macro", "US CPI due in 3h"), item("technical", "1h structure is bullish")]),
    ]);
    const out = await withCtx.analyze({ symbol: "XAUUSD" });
    assert.equal(out.status, "completed");
    if (out.status !== "completed") return;
    assert.deepEqual(out.analysis.context?.map((c) => c.label), ["Economic calendar", "Market structure"]);
    assert.ok(prompt.includes("US CPI due in 3h") && prompt.includes("marketContext"));
    assert.ok(/\*\*Summary\*\*/.test(prompt), "prompt asks for the brief format");

    prompt = "";
    const bare = new TradingCopilotService(data, undefined, new MarketContextBuilderService(data, ai));
    const out2 = await bare.analyze({ symbol: "XAUUSD" });
    assert.equal(out2.status === "completed" && out2.analysis.context?.length, 0);
    assert.ok(!prompt.includes("marketContext\""));
  });

  await test("copilot: an AI failure keeps the computed analysis and context (ai-failed)", async () => {
    const ai = { complete: async () => { throw new Error("nope"); } };
    const svc = new TradingCopilotService(data, undefined, new MarketContextBuilderService(data, ai), [src("a", [item("macro", "CPI")])]);
    const out = await svc.analyze({ symbol: "XAUUSD" });
    assert.equal(out.status === "completed" && out.analysis.aiStatus, "ai-failed");
    assert.equal(out.status === "completed" && out.analysis.context?.length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}
main();
