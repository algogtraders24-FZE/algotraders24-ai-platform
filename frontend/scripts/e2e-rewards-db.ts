// scripts/e2e-rewards-db.ts
// End-to-end check of the Algo Contracts program against a SCRATCH database: slots, fulfilment, the daily sweep (with simulated time),
// freeze/unfreeze, referral commission, balances, USDT withdrawal, refund cancel, and the reserve identity.
// SAFETY: refuses to run unless DATABASE_URL points at localhost, and wipes the reward tables first. Never run it against a real database.
//   NODE_OPTIONS=--conditions=react-server DATABASE_URL=postgresql://test:test@localhost:54329/at24test npx tsx scripts/e2e-rewards-db.ts
// (react-server lets the server-only imports load outside Next.) The contract PDF step needs Supabase storage, so here it fails by design
// and the contract stays PENDING_DOCUMENT - the test then flips it ACTIVE, standing in for the issued PDF.
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at a local scratch database.");
  process.exit(2);
}
process.env.REWARDS_PROGRAM_MODE = "public";
process.env.REWARDS_WITHDRAWALS = "true";

import { prisma } from "../lib/prisma";
import { REWARD_PRODUCTS } from "../lib/rewards/config";
import { monthKey } from "../lib/rewards/slots";
import { addDays } from "../lib/rewards/money";
import { adminSetSlot, releaseHold, reserveSlot } from "../services/rewards/slotStore";
import { fulfilRewardCheckout } from "../services/rewards/fulfilmentService";
import { cancelContract, runRewardsSweep } from "../services/rewards/releaseService";
import { decideWithdrawal, getBalances, requestWithdrawal } from "../services/rewards/payoutStore";
import { ensureReferralCode } from "../services/rewards/referralStore";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

const TRC20 = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const btc = REWARD_PRODUCTS.BTC_AI_ALGO;
const T0 = new Date();
const later = (days: number) => addDays(T0, days);

async function wipe() {
  for (const t of ["reward_audit_events", "reward_download_logs", "reward_payouts", "reward_reserve_entries", "reward_ledger_entries", "referral_commissions", "referral_attributions", "referral_codes", "rebate_installments", "reward_contract_documents", "reward_contracts", "reward_checkouts", "reward_slot_holds", "reward_slot_months", "reward_products", "purchases", "seller_identities", "Subscription", "User"]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  }
}

async function mkUser(id: string, opts: { pro?: boolean; kyc?: boolean } = { pro: true, kyc: true }) {
  await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
  if (opts.pro) await prisma.subscription.create({ data: { userId: id, planId: "pro", status: "active", currentPeriodEnd: later(900), provider: "nowpayments" } });
  if (opts.kyc) await prisma.sellerIdentity.create({ data: { userId: id, status: "VERIFIED", verifiedAt: T0 } });
}

async function mkSale(buyerId: string, n: number, refCode: string | null) {
  const purchase = await prisma.purchase.create({
    data: { buyerId, marketplaceListingId: "lst1", tradingSystemId: "ts1", amount: btc.listPriceCents / 100, provider: "nowpayments", providerRef: `pay_${n}`, status: "COMPLETED", purchasedAt: T0 },
  });
  const month = monthKey(T0);
  const hold = await prisma.rewardSlotHold.create({ data: { month, productKey: btc.key, userId: buyerId, status: "HELD", expiresAt: later(1) } });
  await prisma.rewardCheckout.create({ data: { userId: buyerId, productKey: btc.key, month, slotHoldId: hold.id, intentId: `intent_${n}`, refCode, termsVersion: "v-test", consentAt: T0 } });
  return { purchase, hold };
}

