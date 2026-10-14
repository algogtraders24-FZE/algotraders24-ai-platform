// scripts/validate-automation-delivery.ts
// AT24 Automation Phase 2 - result delivery (bell / Telegram / push).
// Pure/in-memory: every channel is an injected fake. `npm run validate:automation-delivery`.

import assert from "node:assert/strict";
import {
  resolveDeliveryChannels,
  buildDeliveryMessage,
  deliverRunResult,
  DELIVERY_NOTIFICATION_KIND,
  type DeliveryDeps,
} from "../services/automation/delivery";
import { composeAgentBrief } from "../services/automation/brief";
import { validateWorkflowDefinition } from "../services/automation/workflow-validator";

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

const MI = {
  kind: "market-intelligence-conclusion",
  symbol: "XAUUSD",
  timeframe: "1h",
  bias: "bearish-leaning",
  resolved: true,
  regimeType: "trending-bearish",
  regimeConfidence: 80,
  basis: ["regime: trending-bearish (confidence 80)", "Latest price is below EMA20."],
  disclaimer: "Decision support only.",
};
const EMPTY_RESEARCH = { kind: "research-brief", citationCount: 0, coverage: "no-coverage", sources: [] };

interface Spy {
  notified: { userId: string; kind: string; title: string; body: string; href: string }[];
  telegram: { userId: string; text: string }[];
  push: { userId: string; msg: { title: string; body: string; url: string; tag: string } }[];
  deps: DeliveryDeps;
}
function spy(over: Partial<DeliveryDeps> = {}): Spy {
  const s: Spy = { notified: [], telegram: [], push: [], deps: {} };
  s.deps = {
    siteUrl: "https://example.test",
    notify: async (p) => void s.notified.push(p),
    telegram: async (userId, text) => (s.telegram.push({ userId, text }), true),
    push: async (userId, msg) => (s.push.push({ userId, msg }), 1),
    ...over,
  };
  return s;
}

const input = (over: Record<string, unknown> = {}) => ({
  userId: "u1",
  automationId: "auto1",
  automationName: "Daily Market Brief",
  runId: "run1",
  definition: {},
  agentOutputs: [MI, EMPTY_RESEARCH],
  ...over,
});

