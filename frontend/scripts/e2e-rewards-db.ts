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
process.env.REWARDS_COMMISSION_HOLD_DAYS = "7"; // the older checks below test the hold; instant credit (the default 0) is covered in e2e-referral-webhook.ts

import { prisma } from "../lib/prisma";
import { REWARD_PRODUCTS } from "../lib/rewards/config";
import { monthKey } from "../lib/rewards/slots";
import { addDays } from "../lib/rewards/money";
import { adminSetSlot, releaseHold, reserveSlot } from "../services/rewards/slotStore";
import { fulfilRewardCheckout } from "../services/rewards/fulfilmentService";
import { cancelContract, runRewardsSweep } from "../services/rewards/releaseService";
import { decideWithdrawal, getBalances, requestWithdrawal } from "../services/rewards/payoutStore";
import { ensureReferralCode } from "../services/rewards/referralStore";
import { isProgramListing } from "../services/rewards/listingGuard";
import { findKycReminderTargets, runKycReminders } from "../services/rewards/kycReminder";
import { loadUserFacts } from "../lib/rewards/access";
import { getSavedAddress, saveAddress } from "../services/rewards/addressStore";
import { isProActive } from "../lib/rewards/eligibility";
import { creditReferralForPayment } from "../services/rewards/universalReferral";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

const TRC20 = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
const btc = REWARD_PRODUCTS.BTC_AI_ALGO;
const testProd = REWARD_PRODUCTS.TEST_AI_ALGO;
const T0 = new Date();
const later = (days: number) => addDays(T0, days);

async function wipe() {
  for (const t of ["reward_audit_events", "reward_download_logs", "reward_payouts", "reward_reserve_entries", "reward_ledger_entries", "referral_commissions", "referral_attributions", "referral_codes", "rebate_installments", "reward_contract_documents", "reward_contracts", "reward_checkouts", "reward_slot_holds", "reward_slot_months", "reward_products", "reward_payout_addresses", "purchases", "seller_identities", "Subscription", "User"]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
  }
}

async function mkUser(id: string, opts: { pro?: boolean; kyc?: boolean } = { pro: true, kyc: true }) {
  await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
  if (opts.pro) await prisma.subscription.create({ data: { userId: id, planId: "pro", status: "active", currentPeriodEnd: later(900), provider: "nowpayments" } });
  if (opts.kyc) await prisma.sellerIdentity.create({ data: { userId: id, status: "VERIFIED", verifiedAt: T0 } });
}