async function main() {
  await wipe();
  await mkUser("buyer");
  await mkUser("partner");
  await mkUser("lapsed", { pro: false, kyc: false });
  await mkUser("buyer2");
  await mkUser("buyer3");
  await mkUser("buyer4");
  await mkUser("par2");
  await mkUser("grand");

  // ---- slots
  const month = monthKey(T0);
  check("admin: a month cannot exceed 10 in total", !(await adminSetSlot({ month, productKey: "BTC_AI_ALGO", limit: 11, opened: true })).ok);
  check("admin opens BTC with 2 slots", (await adminSetSlot({ month, productKey: "BTC_AI_ALGO", limit: 2, opened: true })).ok);
  check("admin: other products cannot push the month over 10", !(await adminSetSlot({ month, productKey: "GOLD_AI_ALGO", limit: 9, opened: true })).ok);
  const closed = await reserveSlot({ userId: "buyer", productKey: "GOLD_AI_ALGO" });
  check("closed product: no slot", !closed.ok && closed.reason === "CLOSED");
  const s1 = await reserveSlot({ userId: "u1", productKey: "BTC_AI_ALGO" });
  const s1b = await reserveSlot({ userId: "u1", productKey: "BTC_AI_ALGO" });
  check("same user clicking twice reuses their hold", s1.ok && s1b.ok && s1.holdId === s1b.holdId);
  const s2 = await reserveSlot({ userId: "u2", productKey: "BTC_AI_ALGO" });
  const s3 = await reserveSlot({ userId: "u3", productKey: "BTC_AI_ALGO" });
  check("third buyer: FULL", s2.ok && !s3.ok && s3.reason === "FULL");
  if (s1.ok) await releaseHold(s1.holdId);
  const s4 = await reserveSlot({ userId: "u3", productKey: "BTC_AI_ALGO" });
  check("a released hold frees the slot", s4.ok);
  const race = await Promise.all(Array.from({ length: 6 }, (_, i) => reserveSlot({ userId: `r${i}`, productKey: "BTC_AI_ALGO" })));
  check("6 racing buyers never take more than the limit (2 held already -> 0 more)", race.filter((r) => r.ok).length === 0);
  await prisma.rewardSlotHold.deleteMany({});
  const race2 = await Promise.all(Array.from({ length: 6 }, (_, i) => reserveSlot({ userId: `q${i}`, productKey: "BTC_AI_ALGO" })));
  check("6 buyers racing for 2 empty slots: exactly 2 win", race2.filter((r) => r.ok).length === 2 && race2.filter((r) => !r.ok && r.reason === "FULL").length === 4, String(race2.filter((r) => r.ok).length));
  await prisma.rewardSlotHold.deleteMany({});

  // ---- fulfilment
  const code = await ensureReferralCode("partner");
  check("referral code is created once and reused", code.length === 8 && (await ensureReferralCode("partner")) === code);
  const { purchase } = await mkSale("buyer", 1, code);
  const f1 = await fulfilRewardCheckout({ intentId: "intent_1", providerRef: "pay_1" });
  check("fulfilment creates the contract", f1.handled && !f1.duplicate);
  const contractId = f1.handled ? f1.contractId : "";
  const contract = await prisma.rewardContract.findUnique({ where: { id: contractId } });
  const insts = await prisma.rebateInstallment.findMany({ where: { contractId }, orderBy: { seq: "asc" } });
  check("contract waits for its document (no storage here): PENDING_DOCUMENT", contract?.status === "PENDING_DOCUMENT");
  check("4 instalments of $500 add to the $2,000 rebate", insts.length === 4 && insts.every((i) => i.amountCents === 50_000) && insts.reduce((s, i) => s + i.amountCents, 0) === btc.rebateCents);
  const reserve1 = await prisma.rewardReserveEntry.findMany({ where: { contractId } });
  check("the whole rebate is reserved on the day of sale", reserve1.length === 1 && reserve1[0].type === "RESERVED" && reserve1[0].amountCents === btc.rebateCents);
  const comm = await prisma.referralCommission.findMany({ where: { purchaseId: purchase.id } });
  check("partner earns the direct commission ($100), pending", comm.length === 1 && comm[0].partnerId === "partner" && comm[0].amountCents === 10_000 && comm[0].status === "PENDING");
  const f1b = await fulfilRewardCheckout({ intentId: "intent_1", providerRef: "pay_1" });
  check("a replayed webhook returns the same contract", f1b.handled && f1b.duplicate && f1b.contractId === contractId);
  check("replay did not create more instalments or commission", (await prisma.rebateInstallment.count({ where: { contractId } })) === 4 && (await prisma.referralCommission.count({ where: { purchaseId: purchase.id } })) === 1);
  check("slot hold became CONVERTED", (await prisma.rewardSlotHold.count({ where: { status: "CONVERTED" } })) === 1);

  // self-referral and ineligible partner earn nothing
  const buyerCode = await ensureReferralCode("buyer");
  await mkSale("buyer2", 2, buyerCode);
  await prisma.subscription.updateMany({ where: { userId: "buyer" }, data: { currentPeriodEnd: later(-1) } });
  const f2 = await fulfilRewardCheckout({ intentId: "intent_2", providerRef: "pay_2" });
  check("partner whose Pro lapsed earns no commission", f2.handled && (await prisma.referralCommission.count({ where: { partnerId: "buyer" } })) === 0);
  await prisma.subscription.updateMany({ where: { userId: "buyer" }, data: { currentPeriodEnd: later(900) } });
  const selfCode = buyerCode;
  const selfSale = await mkSale("buyer", 3, selfCode);
  await fulfilRewardCheckout({ intentId: "intent_3", providerRef: "pay_3" });
  check("self-referral earns nothing", (await prisma.referralCommission.count({ where: { purchaseId: selfSale.purchase.id } })) === 0);
  // keep the other two contracts out of the way of the main scenario
  for (const id of ["intent_2", "intent_3"]) {
    const co = await prisma.rewardCheckout.findUnique({ where: { intentId: id } });
    if (co?.contractId) await cancelContract(co.contractId, "test cleanup", "e2e");
  }

  // ---- multi-level referral (flag): grand -> par2 -> buyer3. Off by default; on only while the flag is set.
  const par2Code = await ensureReferralCode("par2");
  await prisma.referralAttribution.create({ data: { partnerId: "grand", buyerId: "par2", codeId: (await prisma.referralCode.findFirstOrThrow({ where: { userId: "par2" } })).id } });
  delete process.env.REWARDS_MULTI_LEVEL;
  const mlOff = await mkSale("buyer3", 4, par2Code);
  await fulfilRewardCheckout({ intentId: "intent_4", providerRef: "pay_4" });
  const offRows = await prisma.referralCommission.findMany({ where: { purchaseId: mlOff.purchase.id } });
  check("multi-level OFF: only the direct partner is paid ($100)", offRows.length === 1 && offRows[0].partnerId === "par2" && offRows[0].amountCents === 10_000, JSON.stringify(offRows.map((r) => [r.partnerId, r.level, r.amountCents])));
  process.env.REWARDS_MULTI_LEVEL = "true";
  const mlOn = await mkSale("buyer4", 5, par2Code);
  await fulfilRewardCheckout({ intentId: "intent_5", providerRef: "pay_5" });
  const onRows = await prisma.referralCommission.findMany({ where: { purchaseId: mlOn.purchase.id }, orderBy: { level: "asc" } });
  check("multi-level ON: direct $100 and the partner above $50", onRows.length === 2 && onRows[0].partnerId === "par2" && onRows[0].amountCents === 10_000 && onRows[1].partnerId === "grand" && onRows[1].level === 1 && onRows[1].amountCents === 5_000, JSON.stringify(onRows.map((r) => [r.partnerId, r.level, r.amountCents])));
  await prisma.subscription.updateMany({ where: { userId: "grand" }, data: { currentPeriodEnd: later(-1) } });
  await mkUser("buyer5");
  const mlLapsed = await mkSale("buyer5", 6, par2Code);
  await fulfilRewardCheckout({ intentId: "intent_6", providerRef: "pay_6" });
  const lapsedRows = await prisma.referralCommission.findMany({ where: { purchaseId: mlLapsed.purchase.id } });
  check("an upline partner who lapsed earns nothing, the direct one still does", lapsedRows.length === 1 && lapsedRows[0].partnerId === "par2");
  delete process.env.REWARDS_MULTI_LEVEL;
  for (const id of ["intent_4", "intent_5", "intent_6"]) {
    const co = await prisma.rewardCheckout.findUnique({ where: { intentId: id } });
    if (co?.contractId) await cancelContract(co.contractId, "test cleanup", "e2e");
  }

  // ---- DEMO (mock data): a 4-level chain, 2/1/1/1. Each person is paid ONLY with an active paid Pro plan + verified identity.
  //   top (ra) brought rb, rb brought rc, rc brought rd, rd brings the buyer.   BTC contract: direct $100, then $50 / $50 / $50.
  const chain = ["rd", "rc", "rb", "ra"]; // direct partner first, then upward
  for (const id of chain) await mkUser(id);
  const codeRow: Record<string, { code: string; id: string }> = {};
  for (const id of chain) {
    const code = await ensureReferralCode(id);
    codeRow[id] = { code, id: (await prisma.referralCode.findFirstOrThrow({ where: { userId: id } })).id };
  }
  for (const [partner, buyer] of [["rc", "rd"], ["rb", "rc"], ["ra", "rb"]] as const) {
    await prisma.referralAttribution.create({ data: { partnerId: partner, buyerId: buyer, codeId: codeRow[partner].id } });
  }
  process.env.REWARDS_MULTI_LEVEL = "true";
  type State = "active" | "lapsed" | "adminGranted" | "free" | "noKyc";
  const setState = async (id: string, st: State) => {
    const sub = st === "lapsed" ? { currentPeriodEnd: later(-1), provider: "nowpayments", planId: "pro" }
      : st === "adminGranted" ? { currentPeriodEnd: later(900), provider: null, planId: "pro" }
      : st === "free" ? { currentPeriodEnd: later(900), provider: null, planId: "free" }
      : { currentPeriodEnd: later(900), provider: "nowpayments", planId: "pro" };
    await prisma.subscription.updateMany({ where: { userId: id }, data: sub });
    await prisma.sellerIdentity.updateMany({ where: { userId: id }, data: { status: st === "noKyc" ? "PENDING" : "VERIFIED" } });
  };
  const demoRows: Array<Record<string, string | number>> = [];
  const demo = async (n: number, label: string, states: [State, State, State, State], expected: [number, number, number, number]) => {
    for (let i = 0; i < 4; i++) await setState(chain[i], states[i]);
    const buyer = `demo_buyer_${n}`;
    await mkUser(buyer);
    const sale = await mkSale(buyer, n, codeRow.rd.code);
    await fulfilRewardCheckout({ intentId: `intent_${n}`, providerRef: `pay_${n}` });
    const rows = await prisma.referralCommission.findMany({ where: { purchaseId: sale.purchase.id } });
    const got = chain.map((id) => rows.filter((r) => r.partnerId === id).reduce((a, r) => a + r.amountCents, 0));
    const buyerPaid = rows.some((r) => r.partnerId === buyer);
    const levelsOk = chain.every((id, i) => rows.filter((r) => r.partnerId === id).every((r) => r.level === i));
    check(`DEMO ${label}: direct / level2 / level3 / level4 = ${expected.map((c) => "$" + c / 100).join(" / ")}`, got.join() === expected.join() && !buyerPaid && levelsOk, `got ${got.map((c) => "$" + c / 100).join(" / ")}`);
    demoRows.push({ scenario: label, "direct rd": `$${got[0] / 100}`, "level 2 rc": `$${got[1] / 100}`, "level 3 rb": `$${got[2] / 100}`, "level 4 ra": `$${got[3] / 100}`, total: `$${got.reduce((a, c) => a + c, 0) / 100}` });
    const co = await prisma.rewardCheckout.findUnique({ where: { intentId: `intent_${n}` } });
    if (co?.contractId) await cancelContract(co.contractId, "demo cleanup", "e2e");
  };
  await demo(11, "everyone active", ["active", "active", "active", "active"], [10_000, 5_000, 5_000, 5_000]);
  await demo(12, "level 3 (rb) Pro lapsed", ["active", "active", "lapsed", "active"], [10_000, 5_000, 0, 5_000]);
  await demo(13, "level 2 (rc) admin-granted Pro, level 4 (ra) no KYC", ["active", "adminGranted", "active", "noKyc"], [10_000, 0, 5_000, 0]);
  await demo(14, "direct (rd) on the free plan", ["free", "active", "active", "active"], [0, 5_000, 5_000, 5_000]);
  await demo(15, "nobody qualifies", ["lapsed", "free", "noKyc", "adminGranted"], [0, 0, 0, 0]);
  console.log("\nDEMO - BTC AI Algo sold through a 4-level chain (2/1/1/1, fixed dollars):");
  console.table(demoRows);
  delete process.env.REWARDS_MULTI_LEVEL;
  for (const id of chain) await setState(id, "active");

  // ---- sweep with simulated time
  await prisma.rewardContract.update({ where: { id: contractId }, data: { status: "ACTIVE" } }); // stands in for the issued PDF
  const r0 = await runRewardsSweep(later(10));
  check("day 10: nothing due, commission still in its hold", r0.released === 0 && r0.frozen === 0 && r0.commissionsReleased === 1, JSON.stringify({ r: r0.released, c: r0.commissionsReleased }));
  const r1 = await runRewardsSweep(later(91));
  check("day 91: instalment 1 released", r1.released === 1 && r1.errors.length === 0, JSON.stringify(r1.errors));
  const r1b = await runRewardsSweep(later(91));
  check("running the sweep again changes nothing (idempotent)", r1b.released === 0 && r1b.commissionsReleased === 0);
  check("ledger has one entry for instalment 1", (await prisma.rewardLedgerEntry.count({ where: { idempotencyKey: `release:${contractId}:1` } })) === 1);

  // freeze: buyer's Pro lapses before instalment 2
  await prisma.subscription.updateMany({ where: { userId: "buyer" }, data: { currentPeriodEnd: later(100) } });
  const r2 = await runRewardsSweep(later(181));
  const c2 = await prisma.rewardContract.findUnique({ where: { id: contractId } });
  check("day 181, Pro lapsed: instalment 2 FROZEN (kept), contract FROZEN", r2.frozen === 1 && r2.released === 0 && c2?.status === "FROZEN");
  check("frozen amount is still in the balance as paused", (await getBalances("buyer", later(181))).frozen === 50_000);
  await prisma.subscription.updateMany({ where: { userId: "buyer" }, data: { currentPeriodEnd: later(900) } });
  const r3 = await runRewardsSweep(later(182));
  const c3 = await prisma.rewardContract.findUnique({ where: { id: contractId } });
  check("Pro restored: the frozen instalment is released, contract ACTIVE again", r3.released === 1 && c3?.status === "ACTIVE");

  // ---- balances and withdrawal
  const b1 = await getBalances("buyer", later(182));
  check("buyer: instalment 2 is on hold, instalment 1 available", b1.available === 50_000 && b1.holding === 50_000 && b1.scheduled === 100_000, JSON.stringify(b1));
  const bp = await getBalances("partner", later(182));
  check("partner: $100 commission available (no double hold)", bp.available === 10_000, JSON.stringify(bp));
  const wBelow = await requestWithdrawal({ userId: "partner", email: "partner@example.com", network: "TRC20", address: TRC20, now: later(182) });
  check("partner $100 is above the $50 minimum, so it is accepted", wBelow.ok);
  const w1 = await requestWithdrawal({ userId: "buyer", email: "buyer@example.com", network: "TRC20", address: "not-an-address", now: later(182) });
  check("bad address refused", !w1.ok && w1.code === "BAD_ADDRESS");
  await prisma.sellerIdentity.updateMany({ where: { userId: "buyer" }, data: { status: "PENDING" } });
  const w2 = await requestWithdrawal({ userId: "buyer", email: "buyer@example.com", network: "TRC20", address: TRC20, now: later(182) });
  check("no KYC: withdrawal refused", !w2.ok && w2.code === "NOT_ELIGIBLE");
  await prisma.sellerIdentity.updateMany({ where: { userId: "buyer" }, data: { status: "VERIFIED" } });
  const w3 = await requestWithdrawal({ userId: "buyer", email: "buyer@example.com", network: "TRC20", address: TRC20, now: later(182) });
  check("eligible: whole available balance requested ($500)", w3.ok && w3.amountCents === 50_000);
  const w4 = await requestWithdrawal({ userId: "buyer", email: "buyer@example.com", network: "TRC20", address: TRC20, now: later(182) });
  check("a second request while one is open is refused", !w4.ok && w4.code === "OPEN_REQUEST");
  check("balance moves to requested", (await getBalances("buyer", later(182))).requested === 50_000);
  if (w3.ok) {
    const noTx = await decideWithdrawal({ payoutId: w3.payoutId, decision: "PAID", adminId: "admin", now: later(183) });
    check("PAID needs a transaction reference", !noTx.ok && noTx.code === "TX_REQUIRED");
    await prisma.subscription.updateMany({ where: { userId: "buyer" }, data: { currentPeriodEnd: later(100) } });
    const lapsed = await decideWithdrawal({ payoutId: w3.payoutId, decision: "PAID", txRef: "0xabc123def", adminId: "admin", now: later(183) });
    check("Pro lapsed by approval time: payment refused", !lapsed.ok && lapsed.code === "NOT_ELIGIBLE");
    await prisma.subscription.updateMany({ where: { userId: "buyer" }, data: { currentPeriodEnd: later(900) } });
    const paid = await decideWithdrawal({ payoutId: w3.payoutId, decision: "PAID", txRef: "0xabc123def", adminId: "admin", now: later(183) });
    const bAfter = await getBalances("buyer", later(183));
    check("admin pays: balance shows paid $500, nothing left requested", paid.ok && bAfter.paid === 50_000 && bAfter.requested === 0, JSON.stringify(bAfter));
    const again = await decideWithdrawal({ payoutId: w3.payoutId, decision: "PAID", txRef: "0xabc123def", adminId: "admin", now: later(183) });
    check("deciding the same request twice is refused", !again.ok);
  }
  if (wBelow.ok) {
    const rej = await decideWithdrawal({ payoutId: wBelow.payoutId, decision: "REJECTED", note: "test", adminId: "admin", now: later(183) });
    check("rejected request returns the commission to the balance", rej.ok && (await getBalances("partner", later(183))).available === 10_000);
  }

  // ---- refund cancels the contract and returns the reserve
  await prisma.purchase.update({ where: { id: purchase.id }, data: { status: "REFUNDED" } });
  const r4 = await runRewardsSweep(later(184));
  const c4 = await prisma.rewardContract.findUnique({ where: { id: contractId } });
  check("refunded purchase: contract cancelled by the sweep", r4.contractsCancelled === 1 && c4?.status === "REVOKED");
  const left = await prisma.rebateInstallment.findMany({ where: { contractId, status: { in: ["SCHEDULED", "FROZEN"] } } });
  check("no unpaid instalment is left owing", left.length === 0);

  // ---- reserve identity across the whole run
  const r5 = await runRewardsSweep(later(185));
  check("reserve equals what is still owed (no mismatch reported)", r5.errors.length === 0 && r5.reserveOutstandingCents === r5.owedCents && r5.shortfallCents === 0, JSON.stringify({ errs: r5.errors, res: r5.reserveOutstandingCents, owed: r5.owedCents }));
  const audits = await prisma.rewardAuditEvent.count();
  check("audit trail was written", audits > 8, String(audits));

  console.log(failed === 0 ? "\nE2E ALL PASS" : `\nE2E ${failed} FAILED`);
}

main()
  .catch((e) => { console.error(e); failed++; })
  .finally(async () => { await prisma.$disconnect(); process.exit(failed === 0 ? 0 : 1); });
