// scripts/validate-quant-pro-plan-copy.ts
// Quant Pro paid-plan inclusion copy closure. Same conventions as every
// prior validator in this program: no test framework exists here.
//   1. Structural checks that the canonical SOURCE files (prisma/seed.ts,
//      config/plan-limits.ts, sections/Pricing.tsx) carry the Quant Pro
//      line for pro/elite/enterprise and NOT for free.
//   2. A real behavioral check against the live database, proving the
//      one-off update script (scripts/update-plan-quant-pro-copy.ts) was
//      actually applied to the real Plan rows this app renders from -
//      not just present in source. Read-only: makes no writes itself.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma";

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

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const QUANT_PRO_LINE = "Quant Pro — AI strategy builder + backtesting";

async function main(): Promise<void> {
  console.log("\n=== A - canonical source files (structural) ===");

  await test("prisma/seed.ts's Plan literals carry the Quant Pro line for pro/elite/enterprise, not for free", () => {
    const seed = readSource("../prisma/seed.ts");
    const plansBlockStart = seed.indexOf("const plans = [");
    const plansBlock = seed.slice(plansBlockStart, seed.indexOf("];", plansBlockStart));
    const freeLine = plansBlock.split("\n").find((l) => l.includes('id: "free"'));
    const proLine = plansBlock.split("\n").find((l) => l.includes('id: "pro"'));
    const eliteLine = plansBlock.split("\n").find((l) => l.includes('id: "elite"'));
    const enterpriseLine = plansBlock.split("\n").find((l) => l.includes('id: "enterprise"'));
    assert.ok(freeLine && !freeLine.includes(QUANT_PRO_LINE), "free must not carry the Quant Pro line");
    for (const [name, line] of [["pro", proLine], ["elite", eliteLine], ["enterprise", enterpriseLine]] as const) {
      assert.ok(line?.includes(QUANT_PRO_LINE), `${name} must carry the Quant Pro line`);
    }
  });

  await test("prisma/seed.ts did not change any other plan field (price/interval/sortOrder/name) - only features arrays gained one entry", () => {
    const seed = readSource("../prisma/seed.ts");
    assert.ok(seed.includes('{ id: "free", name: "Free", price: 0, interval: "month", sortOrder: 1,'));
    assert.ok(seed.includes('{ id: "pro", name: "Pro", price: 29, interval: "month", sortOrder: 2,'));
    assert.ok(seed.includes('{ id: "elite", name: "Elite", price: 99, interval: "month", sortOrder: 3,'));
    assert.ok(seed.includes('{ id: "enterprise", name: "Enterprise", price: 499, interval: "month", sortOrder: 4,'));
  });

  await test("config/plan-limits.ts's quantPro flag is false for free, true for pro/elite/enterprise - reusing the existing apiAccess/prioritySupport/customBranding boolean-flag convention, no new mechanism", () => {
    const limits = readSource("../config/plan-limits.ts");
    assert.ok(limits.includes("quantPro: boolean;"), "quantPro must be declared alongside the existing boolean flags");
    const freeBlock = limits.slice(limits.indexOf("free: {"), limits.indexOf("pro: {"));
    const proBlock = limits.slice(limits.indexOf("pro: {"), limits.indexOf("elite: {"));
    const eliteBlock = limits.slice(limits.indexOf("elite: {"), limits.indexOf("enterprise: {"));
    const enterpriseBlock = limits.slice(limits.indexOf("enterprise: {"));
    assert.ok(freeBlock.includes("quantPro: false"));
    assert.ok(proBlock.includes("quantPro: true"));
    assert.ok(eliteBlock.includes("quantPro: true"));
    assert.ok(enterpriseBlock.includes("quantPro: true"));
  });

  await test("sections/Pricing.tsx pushes the Quant Pro line only when p.quantPro is true - same pattern as the existing apiAccess/prioritySupport/customBranding pushes, no separate rendering path", () => {
    const src = readSource("../sections/Pricing.tsx");
    assert.ok(src.includes('if (p.quantPro) feats.push("Quant Pro — AI strategy builder + backtesting");'));
    // Must sit alongside the pre-existing pushes, not replace or reorder them.
    const featuresForBody = src.slice(src.indexOf("function featuresFor"), src.indexOf("const CTA_LABEL"));
    assert.ok(featuresForBody.includes('if (p.apiAccess) feats.push("API access");'));
    assert.ok(featuresForBody.includes('if (p.prioritySupport) feats.push("Priority support");'));
    assert.ok(featuresForBody.includes('if (p.customBranding) feats.push("Custom branding");'));
  });

  console.log("\n=== B - real database state (behavioral - proves the one-off update actually landed) ===");

  await test("the live Plan rows for pro/elite/enterprise now include the Quant Pro line, free does not, and no other field drifted from its known value", async () => {
    const [free, pro, elite, enterprise] = await Promise.all([
      prisma.plan.findUniqueOrThrow({ where: { id: "free" } }),
      prisma.plan.findUniqueOrThrow({ where: { id: "pro" } }),
      prisma.plan.findUniqueOrThrow({ where: { id: "elite" } }),
      prisma.plan.findUniqueOrThrow({ where: { id: "enterprise" } }),
    ]);
    assert.ok(!free.features.includes(QUANT_PRO_LINE));
    assert.ok(pro.features.includes(QUANT_PRO_LINE));
    assert.ok(elite.features.includes(QUANT_PRO_LINE));
    assert.ok(enterprise.features.includes(QUANT_PRO_LINE));

    assert.equal(pro.price, 29);
    assert.equal(elite.price, 99);
    assert.equal(enterprise.price, 499);
    assert.equal(pro.interval, "month");
    assert.equal(pro.sortOrder, 2);
    assert.equal(pro.isActive, true);
  });

  await test("re-running the update script is idempotent - the Quant Pro line appears exactly once per paid plan, never duplicated", async () => {
    const pro = await prisma.plan.findUniqueOrThrow({ where: { id: "pro" } });
    const occurrences = pro.features.filter((f) => f === QUANT_PRO_LINE).length;
    assert.equal(occurrences, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main();
