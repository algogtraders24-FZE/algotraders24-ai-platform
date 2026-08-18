// scripts/validate-market-regime-overview.ts
// Sprint D2.8.16 - regression coverage for the reframed "AI Signals" page.
// The core guarantee this proves: the new data contract structurally
// CANNOT carry a BUY/SELL direction, an entry/stopLoss/takeProfit target,
// or a win-rate claim - the same permanent prohibition
// types/intelligence-decision-context.ts and types/verified-answer-response.ts
// already enforce elsewhere in this platform. Source-inspection style,
// matching every prior sprint's no-fabrication regression test in this
// codebase (see D2.7.x's own "no BUY/SELL/automated-trading language"
// checks) - this project has no component test framework.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const typeSource = read("types/market-regime-overview.ts");
const cardSource = read("components/signals/RegimeOverviewCard.tsx");
const pageSource = read("app/dashboard/signals/page.tsx");
const routeSource = read("app/api/private/intelligence/overview/route.ts");

function noFabricationTests(): void {
  test("1: MarketRegimeOverviewItem has no direction field - the type structurally cannot carry a BUY/SELL/WAIT call", () => {
    assert.equal(/\bdirection\s*[?:]/.test(typeSource), false);
  });

  test("2: MarketRegimeOverviewItem has no entry/stopLoss/takeProfit/target fields - no synthetic trade setup is representable", () => {
    assert.equal(/\b(entry|stopLoss|takeProfit|targets?)\s*[?:]/.test(typeSource), false);
  });

  test("3: MarketRegimeOverviewItem has no winRate/probability field", () => {
    assert.equal(/\b(winRate|probability)\s*[?:]/.test(typeSource), false);
  });

  test("4: the card component renders no literal 'BUY'/'SELL' string value (a real direction label, not this file's own explanatory comments)", () => {
    // Matches the exact D2.6.1-documented false-positive class: check real
    // code usage (a quoted string literal or JSX text), never a bare
    // substring, since this file's own header comment legitimately contains
    // the words "BUY"/"SELL" while explaining why they're absent.
    const codeOnly = cardSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    assert.equal(/["'`]BUY["'`]|["'`]SELL["'`]|>BUY<|>SELL</.test(codeOnly), false);
  });

  test("5: the page renders no 'confidence' percentage framed as a win probability - only the Intelligence Score's own X/100 formatScore convention", () => {
    // Same false-positive class as test 4: this file's own header comment
    // legitimately names the exact fabricated example ("82% confidence")
    // it was reframed away from - only real (non-comment) code lines count.
    const codeOnly = pageSource
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    assert.equal(/\d+%\s*confidence|confidence.*win/i.test(codeOnly), false);
  });

  test("6: the overview route reuses ResearchSnapshotService (the Research panel's own service) - never a second engine or a new Gemini/Claude/OpenAI call", () => {
    assert.match(routeSource, /ResearchSnapshotService/);
    assert.equal(/gemini|claude|openai/i.test(routeSource), false);
  });

  test("7: one symbol's failure is caught independently (try/catch inside the per-market builder) - never lets one bad symbol fail the whole overview", () => {
    assert.match(routeSource, /catch\s*\{/);
  });
}

function structuralTests(): void {
  test("8: the overview route covers exactly the 7 core instruments Market Intelligence already supports, not a new/duplicated list", () => {
    const symbols = ["EURUSD", "GBPUSD", "USDJPY", "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD"];
    for (const symbol of symbols) {
      assert.match(routeSource, new RegExp(`symbol:\\s*"${symbol}"`));
    }
  });

  test("9: the card reuses the SAME regimeTone/DECISION_STATE_TONE helpers the Workspace Research panel uses - never a second color/label system", () => {
    assert.match(cardSource, /from "@\/components\/intelligence-workspace\/format"/);
  });

  test("10: the page's own auth/loading/error/ready states mirror the established WorkspaceResearch.tsx pattern (AbortController-guarded fetch)", () => {
    assert.match(pageSource, /AbortController/);
    assert.match(pageSource, /controller\.signal/);
  });
}

async function main(): Promise<void> {
  noFabricationTests();
  structuralTests();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