async function main(): Promise<void> {
  console.log("validate-automation-delivery\n");

  await test("no delivery block -> in-app bell only; explicit [] -> off", () => {
    assert.deepEqual(resolveDeliveryChannels({}), ["bell"]);
    assert.deepEqual(resolveDeliveryChannels({ delivery: { channels: [] } }), []);
    assert.deepEqual(resolveDeliveryChannels({ delivery: { channels: ["push", "push", "telegram"] } }), ["push", "telegram"]);
  });

  await test("default run delivers to the bell only, with a link to the run", async () => {
    const s = spy();
    const r = await deliverRunResult(input(), s.deps);
    assert.equal(r.status, "delivered");
    assert.equal(s.notified.length, 1);
    assert.equal(s.notified[0].kind, DELIVERY_NOTIFICATION_KIND);
    assert.equal(s.notified[0].href, "/dashboard/automation/runs/run1");
    assert.ok(s.notified[0].body.includes("Gold (XAUUSD 1h): leaning bearish - trending down"));
    assert.equal(s.telegram.length + s.push.length, 0);
  });

  await test("all three channels fire when configured, scoped to the owner", async () => {
    const s = spy();
    const r = await deliverRunResult(input({ definition: { delivery: { channels: ["bell", "telegram", "push"] } } }), s.deps);
    assert.deepEqual(r.channels, { bell: true, telegram: true, push: 1 });
    assert.equal(s.telegram[0].userId, "u1");
    assert.equal(s.push[0].userId, "u1");
    assert.equal(s.push[0].msg.tag, "automation-auto1");
    assert.equal(s.push[0].msg.url, "/dashboard/automation/runs/run1");
  });

  await test("an all-empty result sends NOTHING (no daily 'no matching sources' ping)", async () => {
    const s = spy();
    const r = await deliverRunResult(input({ agentOutputs: [EMPTY_RESEARCH], definition: { delivery: { channels: ["bell", "telegram", "push"] } } }), s.deps);
    assert.equal(r.status, "skipped");
    assert.equal(r.reason, "nothing-to-report");
    assert.equal(s.notified.length + s.telegram.length + s.push.length, 0);
  });

  await test("delivery switched off sends nothing", async () => {
    const s = spy();
    const r = await deliverRunResult(input({ definition: { delivery: { channels: [] } } }), s.deps);
    assert.equal(r.reason, "delivery-off");
    assert.equal(s.notified.length, 0);
  });

  await test("a failing channel never throws and never blocks the others", async () => {
    const s = spy({
      telegram: async () => {
        throw new Error("telegram down");
      },
    });
    const r = await deliverRunResult(input({ definition: { delivery: { channels: ["telegram", "bell", "push"] } } }), s.deps);
    assert.equal(r.channels.telegram, false);
    assert.equal(r.channels.bell, true);
    assert.equal(r.channels.push, 1);
  });

  await test("Telegram HTML escapes everything user-controlled (automation name, agent text)", () => {
    const m = buildDeliveryMessage({
      automationName: "<script>alert(1)</script> & co",
      briefs: [composeAgentBrief({ ...MI, symbol: "<b>X</b>" })],
      href: "/dashboard/automation/runs/r",
      siteUrl: "https://example.test",
    })!;
    assert.ok(!m.telegramHtml.includes("<script>"));
    assert.ok(m.telegramHtml.includes("&lt;script&gt;"));
    assert.ok(!m.telegramHtml.includes("<b>X</b>"));
  });

  await test("every message carries the decision-support line; none gives a trade instruction", () => {
    const m = buildDeliveryMessage({ automationName: "A", briefs: [composeAgentBrief(MI)], href: "/x", siteUrl: "https://example.test" })!;
    assert.ok(m.telegramHtml.includes("Decision support only"));
    assert.ok(m.telegramHtml.includes("never trades for you"));
    assert.ok(!/\b(buy now|sell now|enter long|enter short)\b/i.test(m.telegramHtml));
  });

  await test("long content stays inside Telegram's limit", () => {
    const huge = composeAgentBrief({ ...MI, basis: Array.from({ length: 6 }, () => "y".repeat(220)) });
    const m = buildDeliveryMessage({ automationName: "A".repeat(500), briefs: [huge, huge, huge, huge], href: "/x", siteUrl: "https://example.test" })!;
    assert.ok(m.telegramHtml.length < 4096);
    assert.ok(m.short.length <= 560);
    assert.ok(m.title.length <= 120);
  });

  await test("validator accepts a good delivery block and rejects bad ones", () => {
    const base = { schemaVersion: 1, trigger: { type: "manual", timezone: "Asia/Kolkata" }, steps: [{ id: "s1", kind: "agent_run", action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD" } } }] };
    assert.equal(validateWorkflowDefinition({ ...base, delivery: { channels: ["bell", "push"] } }).ok, true);
    assert.equal(validateWorkflowDefinition({ ...base, delivery: { channels: [] } }).ok, true);
    assert.equal(validateWorkflowDefinition({ ...base, delivery: { channels: ["sms"] } }).ok, false);
    assert.equal(validateWorkflowDefinition({ ...base, delivery: { channels: ["bell", "bell"] } }).ok, false);
    assert.equal(validateWorkflowDefinition({ ...base, delivery: "bell" }).ok, false);
    assert.equal(validateWorkflowDefinition(base).ok, true); // delivery stays optional
  });

  // ── Brief v2 ──
  const onChange = { delivery: { channels: ["bell", "telegram"] as ("bell" | "telegram")[], mode: "on_change" as const } };

  await test("on_change: unchanged result sends nothing", async () => {
    const s = spy();
    const r = await deliverRunResult(input({ definition: onChange, agentOutputs: [MI], previousOutputs: [{ ...MI, regimeConfidence: 70 }] }), s.deps);
    assert.equal(r.status, "skipped");
    assert.equal(r.reason, "no-change");
    assert.equal(s.notified.length + s.telegram.length, 0);
  });

  await test("on_change: a changed bias is delivered, with the change note", async () => {
    const s = spy();
    const r = await deliverRunResult(input({ definition: onChange, agentOutputs: [MI], previousOutputs: [{ ...MI, bias: "bullish-leaning" }] }), s.deps);
    assert.equal(r.status, "delivered");
    assert.ok(s.notified[0].body.includes("Changed since the last brief: was leaning bullish, now leaning bearish."));
    assert.ok(s.telegram[0].text.includes("Changed since the last brief"));
  });

  await test("on_change: the FIRST run (no previous) is delivered, never swallowed", async () => {
    const s = spy();
    const r = await deliverRunResult(input({ definition: onChange, agentOutputs: [MI] }), s.deps);
    assert.equal(r.status, "delivered");
  });

  await test("mode 'always' (default) still delivers an unchanged result", async () => {
    const s = spy();
    const r = await deliverRunResult(input({ agentOutputs: [MI], previousOutputs: [MI] }), s.deps);
    assert.equal(r.status, "delivered");
    assert.ok(s.notified[0].body.includes("No change since the last brief."));
  });

  await test("enrich: price, macro line and today's events appear for gold MI; a throwing enrich is harmless", async () => {
    const extras = { priceLine: "Gold $4,166.15 (+0.40% today)", macroLine: "Macro alignment 75% - Supports gold (4/5 drivers)", smcLine: "Structure: bullish-leaning (developing), 62/100, 4h bullish - rule-based, not a signal", rangeLine: "Expected range (80% of past moves): 12h +/-18.69 (0.45%), 24h +/-27.00 (0.65%) - volatility, not a direction", levelsLine: "Key levels: PDH 4200.55 (56.50 above), PDL 4141.66 (2.30 below)", eventLines: ["19:30 IST (in 3h 20m) - USD CPI"] };
    const s = spy({ enrich: async () => extras });
    await deliverRunResult(input({ definition: { delivery: { channels: ["bell", "telegram"] } }, agentOutputs: [MI] }), s.deps);
    assert.ok(s.notified[0].body.includes("Gold $4,166.15"));
    assert.ok(s.notified[0].body.includes("Macro alignment 75%"));
    assert.ok(s.notified[0].body.includes("Structure: bullish-leaning"));
    assert.ok(s.notified[0].body.includes("Expected range (80% of past moves)") && s.notified[0].body.includes("Key levels: PDH"), "Brief 2.0 range and levels reach the bell");
    assert.ok(s.telegram[0].text.includes("Expected range (80% of past moves)") && s.telegram[0].text.includes("Key levels: PDH"));
    const order = ["Gold $4,166.15", "Expected range", "Key levels", "Macro alignment 75%", "Structure: bullish"].map((t) => s.telegram[0].text.indexOf(t));
    assert.ok(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1])), "lines appear in order: price, range, levels, macro, structure");
    assert.ok(s.telegram[0].text.includes("Structure: bullish-leaning"));
    assert.ok(s.telegram[0].text.includes("high-impact events"));
    assert.ok(s.telegram[0].text.includes("USD CPI"));

    const boom = spy({
      enrich: async () => {
        throw new Error("calendar down");
      },
    });
    const r = await deliverRunResult(input({ agentOutputs: [MI] }), boom.deps);
    assert.equal(r.status, "delivered");
    assert.ok(!boom.notified[0].body.includes("Macro alignment"));
  });

  await test("enrich is NOT called for an instrument without a macro profile", async () => {
    let called = 0;
    const s = spy({
      enrich: async () => {
        called += 1;
        return { priceLine: "Gold $1" };
      },
    });
    await deliverRunResult(input({ agentOutputs: [{ ...MI, symbol: "SOLUSD" }] }), s.deps);
    assert.equal(called, 0);
    assert.ok(!s.notified[0].body.includes("Gold $1"));
  });

  await test("enrich is called with the MI symbol for every asset that has a macro profile", async () => {
    const seen: string[] = [];
    for (const symbol of ["XAUUSD", "EURUSD", "USDJPY", "BTCUSD"]) {
      const s = spy({ enrich: async (sym) => (seen.push(sym), { macroLine: `Macro alignment for ${sym}` }) });
      await deliverRunResult(input({ agentOutputs: [{ ...MI, symbol }] }), s.deps);
      assert.ok(s.notified[0].body.includes(`Macro alignment for ${symbol}`));
    }
    assert.deepEqual(seen, ["XAUUSD", "EURUSD", "USDJPY", "BTCUSD"]);
  });

  await test("validator: delivery.mode accepts always/on_change, rejects anything else", () => {
    const base = { schemaVersion: 1, trigger: { type: "manual", timezone: "Asia/Kolkata" }, steps: [{ id: "s1", kind: "agent_run", action: { agentType: "MARKET_INTELLIGENCE", input: { symbol: "XAUUSD" } } }] };
    assert.equal(validateWorkflowDefinition({ ...base, delivery: { channels: ["bell"], mode: "on_change" } }).ok, true);
    assert.equal(validateWorkflowDefinition({ ...base, delivery: { channels: ["bell"], mode: "always" } }).ok, true);
    assert.equal(validateWorkflowDefinition({ ...base, delivery: { channels: ["bell"], mode: "sometimes" } }).ok, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("Validation script crashed:", err);
  process.exit(1);
});
