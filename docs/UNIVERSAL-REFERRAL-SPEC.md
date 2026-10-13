# Universal referral (same plan as Algo Contracts, on every product) - design v0.1

Status: BUILT behind `REFERRAL_ALL_PRODUCTS` (default OFF), owner decisions below applied. Not live. Everything below is behind one new flag, `REFERRAL_ALL_PRODUCTS` (default OFF). Counsel has not
answered on the multi-level plan (see REWARDS-PARTNER-PROGRAM-SPEC.md s.15); this must not go live before that.

## The plan (owner's decision, 2026-10-13)
One referral link per member (`/r/CODE`, already exists). Whoever joins through it is attached to that member. From then on, when that person pays for
anything (a product or a Pro subscription), the referral commission is paid the same way as on an Algo Contract:

| Level | Who | Share of the price paid |
|---|---|---|
| 0 | direct partner (the person who brought the buyer) | 2% |
| 1 | the partner above them | 1% (only while `REWARDS_MULTI_LEVEL` is on) |
| 2 | next one up | 1% (same flag) |
| 3 | next one up | 1% (same flag) |

Rules copied from Algo Contracts, unchanged:
- A level is paid only if that person has an ACTIVE PAID Pro plan (a real payment, not admin-granted) and a verified identity (KYC) at the moment of the sale.
  A level that does not qualify earns nothing; the people above are judged on their own.
- Commission is a fixed amount in cents, computed once when the payment is confirmed (rounded down to the cent). Never recalculated.
- Held for `REWARDS_HOLD_DAYS` (7), then released into the same balance. Withdrawals use the same manual USDT flow, same minimum.
- A refunded or reversed payment reverses the commission (REVERSED), exactly like today.
- Self-referral earns nothing. A person is never paid twice on one sale.

## What changes vs today
Today the link only works inside Algo Contracts: the cookie is read at contract checkout (30-day window) and the commission is a fixed dollar amount per contract.
New:
1. **Attach at signup.** When an account is created and the `at24_ref` cookie is present, record a `ReferralAttribution` row (purchaseId = null). The chain above a buyer
   is already found from the earliest attribution of that buyer (`resolveUpline`), so nothing new is needed to walk the levels.
2. **Percent commission on any payment.** New pure function `computePercentShares(amountCents, buyerId, upline)` next to `computeReferralShares`.
3. **Hook points (after the payment is verified and the licence/plan is issued, never before):**
   - marketplace NOWPayments webhook (`mkt_` orders) for products that are not Algo Contract products;
   - Pro subscription activation from the NOWPayments webhook.
   Both are best effort: a failure is logged and recorded, it never undoes or hides the payment (same pattern as `fulfilRewardCheckout`).
4. **Commission rows.** `referral_commissions.purchaseId` already holds a plain string, so a subscription payment uses `sub:<paymentId>` and a product uses its Purchase id.
   `(purchaseId, level)` stays unique, so a replayed webhook cannot pay twice. No migration needed for the commission itself.
5. **Refund reversal for subscriptions.** `releaseService` looks purchases up in the `purchases` table. A `sub:` reference has no row there, so it needs its own check
   (provider refund state). Until that exists, subscription commissions stay in the hold period and are reviewed by hand before release (see Decisions, d3).

## Decisions I need from the owner (my recommendation first)
- **d1. Seller products (other people's listings).** Recommend: EXCLUDE. The platform keeps 10% of those sales; paying up to 5% across four levels would eat half of it, and
  the seller never agreed to fund referrals. Only AT24's own products and subscriptions pay referral.
- **d2. Subscriptions: first payment only, or every renewal?** Recommend: FIRST payment only (same as a one-time contract). Renewals every month for years is the
  heaviest legal and cost exposure. If you want renewals, cap them at 12 months.
- **d3. Subscription refunds.** Recommend: hold subscription commissions for the full 7 days and release only after a manual check until the refund check is built.
- **d4. How long does a person stay attached?** Recommend: LIFETIME for the first purchase window of 12 months after signup, then no new commissions. A permanent
  attachment is the most attractive for promoters but the heaviest for counsel.
- **d5. Amounts.** 2/1/1/1 percent of the price paid. On a $20 Pro plan that is 40c / 20c / 20c / 20c. Confirm percent (not fixed dollars) for non-contract products.

## Risks to be honest about
- Counsel: four levels of commission is the part most likely to be restricted in some countries. `REWARDS_MULTI_LEVEL` stays off until counsel answers; with it off
  only the direct 2% is paid.
- Margin: on a $20 plan with all four levels the payout is 5% = $1.00 before gateway fees. On the $15 test product it is 75 cents. Check against your cost per product.
- Abuse: the real defences are the same as the contract programme (paid Pro + KYC for every earner, hold period, reversal on refund, self-referral block). Account
  farming still needs watching; a daily admin report of "commissions by partner" is cheap to add.
- Wording: call it "referral commission". Never "revenue share", "distribution" or "income" (spec s.15 banned words).

## Build plan (after the decisions)
1. Pure: `computePercentShares` + unit checks in `scripts/validate-rewards.ts`.
2. Signup attribution (find the account-creation path; record the cookie once, first touch wins).
3. Marketplace hook + subscription hook behind `REFERRAL_ALL_PRODUCTS`.
4. Extend the Algo Contracts page "Refer and earn" card and admin overview with the new commission source.
5. Scratch-DB e2e: product sale, subscription sale, 4 levels, ineligible level skipped, refund reversed, replayed webhook pays once.
6. Live test with the owner accounts at $15, like the contract test.


## Owner decisions (2026-10-13) and how they were built
- d1 other sellers' products: INCLUDED. (The commission is paid from the platform's side; seller earnings are not reduced.) Watch the margin: max 5% payout vs the 10% platform cut.
- d2 subscriptions: EVERY paid renewal pays (reference `sub:<paymentId>`, so a replayed IPN pays once).
- d3 refunds: no refund option for subscriptions; a commission is only ever created from a CONFIRMED payment, so a failed payment creates none. Product refunds still
  reverse the commission through the purchase status (unchanged). Subscription commissions are never marked refunded by the sweep.
- d4 attachment: NO time limit (first touch at signup, never re-attached).
- d5 amounts: percent of the price paid, 2/1/1/1, rounded down to the cent.
Built: `computePercentShares` (lib/rewards/money.ts), `services/rewards/universalReferral.ts` (signup attribution + credit), `services/rewards/upline.ts` (shared),
hooks in `SessionService` (signup, cookie-gated, new accounts only), the NOWPayments webhook (products and subscription payments). Tests: validate-rewards (+8) and the
scratch-DB e2e (+9: flag off, direct only, 4 levels, replay, renewal, ineligible level, no partner, hold, sweep).
Before going live: counsel, the "Refer and earn" copy on the Algo Contracts page still says "buys a contract" (update when the flag is switched on),
and a live test at a small price like the contract test.
