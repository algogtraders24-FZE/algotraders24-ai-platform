// scripts/validate-bonus-credits.ts
// No database: runs the bonus-credit rules and service against the in-memory store.
//   npx tsx scripts/validate-bonus-credits.ts
import assert from "node:assert/strict";
import { BONUS_RULES, BONUS_EXPIRY_DAYS, CHECKLIST_KINDS, activeRemaining, bonusExpiry, isBonusKind, maxLifetimeBonus } from "../lib/credits/bonus";
import { memoryBonusStore } from "../services/credits/bonusStore";
import { awardBonus, consumeBonusCredit, ensureSignupBonuses, getBonusSummary } from "../services/credits/bonusCredits";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL - ${name}\n    ${e instanceof Error ? e.message : e}`);
  }
}

const NOW = new Date("2026-10-21T00:00:00Z");

async function main() {
  await test("amounts are the owner's: email 50, KYC 200, Telegram 25, referred 100; KYC is the biggest step", () => {
    assert.equal(BONUS_RULES.EMAIL_VERIFIED.amount, 50);
    assert.equal(BONUS_RULES.KYC_VERIFIED.amount, 200);
    assert.equal(BONUS_RULES.TELEGRAM_LINKED.amount, 25);
    assert.equal(BONUS_RULES.REFERRED_SIGNUP.amount, 100);
    assert.equal(maxLifetimeBonus(), 375);
    assert.ok(CHECKLIST_KINDS.every((k) => BONUS_RULES[k].amount <= BONUS_RULES.KYC_VERIFIED.amount));
    assert.ok(!CHECKLIST_KINDS.includes("REFERRED_SIGNUP"), "the referred bonus is automatic, not a checklist step");
  });

  await test("expiry is 90 days; isBonusKind accepts only real kinds", () => {
    assert.equal(BONUS_EXPIRY_DAYS, 90);
    assert.equal(bonusExpiry(NOW).toISOString(), "2027-01-19T00:00:00.000Z");
    assert.ok(isBonusKind("EMAIL_VERIFIED") && !isBonusKind("toString") && !isBonusKind(5));
  });

  await test("a step pays once per account, even when asked twice", async () => {
    const store = memoryBonusStore();
    assert.equal(await awardBonus("u1", "EMAIL_VERIFIED", { store, now: NOW }), true);
    assert.equal(await awardBonus("u1", "EMAIL_VERIFIED", { store, now: NOW }), false);
    assert.equal(await awardBonus("u2", "EMAIL_VERIFIED", { store, now: NOW }), true);
    assert.equal(store.rows.filter((r) => r.userId === "u1").length, 1);
  });

  await test("unverified email earns nothing; verified pays the email step; a friend's link adds the referred bonus", async () => {
    const store = memoryBonusStore();
    await ensureSignupBonuses("a", false, { store, referred: async () => true, existing: async () => [] });
    assert.equal(store.rows.length, 0);
    await ensureSignupBonuses("b", true, { store, referred: async () => false, existing: async () => [] });
    assert.deepEqual(store.rows.filter((r) => r.userId === "b").map((r) => r.kind), ["EMAIL_VERIFIED"]);
    await ensureSignupBonuses("c", true, { store, referred: async () => true, existing: async () => [] });
    assert.deepEqual(store.rows.filter((r) => r.userId === "c").map((r) => r.kind).sort(), ["EMAIL_VERIFIED", "REFERRED_SIGNUP"]);
    assert.equal(activeRemaining(store.rows.filter((r) => r.userId === "c"), new Date()), 150);
  });

  await test("steps completed before bonus credits existed are paid once, on the first verified request", async () => {
    const store = memoryBonusStore();
    await ensureSignupBonuses("old-user", true, { store, referred: async () => false, existing: async () => ["KYC_VERIFIED", "TELEGRAM_LINKED"] });
    assert.deepEqual(store.rows.filter((r) => r.userId === "old-user").map((r) => r.kind).sort(), ["EMAIL_VERIFIED", "KYC_VERIFIED", "TELEGRAM_LINKED"]);
    assert.equal(activeRemaining(store.rows.filter((r) => r.userId === "old-user"), new Date()), 275);
    // a later identical request (new process memo aside) can never pay a step twice
    await awardBonus("old-user", "KYC_VERIFIED", { store });
    assert.equal(store.rows.filter((r) => r.userId === "old-user").length, 3);
    // and an unverified email still earns nothing, even when other steps are done
    await ensureSignupBonuses("unverified", false, { store, existing: async () => ["KYC_VERIFIED"] });
    assert.equal(store.rows.filter((r) => r.userId === "unverified").length, 0);
  });

  await test("a transient failure is retried on the next request instead of being remembered as done", async () => {
    const store = memoryBonusStore();
    let calls = 0;
    const flaky = async () => {
      calls++;
      if (calls === 1) throw new Error("db hiccup");
      return ["KYC_VERIFIED"] as const;
    };
    await ensureSignupBonuses("retry-user", true, { store, referred: async () => false, existing: flaky as never });
    assert.equal(store.rows.filter((r) => r.userId === "retry-user" && r.kind === "KYC_VERIFIED").length, 0, "nothing paid yet");
    await ensureSignupBonuses("retry-user", true, { store, referred: async () => false, existing: flaky as never });
    assert.ok(store.rows.some((r) => r.userId === "retry-user" && r.kind === "KYC_VERIFIED"), "second request pays it");
    const before = calls;
    await ensureSignupBonuses("retry-user", true, { store, referred: async () => false, existing: flaky as never });
    assert.equal(calls, before, "once it succeeded the user is settled and costs no more lookups");
  });

  await test("a failed GRANT also leaves the user unsettled", async () => {
    let n = 0;
    const store = { grant: async () => { n++; if (n === 1) throw new Error("write failed"); return true; }, consumeOne: async () => false, list: async () => [] };
    await ensureSignupBonuses("grant-retry", true, { store, referred: async () => false, existing: async () => [] });
    const after1 = n;
    await ensureSignupBonuses("grant-retry", true, { store, referred: async () => false, existing: async () => [] });
    assert.ok(n > after1, "retried after the failed grant");
  });

  await test("credits are spent one at a time, soonest-expiring first, and stop at zero", async () => {
    const store = memoryBonusStore();
    await store.grant("u", "TELEGRAM_LINKED", 2, new Date("2026-12-01T00:00:00Z"));
    await store.grant("u", "EMAIL_VERIFIED", 1, new Date("2026-11-01T00:00:00Z"));
    assert.equal(await consumeBonusCredit("u", { store, now: NOW }), true);
    assert.equal(store.rows.find((r) => r.kind === "EMAIL_VERIFIED")!.remaining, 0, "the earlier-expiring grant is used first");
    assert.equal(await consumeBonusCredit("u", { store, now: NOW }), true);
    assert.equal(await consumeBonusCredit("u", { store, now: NOW }), true);
    assert.equal(await consumeBonusCredit("u", { store, now: NOW }), false, "nothing left");
    assert.equal(await consumeBonusCredit("someone-else", { store, now: NOW }), false);
  });

  await test("expired credits cannot be spent and are not counted", async () => {
    const store = memoryBonusStore();
    await store.grant("u", "EMAIL_VERIFIED", 50, new Date("2026-10-20T00:00:00Z"));
    assert.equal(await consumeBonusCredit("u", { store, now: NOW }), false);
    const s = await getBonusSummary("u", { store, now: NOW });
    assert.equal(s.remaining, 0);
    assert.equal(s.nextExpiry, null);
  });

  await test("summary reports what was earned, what is left and the next expiry", async () => {
    const store = memoryBonusStore();
    await store.grant("u", "EMAIL_VERIFIED", 50, new Date("2027-01-01T00:00:00Z"));
    await store.grant("u", "KYC_VERIFIED", 200, new Date("2026-12-01T00:00:00Z"));
    await consumeBonusCredit("u", { store, now: NOW });
    const s = await getBonusSummary("u", { store, now: NOW });
    assert.equal(s.remaining, 249);
    assert.deepEqual([...s.earned].sort(), ["EMAIL_VERIFIED", "KYC_VERIFIED"]);
    assert.equal(s.nextExpiry, "2026-12-01T00:00:00.000Z");
  });

  await test("a store that throws never breaks the caller", async () => {
    const broken = { grant: async () => { throw new Error("no table"); }, consumeOne: async () => { throw new Error("no table"); }, list: async () => { throw new Error("no table"); } };
    assert.equal(await awardBonus("u", "KYC_VERIFIED", { store: broken }), false);
    assert.equal(await consumeBonusCredit("u", { store: broken }), false);
    assert.equal((await getBonusSummary("u", { store: broken })).remaining, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void main();
