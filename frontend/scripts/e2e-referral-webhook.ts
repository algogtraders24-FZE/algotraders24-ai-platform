// scripts/e2e-referral-webhook.ts
// Drives the REAL NOWPayments webhook handler (signed IPNs) against a SCRATCH database to check the universal referral hooks end to end:
// a product purchase and Pro subscription renewals, signup attachment, replays, an Algo Contract staying untouched, and the flag OFF.
// SAFETY: refuses to run unless DATABASE_URL points at localhost. Never run it against a real database.
//   NODE_OPTIONS=--conditions=react-server DATABASE_URL=postgresql://test:test@localhost:54329/at24test npx tsx scripts/e2e-referral-webhook.ts
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "")) {
  console.error("Refusing to run: DATABASE_URL must point at a local scratch database.");
  process.exit(2);
}
import crypto from "node:crypto";
const kp = crypto.generateKeyPairSync("ed25519");
process.env.LICENSE_SIGNING_PRIVATE_KEY = kp.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
process.env.LICENSE_SIGNING_PUBLIC_KEY = kp.publicKey.export({ type: "spki", format: "pem" }).toString();
process.env.NOWPAYMENTS_API_KEY = "test-key";
process.env.NOWPAYMENTS_IPN_SECRET = "test-ipn-secret";
process.env.REWARDS_MULTI_LEVEL = "true";
process.env.REFERRAL_ALL_PRODUCTS = "true";
delete process.env.REWARDS_HOLD_DAYS;

import { prisma } from "../lib/prisma";
import { attachSignupFromCode } from "../services/rewards/universalReferral";
import { ensureReferralCode } from "../services/rewards/referralStore";
import { runRewardsSweep } from "../services/rewards/releaseService";
import { loadWallet } from "../services/rewards/walletStore";
import { POST } from "../app/api/webhooks/nowpayments/route";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}
const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === "object"
      ? Object.keys(v as object).sort().reduce<Record<string, unknown>>((a, k) => { a[k] = sortKeys((v as Record<string, unknown>)[k]); return a; }, {})
      : v;
