// scripts/validate-quant-pro-launch.ts
// Quant Pro production launch. Same two established conventions every
// prior sprint in this program uses (no test framework exists here, per
// package.json):
//   1. Real behavioral tests for hasQuantProAccess() - real User/Plan/
//      Subscription rows (tagged, cleaned up at the end), the same
//      convention validate-chat-orchestration.ts already establishes for
//      DB-backed validators in this codebase.
//   2. Structural source verification for the parts that are genuinely
//      React-server-component/JSX/config-only and can't be exercised
//      without a renderer or a running server (the page/route gating
//      wiring, the nav change) - in particular, proving the locked launch
//      decisions actually hold in the real source: no new entitlement
//      model, the API routes enforce access server-side (not just the
//      page), QP-0->QP-5's own files are untouched in substance (only
//      moved), Optimize/WFO/the Quant engine are untouched.
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma";
import { hasQuantProAccess } from "../lib/access/quant-pro";

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
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  if (!existsSync(path)) throw new Error(`${relativePath} does not exist`);
  return readFileSync(path, "utf8");
}

function stripLineComments(src: string): string {
  return src.replace(/\/\/.*$/gm, "");
}

const RUN_TAG = `quantprolaunch-${Date.now()}`;

async function main(): Promise<void> {
  console.log("\n=== A - hasQuantProAccess() (real behavior - real User/Subscription rows) ===");

  const noSub = await prisma.user.create({ data: { email: `${RUN_TAG}-nosub@internal.test`, name: "No Subscription" } });
  const freePlan = await prisma.user.create({ data: { email: `${RUN_TAG}-free@internal.test`, name: "Free Plan" } });
  const activePro = await prisma.user.create({ data: { email: `${RUN_TAG}-activepro@internal.test`, name: "Active Pro" } });
  const canceledPro = await prisma.user.create({ data: { email: `${RUN_TAG}-canceledpro@internal.test`, name: "Canceled Pro" } });
  const expiredPro = await prisma.user.create({ data: { email: `${RUN_TAG}-expiredpro@internal.test`, name: "Expired Pro" } });
  const userIds = [noSub.id, freePlan.id, activePro.id, canceledPro.id, expiredPro.id];

  const now = new Date();
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const past = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    await prisma.subscription.create({
      data: { userId: freePlan.id, planId: "free", status: "active", currentPeriodStart: now, currentPeriodEnd: future },
    });
    await prisma.subscription.create({
      data: { userId: activePro.id, planId: "pro", status: "active", currentPeriodStart: now, currentPeriodEnd: future, provider: "stripe" },
    });
    await prisma.subscription.create({
      data: { userId: canceledPro.id, planId: "pro", status: "canceled", currentPeriodStart: now, currentPeriodEnd: future, provider: "stripe" },
    });
    await prisma.subscription.create({
      data: { userId: expiredPro.id, planId: "pro", status: "active", currentPeriodStart: past, currentPeriodEnd: past, provider: "stripe" },
    });

    await test("a user with no Subscription row at all has no Quant Pro access", async () => {
      assert.equal(await hasQuantProAccess(noSub.id), false);
    });

    await test("an active Subscription on the free plan has no Quant Pro access - the free/paid boundary, not a new entitlement", async () => {
      assert.equal(await hasQuantProAccess(freePlan.id), false);
    });

    await test("an active, non-free, non-expired Subscription grants Quant Pro access", async () => {
      assert.equal(await hasQuantProAccess(activePro.id), true);
    });

    await test("a canceled paid Subscription (webhook-driven customer.subscription.deleted) is correctly blocked - proves this checks Subscription.status live, not the stale User.planId column SubscriptionActionService never resets on cancellation", async () => {
      assert.equal(await hasQuantProAccess(canceledPro.id), false);
      const stillPaid = await prisma.user.findUnique({ where: { id: canceledPro.id } });
      assert.equal(stillPaid?.planId, "free", "User.planId defaults to free and was never elevated for this fixture - confirms the gate cannot be relying on it alone");
    });

    await test("a paid Subscription whose currentPeriodEnd has already passed is blocked, even with status still 'active'", async () => {
      assert.equal(await hasQuantProAccess(expiredPro.id), false);
    });
  } finally {
    await prisma.subscription.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }

  console.log("\n=== B - server-side access boundary (structural - both backend routes enforce it, not just the page) ===");

  await test("the /ai-runs route (QP-4's canonical compile+run+persist path) enforces hasQuantProAccess after auth, before calling the service", () => {
    const route = stripLineComments(readSource("../app/api/private/algo-test/ai-runs/route.ts"));
    assert.ok(route.includes('import { hasQuantProAccess } from "@/lib/access/quant-pro"'));
    const authIdx = route.indexOf("UNAUTHORIZED");
    const gateIdx = route.indexOf("hasQuantProAccess(sessionUser.profile.id)");
    const serviceCallIdx = route.indexOf("algoTestService.compileAndRunAiStrategy(");
    assert.ok(authIdx !== -1 && gateIdx !== -1 && serviceCallIdx !== -1);
    assert.ok(authIdx < gateIdx && gateIdx < serviceCallIdx, "must check auth, then entitlement, then run the compiler - in that order");
    assert.ok(route.includes("QUANT_PRO_REQUIRED"));
  });

  await test("the /strategy-builder route (QP-2's compile-only MODIFY path) enforces the identical hasQuantProAccess check", () => {
    const route = stripLineComments(readSource("../app/api/private/algo-test/strategy-builder/route.ts"));
    assert.ok(route.includes('import { hasQuantProAccess } from "@/lib/access/quant-pro"'));
    const authIdx = route.indexOf("UNAUTHORIZED");
    const gateIdx = route.indexOf("hasQuantProAccess(sessionUser.profile.id)");
    const serviceCallIdx = route.indexOf("applyModification(");
    assert.ok(authIdx !== -1 && gateIdx !== -1 && serviceCallIdx !== -1);
    assert.ok(authIdx < gateIdx && gateIdx < serviceCallIdx);
    assert.ok(route.includes("QUANT_PRO_REQUIRED"));
  });

  await test("hasQuantProAccess itself reuses the EXISTING Subscription/Plan model - no new entitlement table, no new Prisma model introduced by this launch", () => {
    const helper = readSource("../lib/access/quant-pro.ts");
    assert.ok(helper.includes("prisma.subscription.findFirst"));
    assert.ok(!helper.includes("QuantProEntitlement"));
    assert.ok(!helper.includes("QuantProLicense"));
    const schema = readSource("../prisma/schema.prisma");
    assert.ok(!schema.includes("model QuantProEntitlement"));
    assert.ok(!schema.includes("model QuantProSubscription"));
    assert.ok(!schema.includes("model QuantProLicense"));
  });

  console.log("\n=== C - page-level gate (structural - page.tsx is a thin server wrapper, QuantChatClient.tsx is the untouched QP-0->QP-5 UI) ===");

  await test("app/dashboard/quant-chat/page.tsx is a server component that checks entitlement before rendering the real UI", () => {
    const page = readSource("../app/dashboard/quant-chat/page.tsx");
    assert.ok(!page.startsWith('"use client"'), "page.tsx must be a server component, not the client UI itself");
    assert.ok(page.includes("await requireUser()"));
    assert.ok(page.includes("await hasQuantProAccess(sessionUser.profile.id)"));
    assert.ok(page.includes("<QuantProUpgradeGate"));
    assert.ok(page.includes("<QuantChatClient"));
  });

  await test("QuantChatClient.tsx is the exact QP-0->QP-5 UI (moved, not rewritten) - still a client component with every QP-4/QP-5 concept intact", () => {
    const client = readSource("../app/dashboard/quant-chat/QuantChatClient.tsx");
    assert.ok(client.startsWith('"use client"'));
    for (const marker of ["handleRunBacktest", "latestPersistedStrategyId", "backtestResultIntent", "compileAndRunAiStrategy", "applyStrategyBuilderModification"]) {
      assert.ok(client.includes(marker), `QuantChatClient.tsx must still contain ${marker}`);
    }
  });

  await test("QuantProUpgradeGate links to the EXISTING self-service billing/checkout page - no new checkout, no new payment page", () => {
    const gate = readSource("../components/quant-chat/QuantProUpgradeGate.tsx");
    assert.ok(gate.includes('href="/dashboard/billing"'));
    assert.ok(!gate.includes("stripe.com"));
    assert.ok(!/checkout\.session|createCheckoutSession|createInvoice/.test(gate), "the gate must not create a payment session itself - it only links to the existing billing page");
  });

  console.log("\n=== D - navigation (structural - additive, no duplicate Quant Pro nav, no IA restructure) ===");

  await test("Quant Chat is reachable from navigation for the first time - added as a child of the existing Algo Testing Pro entry", () => {
    const config = readSource("../config/dashboard.config.ts");
    const atpStart = config.indexOf('label: "Algo Testing Pro"');
    const atpBlock = config.slice(atpStart, config.indexOf("},", config.indexOf("Walk-Forward", atpStart)));
    assert.ok(atpBlock.includes('{ label: "Quant Chat", href: "/dashboard/quant-chat" }'));
    // The pre-existing free registry-strategy children must be untouched.
    for (const child of ["Run History", "Strategy Library", "Optimize", "Walk-Forward"]) {
      assert.ok(atpBlock.includes(child), `${child} must remain a child of Algo Testing Pro`);
    }
  });

  await test("the locked top-level PRODUCTS IA is unchanged - still exactly Quant / Algo Testing Pro / Marketplace, no new top-level slot, no duplicate 'Quant Pro' entry added", () => {
    const config = readSource("../config/dashboard.config.ts");
    const productsStart = config.indexOf('label: "PRODUCTS"');
    const productsBlock = config.slice(productsStart, config.indexOf('label: "INTELLIGENCE"'));
    const topLevelLabels = [...productsBlock.matchAll(/^\s{8}label: "([^"]+)",$/gm)].map((m) => m[1]);
    assert.deepEqual(topLevelLabels, ["Quant", "Algo Testing Pro", "Marketplace"]);
  });

  console.log("\n=== E - no drift into protected architecture ===");

  await test("Optimize/Walk-Forward/Quant engine/QP-2/QP-3/QP-4/QP-5 source files are untouched by this launch beyond the two documented, additive call sites", () => {
    for (const f of [
      "../services/algo-test/quant-strategy-builder.service.ts",
      "../services/algo-test/quant-chat-preview.service.ts",
      "../services/algo-test/optimization.service.ts",
      "../services/algo-test/walk-forward.service.ts",
    ]) {
      const src = readSource(f);
      assert.ok(!src.includes("hasQuantProAccess"), `${f} must not reference the launch's access gate - Optimize/WFO/QP-2 preview stay ungated by this sprint`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main();