async function mkSale(buyerId: string, n: number, refCode: string | null, prod: typeof btc = btc) {
  const purchase = await prisma.purchase.create({
    data: { buyerId, marketplaceListingId: "lst1", tradingSystemId: "ts1", amount: prod.listPriceCents / 100, provider: "nowpayments", providerRef: `pay_${n}`, status: "COMPLETED", purchasedAt: T0 },
  });
  const month = monthKey(T0);
  const hold = await prisma.rewardSlotHold.create({ data: { month, productKey: prod.key, userId: buyerId, status: "HELD", expiresAt: later(1) } });
  await prisma.rewardCheckout.create({ data: { userId: buyerId, productKey: prod.key, month, slotHoldId: hold.id, intentId: `intent_${n}`, refCode, termsVersion: "v-test", consentAt: T0 } });
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

  // ---- owner test switch: an owner account without any plan counts as paid Pro ONLY while the switch is on; nobody else ever does
  await prisma.user.create({ data: { id: "ownerx", email: "algogtraders24@gmail.com", name: "owner" } });
  delete process.env.REWARDS_OWNER_AS_PRO;
  check("switch off: the owner without a plan is not Pro", !isProActive((await loadUserFacts("ownerx", "algogtraders24@gmail.com")).subscription));
  process.env.REWARDS_OWNER_AS_PRO = "true";
  check("switch on: the owner counts as Pro", isProActive((await loadUserFacts("ownerx", "algogtraders24@gmail.com")).subscription));
  check("switch on: a normal account is still not Pro", !isProActive((await loadUserFacts("lapsed", "lapsed@example.com")).subscription));
  check("switch on: KYC is still required (owner has none here)", (await loadUserFacts("ownerx", "algogtraders24@gmail.com")).identity === "NONE");
  delete process.env.REWARDS_OWNER_AS_PRO;

  // ---- who gets the KYC reminder: an active PAID plan (real payment) and no verified identity - nobody else
  await mkUser("kycA", { pro: true, kyc: false });                       // paid Pro, not verified -> yes
  await mkUser("kycB", { pro: true, kyc: true });                        // paid Pro, verified     -> no
  await mkUser("kycC", { pro: true, kyc: false });                       // admin-granted Pro       -> no
  await prisma.subscription.updateMany({ where: { userId: "kycC" }, data: { provider: null } });
  await mkUser("kycD", { pro: true, kyc: false });                       // paid Pro that expired   -> no
  await prisma.subscription.updateMany({ where: { userId: "kycD" }, data: { currentPeriodEnd: later(-1) } });
  await mkUser("kycE", { pro: false, kyc: false });                      // free plan               -> no
  await mkUser("kycF", { pro: true, kyc: false });                       // paid Pro, verification still pending -> yes
  await prisma.sellerIdentity.create({ data: { userId: "kycF", status: "PENDING" } });
  const kycTargets = (await findKycReminderTargets(100)).map((t) => t.userId).sort();
  check("KYC reminder targets: paid active plan without a verified identity only (kycA, kycF)", kycTargets.join() === "kycA,kycF", kycTargets.join());
  const dry = await runKycReminders({ send: false, limit: 100 });
  check("dry run counts them, sends nothing and returns only masked addresses", dry.matched === 2 && dry.sent === 0 && dry.sample.every((x) => /^\w\*\*\*@/.test(x)), JSON.stringify(dry));
  check("the limit is respected", (await findKycReminderTargets(1)).length === 1);

  // ---- a listing bound to a reward product cannot be bought around the KYC check through the ordinary marketplace checkout
  await prisma.rewardProduct.create({ data: { key: "BTC_AI_ALGO", name: "BTC AI Algo", listingId: "lst_program", listPriceCents: btc.listPriceCents, rebateCents: btc.rebateCents, referralCents: [...btc.referralCents], enabled: false } });
  check("a listing bound to a reward product is a program listing (even before it is switched on)", await isProgramListing("lst_program"));
  check("any other listing is not", !(await isProgramListing("lst_other")));

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

  // ---- the owner-only $15 TEST contract, end to end: kharid -> contract -> 4 daily instalments -> commission -> withdrawal
  process.env.REWARDS_HOLD_DAYS = "0";
  process.env.REWARDS_COMMISSION_HOLD_DAYS = "1";
  process.env.REWARDS_MIN_PAYOUT_USD = "1";
  await mkUser("tbuyer");
  await mkUser("tpartner");
  const tcode = await ensureReferralCode("tpartner");
  const tsale = await mkSale("tbuyer", 30, tcode, testProd);
  const tf = await fulfilRewardCheckout({ intentId: "intent_30", providerRef: "pay_30" });
  const tId = tf.handled ? tf.contractId : "";
  const tc = await prisma.rewardContract.findUnique({ where: { id: tId } });
  check("TEST contract: $15 price, $6 rebate, $9 net", tc?.listPriceCents === 1_500 && tc?.rebateTotalCents === 600 && tc?.netPriceCents === 900 && tc?.productKey === "TEST_AI_ALGO");
  const tInst = await prisma.rebateInstallment.findMany({ where: { contractId: tId }, orderBy: { seq: "asc" } });
  check("TEST contract: 4 instalments of $1.50, one per day", tInst.length === 4 && tInst.every((i) => i.amountCents === 150) && tInst.map((i) => Math.round((i.dueAt.getTime() - T0.getTime()) / 86_400_000)).join() === "1,2,3,4");
  const tComm = await prisma.referralCommission.findMany({ where: { purchaseId: tsale.purchase.id } });
  check("TEST contract: the partner earns 30 cents (2% of $15)", tComm.length === 1 && tComm[0].partnerId === "tpartner" && tComm[0].amountCents === 30);
  await prisma.rewardContract.update({ where: { id: tId }, data: { status: "ACTIVE" } }); // stands in for the issued PDF
  const t1 = await runRewardsSweep(addDays(later(1), 0.05));
  check("day 1: instalment 1 released and the commission too", t1.released === 1 && t1.commissionsReleased === 1 && t1.errors.length === 0, JSON.stringify(t1.errors));
  const tb1 = await getBalances("tbuyer", addDays(later(1), 0.05));
  const tp1 = await getBalances("tpartner", addDays(later(1), 0.05));
  check("hold 0: the buyer can withdraw $1.50 at once, the partner has 30 cents", tb1.available === 150 && tp1.available === 30, JSON.stringify([tb1.available, tp1.available]));
  const tw0 = await requestWithdrawal({ userId: "tpartner", email: "tpartner@example.com", network: "TRC20", address: TRC20, now: addDays(later(1), 0.05) });
  check("30 cents is below the $1 test minimum", !tw0.ok && /minimum/i.test(tw0.message), tw0.ok ? "" : tw0.message);
  const t4 = await runRewardsSweep(addDays(later(4), 0.05));
  check("day 4: the remaining 3 instalments are released", t4.released === 3 && t4.errors.length === 0);
  const tb4 = await getBalances("tbuyer", addDays(later(4), 0.05));
  check("the buyer now has the whole $6 rebate available and nothing owed", tb4.available === 600 && tb4.scheduled === 0, JSON.stringify(tb4));
  const tw1 = await requestWithdrawal({ userId: "tbuyer", email: "tbuyer@example.com", network: "TRC20", address: TRC20, now: addDays(later(4), 0.05) });
  check("withdrawal of the $6 is accepted", tw1.ok && tw1.amountCents === 600);
  if (tw1.ok) {
    const tpaid = await decideWithdrawal({ payoutId: tw1.payoutId, decision: "PAID", txRef: "0xtest0001abc", adminId: "admin", now: addDays(later(4), 0.05) });
    check("admin marks it paid; the buyer shows $6 paid", tpaid.ok && (await getBalances("tbuyer", addDays(later(4), 0.05))).paid === 600);
  }
  const tr = await runRewardsSweep(addDays(later(5), 0.05));
  check("test run leaves the reserve balanced", tr.errors.length === 0 && tr.reserveOutstandingCents === tr.owedCents, JSON.stringify(tr.errors));
  delete process.env.REWARDS_HOLD_DAYS;
  process.env.REWARDS_COMMISSION_HOLD_DAYS = "7";
  delete process.env.REWARDS_MIN_PAYOUT_USD;

  // ---- universal referral: percent commission on any other payment (a product, a Pro subscription renewal), 4 levels, flag-gated
  await mkUser("ubuyer"); await mkUser("upart"); await mkUser("upar2"); await mkUser("ugrand"); await mkUser("ugreat");
  await mkUser("ulapsed", { pro: false, kyc: false });
  const att = (partnerId: string, buyerId: string) => prisma.referralAttribution.create({ data: { partnerId, buyerId, codeId: "code_" + partnerId } });
  await att("upart", "ubuyer"); await att("upar2", "upart"); await att("ugrand", "upar2"); await att("ugreat", "ugrand");
  const PAID = later(10);
  delete process.env.REFERRAL_ALL_PRODUCTS;
  const off = await creditReferralForPayment({ buyerId: "ubuyer", amountCents: 2000, saleRef: "sub:off", paidAt: PAID, source: "SUBSCRIPTION" });
  check("universal referral OFF: nothing is credited", off.credited === 0 && off.reason === "OFF" && (await prisma.referralCommission.count({ where: { purchaseId: "sub:off" } })) === 0);
  process.env.REFERRAL_ALL_PRODUCTS = "true";
  delete process.env.REWARDS_MULTI_LEVEL;
  const d1 = await creditReferralForPayment({ buyerId: "ubuyer", amountCents: 2000, saleRef: "sub:p1", paidAt: PAID, source: "SUBSCRIPTION" });
  const d1rows = await prisma.referralCommission.findMany({ where: { purchaseId: "sub:p1" } });
  check("flag on, multi-level off: only the direct partner gets 2% (40c)", d1.credited === 1 && d1rows.length === 1 && d1rows[0].partnerId === "upart" && d1rows[0].amountCents === 40 && d1rows[0].level === 0);
  process.env.REWARDS_MULTI_LEVEL = "true";
  const d2 = await creditReferralForPayment({ buyerId: "ubuyer", amountCents: 2000, saleRef: "sub:p2", paidAt: PAID, source: "SUBSCRIPTION" });
  const d2rows = (await prisma.referralCommission.findMany({ where: { purchaseId: "sub:p2" }, orderBy: { level: "asc" } }));
  check("multi-level on: 40c / 20c / 20c / 20c to the four levels", d2.credited === 4 && d2rows.map((r) => r.amountCents).join() === "40,20,20,20" && d2rows.map((r) => r.partnerId).join() === "upart,upar2,ugrand,ugreat", JSON.stringify(d2rows.map((r) => [r.level, r.partnerId, r.amountCents])));
  const d2again = await creditReferralForPayment({ buyerId: "ubuyer", amountCents: 2000, saleRef: "sub:p2", paidAt: PAID, source: "SUBSCRIPTION" });
  check("a replayed payment pays nothing twice", d2again.credited === 0 && (await prisma.referralCommission.count({ where: { purchaseId: "sub:p2" } })) === 4);
  const d3 = await creditReferralForPayment({ buyerId: "ubuyer", amountCents: 2000, saleRef: "sub:p3", paidAt: PAID, source: "SUBSCRIPTION" });
  check("every renewal pays again (a new payment id)", d3.credited === 4);
  await prisma.subscription.updateMany({ where: { userId: "upar2" }, data: { provider: null } }); // upar2 is now admin-granted Pro -> not paid
  const d4 = await creditReferralForPayment({ buyerId: "ubuyer", amountCents: 2000, saleRef: "sub:p4", paidAt: PAID, source: "SUBSCRIPTION" });
  const d4rows = await prisma.referralCommission.findMany({ where: { purchaseId: "sub:p4" }, orderBy: { level: "asc" } });
  check("an ineligible level earns nothing and the others are still paid", d4rows.map((r) => r.partnerId).join() === "upart,ugrand,ugreat", d4rows.map((r) => r.partnerId).join());
  await prisma.subscription.updateMany({ where: { userId: "upar2" }, data: { provider: "nowpayments" } });
  const none = await creditReferralForPayment({ buyerId: "unattached", amountCents: 2000, saleRef: "sub:none", paidAt: PAID, source: "SUBSCRIPTION" });
  check("a buyer nobody brought pays nobody", none.credited === 0 && none.reason === "NO_PARTNER");
  const pend = await prisma.referralCommission.findMany({ where: { purchaseId: "sub:p2" } });
  check("held for the hold period like any commission", pend.every((r) => r.status === "PENDING" && r.availableAt.getTime() === addDays(PAID, 7).getTime()));
  // the daily check releases a subscription commission (it has no purchase row, which must NOT read as "refunded")
  const us = await runRewardsSweep(addDays(PAID, 8));
  const released = await prisma.referralCommission.count({ where: { purchaseId: { startsWith: "sub:p" }, status: "RELEASED" } });
  const reversed = await prisma.referralCommission.count({ where: { purchaseId: { startsWith: "sub:" }, status: "REVERSED" } });
  check("sweep releases subscription commissions and never reverses them as refunded", released === 12 && reversed === 0 && us.errors.length === 0, JSON.stringify({ released, reversed, errs: us.errors }));
  delete process.env.REFERRAL_ALL_PRODUCTS;
  delete process.env.REWARDS_MULTI_LEVEL;

  // ---- saved USDT address: validated, audited, cooled down, one per member
  await mkUser("addr1");
  process.env.REWARDS_ADDRESS_COOLING_HOURS = "24";
  const A1 = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE";
  await prisma.emailLog.deleteMany({ where: { type: "payout_address_changed" } }); // scratch DB: start the email count clean on every run
  const bad = await saveAddress({ userId: "addr1", network: "TRC20", address: "not-an-address" });
  check("a bad address is refused and nothing is saved", !bad.ok && (await getSavedAddress("addr1")) === null);
  const ads1 = await saveAddress({ userId: "addr1", network: "TRC20", address: A1, now: T0 });
  check("a good address is saved and waits 24h", ads1.ok && !ads1.unchanged && ads1.activeFrom.getTime() === addDays(T0, 1).getTime());
  const ads2 = await saveAddress({ userId: "addr1", network: "TRC20", address: A1, now: addDays(T0, 0.5) });
  check("saving the same address again changes nothing (the wait does not restart)", ads2.ok && ads2.unchanged && ads2.activeFrom.getTime() === addDays(T0, 1).getTime());
  const ads3 = await saveAddress({ userId: "addr1", network: "TRC20", address: "TXYZ" + A1.slice(4), now: addDays(T0, 2) });
  const saved3 = await getSavedAddress("addr1");
  check("changing it replaces the single row and restarts the wait", ads3.ok && !ads3.unchanged && saved3?.address.startsWith("TXYZ") === true && (await prisma.rewardPayoutAddress.count({ where: { userId: "addr1" } })) === 1 && (await prisma.rewardPayoutAddress.findUnique({ where: { userId: "addr1" } }))?.activeFrom.getTime() === addDays(T0, 3).getTime());
  const aud = await prisma.rewardAuditEvent.findMany({ where: { subjectType: "RewardPayoutAddress" }, orderBy: { createdAt: "asc" } });
  check("save and change are both audited, with the address masked", aud.map((a) => a.action).join() === "payout_address.saved,payout_address.changed" && aud.every((a) => !JSON.stringify(a.data).includes(A1)));
  const mails = await prisma.emailLog.findMany({ where: { type: "payout_address_changed", recipientUserId: "addr1" }, orderBy: { sentAt: "asc" } });
  check("the member is emailed on save and on change (logged; skipped here because no mail key is set)", mails.length === 2 && mails.every((m) => m.status === "SKIPPED"), JSON.stringify(mails.map((m) => m.status)));
  delete process.env.REWARDS_ADDRESS_COOLING_HOURS;

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