async function ipn(body: Record<string, unknown>, signed = true) {
  const sig = crypto.createHmac("sha512", "test-ipn-secret").update(JSON.stringify(sortKeys(body))).digest("hex");
  const res = await POST(new Request("http://localhost/api/webhooks/nowpayments", { method: "POST", headers: { "content-type": "application/json", "x-nowpayments-sig": signed ? sig : "00" }, body: JSON.stringify(body) }));
  return res.status;
}
async function wipe() {
  for (const t of ["reward_audit_events", "reward_ledger_entries", "referral_commissions", "referral_attributions", "referral_codes", "reward_checkouts", "licenses", "entitlements", "purchases", "marketplace_purchase_intents", "release_artifacts", "marketplace_listings", "seller_identities", "Subscription", "User"]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`).catch(() => undefined);
  }
}
async function mkUser(id: string, pro = true, kyc = true) {
  await prisma.user.create({ data: { id, email: `${id}@example.com`, name: id } });
  if (pro) await prisma.subscription.create({ data: { userId: id, planId: "pro", status: "active", currentPeriodEnd: new Date(Date.now() + 900 * 86_400_000), provider: "nowpayments" } });
  if (kyc) await prisma.sellerIdentity.create({ data: { userId: id, status: "VERIFIED", verifiedAt: new Date() } });
}
const comm = (ref: string) => prisma.referralCommission.findMany({ where: { purchaseId: ref }, orderBy: { level: "asc" } });

async function main() {
  await wipe();
  // chain: buyer was brought by p1, p1 by p2, p2 by p3, p3 by p4
  for (const id of ["p4", "p3", "p2", "p1"]) await mkUser(id);
  await mkUser("buyer", false, false);
  const codes: Record<string, string> = {};
  for (const id of ["p4", "p3", "p2", "p1"]) codes[id] = await ensureReferralCode(id);

  // ---- signup attachment (first touch, never self, never twice, bad code ignored)
  check("p3 joins through the link of p4", await attachSignupFromCode("p3", codes.p4));
  check("p2 joins through the link of p3", await attachSignupFromCode("p2", codes.p3));
  check("p1 joins through the link of p2", await attachSignupFromCode("p1", codes.p2));
  check("buyer joins through the link of p1", await attachSignupFromCode("buyer", codes.p1));
  check("a second link never re-attaches the buyer", !(await attachSignupFromCode("buyer", codes.p4)));
  check("nobody can attach through their own link", !(await attachSignupFromCode("p1", codes.p1)));
  check("a malformed or unknown code is ignored", !(await attachSignupFromCode("p4", "NOPE")) && !(await attachSignupFromCode("p4", "ZZZZZZZZ")));

  // ---- a product purchase through the real webhook (flag ON)
  process.env.REFERRAL_ALL_PRODUCTS = "true";
  await prisma.marketplaceListing.create({ data: { id: "lst", slug: "lst", sellerId: "p4", title: "Third party EA", pricing: { model: "one_time", amount: 79, currency: "USD" }, platformTag: "MT5", tradingSystemId: "ts", versionId: "v1", publicationState: "PUBLISHED" } });
  const rel = await prisma.releaseArtifact.create({ data: { tradingSystemId: "ts", versionId: "v1", marketplaceListingId: "lst", platform: "MT5", artifactVersion: "v1", artifactHash: "h1", releaseStatus: "PUBLISHED" } });
  await prisma.marketplacePurchaseIntent.create({ data: { id: "int1", buyerId: "buyer", marketplaceListingId: "lst", tradingSystemId: "ts", versionId: "v1", platform: "MT5", releaseId: rel.id, amount: 79, currency: "USD" } });
  const ev = { payment_status: "finished", order_id: "mkt_int1", payment_id: 7000001, price_amount: 79, created_at: new Date().toISOString() };
  check("a bad signature is rejected (400)", (await ipn(ev, false)) === 400);
  check("the signed product IPN is accepted (200)", (await ipn(ev)) === 200);
  const purchase = await prisma.purchase.findUnique({ where: { providerRef: "7000001" } });
  check("the purchase and licence exist (payment_id number coerced to text)", !!purchase && (await prisma.license.count({ where: { buyerId: "buyer" } })) === 1);
  const c1 = purchase ? await comm(purchase.id) : [];
  check("product $79: 158c / 79c / 79c / 79c to p1, p2, p3, p4", c1.map((r) => r.amountCents).join() === "158,79,79,79" && c1.map((r) => r.partnerId).join() === "p1,p2,p3,p4", JSON.stringify(c1.map((r) => [r.partnerId, r.amountCents])));
  check("they are PENDING for the hold period", c1.length > 0 && c1.every((r) => r.status === "PENDING" && r.availableAt.getTime() > Date.now() + 6 * 86_400_000));
  check("the same IPN again pays nothing twice", (await ipn(ev)) === 200 && purchase !== null && (await comm(purchase.id)).length === 4);

  // ---- Pro subscription renewals through the real webhook
  const sub = (n: number, extra: Record<string, unknown> = {}) => ({ payment_status: "finished", order_id: `buyer:pro:monthly:${1790000000000 + n}`, payment_id: 7100000 + n, price_amount: 20, created_at: new Date().toISOString(), ...extra });
  check("first Pro payment accepted", (await ipn(sub(1))) === 200);
  const s1 = await comm("sub:7100001");
  check("Pro $20: 40c / 20c / 20c / 20c", s1.map((r) => r.amountCents).join() === "40,20,20,20", JSON.stringify(s1.map((r) => [r.partnerId, r.amountCents])));
  check("replaying the same Pro IPN pays nothing twice", (await ipn(sub(1))) === 200 && (await comm("sub:7100001")).length === 4);
  check("the next renewal (new payment id) pays again", (await ipn(sub(2))) === 200 && (await comm("sub:7100002")).length === 4);
  check("a waiting or failed payment creates no commission", (await ipn(sub(3, { payment_status: "waiting" }))) === 200 && (await ipn(sub(4, { payment_status: "failed" }))) === 200 && (await comm("sub:7100003")).length === 0 && (await comm("sub:7100004")).length === 0);

  // ---- an ineligible level earns nothing, the others are still paid
  await prisma.subscription.updateMany({ where: { userId: "p2" }, data: { provider: null } });
  await ipn(sub(5));
  const s5 = await comm("sub:7100005");
  check("p2 lost paid Pro: p2 gets nothing, p1 / p3 / p4 still paid", s5.map((r) => r.partnerId).join() === "p1,p3,p4", s5.map((r) => r.partnerId).join());
  await prisma.subscription.updateMany({ where: { userId: "p2" }, data: { provider: "nowpayments" } });

  // ---- the daily check releases them and never reverses a subscription reference
  const sw = await runRewardsSweep(new Date(Date.now() + 8 * 86_400_000));
  check("sweep: commissions are RELEASED, none reversed", sw.errors.length === 0 && (await prisma.referralCommission.count({ where: { status: "REVERSED" } })) === 0 && (await prisma.referralCommission.count({ where: { status: "RELEASED" } })) > 0, JSON.stringify(sw.errors));

  // ---- an Algo Contract payment keeps its own plan: the universal percent must not be added on top
  await prisma.marketplacePurchaseIntent.create({ data: { id: "int2", buyerId: "buyer", marketplaceListingId: "lst", tradingSystemId: "ts", versionId: "v1", platform: "MT5", releaseId: rel.id, amount: 79, currency: "USD" } });
  await prisma.rewardCheckout.create({ data: { userId: "buyer", productKey: "BTC_AI_ALGO", month: "2026-10", slotHoldId: "none", intentId: "int2", termsVersion: "t", consentAt: new Date() } });
  await ipn({ payment_status: "finished", order_id: "mkt_int2", payment_id: 7000002, price_amount: 79, created_at: new Date().toISOString() });
  const p2row = await prisma.purchase.findUnique({ where: { providerRef: "7000002" } });
  check("an Algo Contract payment gets no universal percent commission", !!p2row && (await comm(p2row.id)).length === 0);

  // ---- flag OFF: nothing is credited
  delete process.env.REFERRAL_ALL_PRODUCTS;
  await ipn(sub(6));
  check("flag OFF: a renewal creates no commission", (await comm("sub:7100006")).length === 0);

  // ---- the wallet shows where each commission came from, with the buyer masked
  process.env.REFERRAL_ALL_PRODUCTS = "true";
  const w = await loadWallet("p2");
  const wProduct = w.entries.find((x) => x.detail.startsWith("Product: Third party EA"));
  const wSub = w.entries.find((x) => x.detail.startsWith("Pro plan payment"));
  check("wallet: a product commission names the product and a masked buyer", !!wProduct && wProduct.detail === "Product: Third party EA - B***" && wProduct.title === "Referral commission (level 2)", wProduct?.detail);
  check("wallet: a Pro payment commission names the source and a masked buyer", !!wSub && wSub.detail === "Pro plan payment - B***");
  check("wallet: no email address and no full name anywhere", w.entries.every((x) => !x.detail.includes("@") && !x.detail.toLowerCase().includes("buyer")));
  check("wallet: totals by type match the rows", w.totals.byType.products === 79 && w.totals.byType.subscriptions > 0 && w.totals.referralTeam === w.totals.byType.products + w.totals.byType.subscriptions + w.totals.byType.contracts, JSON.stringify(w.totals));
  delete process.env.REFERRAL_ALL_PRODUCTS;
  await wipe(); // leave the scratch database clean for the other e2e scripts
  console.log(failed === 0 ? "\nWEBHOOK E2E ALL PASS" : `\nWEBHOOK E2E ${failed} FAILED`);
}
main().catch((e) => { console.error(e); failed++; }).finally(async () => { await prisma.$disconnect(); process.exit(failed === 0 ? 0 : 1); });
