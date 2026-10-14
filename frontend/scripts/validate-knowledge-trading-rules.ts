// scripts/validate-knowledge-trading-rules.ts - "My Trading Rules" document builder + validation + the delete route's guards. Pure. `npm run validate:knowledge-trading-rules`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMPTY_TRADING_RULES,
  TRADING_RULES_TITLE,
  buildTradingRulesMarkdown,
  validateTradingRules,
  type TradingRulesForm,
} from "../lib/knowledge/trading-rules";

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

const full: TradingRulesForm = {
  riskPerTradePct: "1",
  dailyLossPct: "3%",
  maxDrawdownPct: "8",
  instruments: "XAUUSD, EURUSD",
  sessions: "London and New York only",
  noTradeRules: "No trading 30 min around high-impact news.\nStop after two losses in a row.",
  propFirm: "ExampleFirm",
  propFirmRules: "Daily loss 5%. Max loss 10%.",
  otherRules: "Never move a stop loss further away.",
};

console.log("validate-knowledge-trading-rules\n");

test("an empty form is rejected; any single filled field is enough", () => {
  assert.deepEqual(validateTradingRules(EMPTY_TRADING_RULES), ["Fill in at least one rule."]);
  assert.deepEqual(validateTradingRules({ ...EMPTY_TRADING_RULES, otherRules: "x" }), []);
});

test("percent fields must be numbers in (0, 100]; a trailing % is accepted", () => {
  assert.deepEqual(validateTradingRules(full), []);
  for (const bad of ["0", "-1", "101", "abc", "1e9"]) {
    assert.equal(validateTradingRules({ ...full, riskPerTradePct: bad }).length, 1, bad);
  }
});

test("over-long fields are rejected", () => {
  assert.equal(validateTradingRules({ ...full, otherRules: "x".repeat(4001) }).length, 1);
});

test("the document restates exactly what was typed, under plain headings", () => {
  const md = buildTradingRulesMarkdown(full);
  assert.ok(md.startsWith(`# ${TRADING_RULES_TITLE}`));
  for (const needle of [
    "- Risk per trade: 1% of the account",
    "- Daily loss limit: 3% of the account",
    "- Maximum drawdown: 8% of the account",
    "- Instruments I trade: XAUUSD, EURUSD",
    "- Sessions / times I trade: London and New York only",
    "## When I do not trade",
    "Stop after two losses in a row.",
    "## Prop firm: ExampleFirm",
    "Daily loss 5%. Max loss 10%.",
    "## Other rules",
    "Never move a stop loss further away.",
  ]) {
    assert.ok(md.includes(needle), `missing: ${needle}`);
  }
});

test("only filled fields appear (no empty headings, no invented rules)", () => {
  const md = buildTradingRulesMarkdown({ ...EMPTY_TRADING_RULES, riskPerTradePct: "2" });
  assert.ok(md.includes("## Risk limits") && md.includes("- Risk per trade: 2%"));
  for (const h of ["Daily loss limit", "## When I do not trade", "## Prop firm", "## Other rules", "Instruments"]) {
    assert.ok(!md.includes(h), `unexpected: ${h}`);
  }
});

test("a prop firm with no rules text is flagged as 'terms not added', never filled in", () => {
  const md = buildTradingRulesMarkdown({ ...EMPTY_TRADING_RULES, propFirm: "ExampleFirm" });
  assert.ok(md.includes("## Prop firm: ExampleFirm") && md.includes("No rules text was added"));
});

test("the document tells the AI not to invent rules", () => {
  assert.ok(buildTradingRulesMarkdown(full).includes("Do not invent rules"));
});

const root = join(__dirname, "..");
test("DELETE route: session user only, ownership-scoped soft delete, 404 (not 403) for someone else's id", () => {
  const route = readFileSync(join(root, "app/api/private/knowledge/[knowledgeId]/route.ts"), "utf8");
  assert.ok(route.includes("getUserOrNull()") && route.includes("401"));
  assert.ok(route.includes("where: { id: knowledgeId, userId, deletedAt: null }"));
  assert.ok(route.includes("data: { deletedAt: new Date() }") && !route.includes(".delete("));
  assert.ok(route.includes('"NOT_FOUND"') && !route.includes("403,") && !route.includes("FORBIDDEN"));
});

test("retrieval SQL excludes deleted documents, so a deleted document stops being used by Ask AI", () => {
  const sql = readFileSync(join(root, "repositories/VectorRepository.ts"), "utf8");
  assert.ok(sql.includes('k."deletedAt" IS NULL'));
});

test("the page saves new rules before deleting the old ones, and the unused static Sources panel is gone", () => {
  const page = readFileSync(join(root, "app/dashboard/knowledge/page.tsx"), "utf8");
  assert.ok(page.indexOf("KnowledgeApi.uploadDocument({ file, title: TRADING_RULES_TITLE") < page.indexOf("previous.map((id) => KnowledgeApi.deleteDocument(id)"));
  assert.ok(!page.includes("KnowledgeSources"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
