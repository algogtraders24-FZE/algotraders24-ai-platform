# AT24 Rewards & Partner Program — Phase 0 Spec

**Status:** DRAFT for owner approval. Planning only.
**Authorizes:** nothing. No schema change, migration, production config, payout or public launch is authorized by this document. Each build phase needs separate explicit approval.
**Date:** 2026-10-12
**Inputs:** owner's plan (this session) + ChatGPT "Rewards & Partner Revenue Framework v0.1" + a read of `origin/main`.

---

## 1. What the program is (one paragraph)

A **Pro member ($20/month) who is KYC-verified** can take a **12-month contract** for one of three AT24 expert advisors (BTC AI Algo, Gold AI Algo, Index AI Algo). They pay the list price, receive the real product (MT4/MT5 EA files + signed licence) and a contract PDF, and receive a **fixed quarterly rebate** (credited in 4 instalments, withdrawable in USDT) while the contract and their Pro plan are active. Eligible members can also earn **referral commission** on genuine paid sales they bring in. Slots are limited to a maximum of 10 per month and the admin decides each month whether to open the next.

## 2. Non-negotiable design principles

1. **A rebate is a price adjustment, not a return.** It is fixed at purchase, written in the contract, capped at a % of the buyer's own payment, and never depends on other users' purchases, company revenue, trading results or profit. It is funded by the buyer's own payment and **reserved on the day of sale**.
2. **Net price is the real price.** Every page, checkout and contract shows list price, rebate schedule *and* net price (e.g. `$4,999 list, $500 per quarter rebate, net $2,999`). No inflated-reference-price marketing.
3. **No guarantee language anywhere.** Banned words: stake, staking, invest, investment, APY, ROI, returns, passive income, profit share, guaranteed, earn while you sleep. Allowed: licence, contract, rebate, loyalty, partner commission.
4. **Referral commission only on genuine, collected, verified sales.** Never for recruiting, never for fees, never self-referral.
5. **Server is the only authority.** Browser-submitted amounts, slots, eligibility or referral data are never trusted. Every money movement is idempotent and has an audit event.
6. **Everything ships behind feature flags, default OFF.** Existing production flows (billing, licences, seller earnings) are not changed, only reused.

## 3. Parameters (all configurable in admin, not hard-coded)

| Parameter | Initial value | Note |
|---|---|---|
| Eligible plan | Pro ($20/month) | must be `ACTIVE` and not past `currentPeriodEnd` |
| Identity | `SellerIdentity.status = VERIFIED` (Sumsub) | reuse; flag for this program |
| Contract term | 12 months | `License.expiresAt` = purchase + 12 months |
| BTC AI Algo | list $4,999 / rebate 40% = $2,000 / $500 per quarter / net $2,999 | |
| Gold AI Algo | list $9,999 / rebate 50% = $5,000 / $1,250 per quarter / net $4,999 | |
| Index AI Algo | list $29,999 / rebate 60% = $18,000 / $4,500 per quarter / net $11,999 | see §5 |
| Fixed dollars, not percentages | Rebate and referral are stored as **fixed dollar amounts** (e.g. BTC $2,000 = $500 × 4, i.e. about 40%, not 40% of $4,999 = $1,999.60). Referral per level: BTC $100/$50/$50/$50, Gold $200/$100/$100/$100, Index $600/$300/$300/$300. | decided during Phase 1 |
| Slots | max 10 per month, per product limits set by admin | admin opens/closes each month |
| Referral | 2% / 1% / 1% / 1% of list price, fixed dollar amount shown to the partner | level 1 live; levels 2–4 behind a flag until counsel approves |
| Payout | USDT TRC20/ERC20/BEP20, minimum $50, admin approved | reuse `SellerPayout` pattern |
| Hold period | 7 days after each release before withdrawable | reuse seller earnings convention |

## 4. Eligibility rules

A user may **buy a program contract** only if, at checkout time (re-checked on payment verification): Pro active, identity VERIFIED, a slot is available for that product/month, the product is enabled.

A user may **receive a rebate instalment or withdraw** only if, at that moment: Pro active, identity VERIFIED, contract `ACTIVE`, and the licence is not revoked.

If Pro lapses or the identity check fails later: instalments that fall due are marked `FROZEN` (kept, not forfeited), withdrawals are blocked, and they release when the user is eligible again — **provided the contract term has not ended**. Frozen amounts are never silently deleted; the contract states what happens at term end (to be settled with counsel).

Referrer eligibility: same as above (Pro + VERIFIED). A user cannot refer themselves (same user, same payment wallet, same device/IP cluster, same email domain alias → flagged for admin review).

## 5. Money model and the reserve

For a sale at list price `P` with rebate rate `r`:

- Rebate liability `R = P × r`, split into 4 equal quarterly instalments (due day 90, 180, 270, 360 after purchase).
- `R` is moved into a **segregated reserve ledger on the day the payment is verified.** The reserve is an accounting/ledger bucket plus, ideally, a separate wallet/account. Operating spend must not draw on it.
- Referral commission is calculated on collected `P`, paid after the hold period, reversed if the purchase is voided by a legally required refund.

Illustrative maximum outflow per sale (before delivery/support/payment costs, which are **TBD** until the owner provides the real cost of delivering each EA):

| Product | List | Rebate | Referral (5%) | Out | Left before costs |
|---|---|---|---|---|---|
| BTC | $4,999 | $2,000 | $250 | $2,250 | $2,749 |
| Gold | $9,999 | $5,000 | $500 | $5,500 | $4,499 |
| Index | $29,999 | $18,000 | $1,500 | $19,500 | $10,499 |

**Maximum liability if a month's slots all fill with Index:** 10 × $18,000 = $180,000 over the following 12 months (fully reserved at sale). Admin screen must show total reserved, total released, total available.

**Open option for Index:** spread the 60% rebate over 6–8 quarters instead of 4 to ease cashflow and increase retention. Decision needed.

## 6. Referral

- Each eligible partner has a referral code/link. Attribution is recorded server-side at checkout (cookie/code → `ReferralAttribution`, first-touch, 30-day window, set by the server).
- Commission amounts are **fixed dollars per product per level** published to the partner (not a percentage they must compute).
- Level 1 (direct): live. Levels 2–4: implemented but **disabled by a flag** (`REWARDS_MULTI_LEVEL`) until written counsel approval for each target market. When off, those commission rows are never created.
- Commission becomes `AVAILABLE` after the hold period if the buyer's payment is still valid. A legally required refund or non-delivery refund reverses it.
- No commission for partner sign-up, fees or recruiting.

## 7. Slots

- `RewardSlotMonth { month, productId, limit, opened (bool) }`. Admin opens a month and sets per-product limits (default total max 10).
- Checkout **reserves** a slot for 30 minutes (`RewardSlotHold`); on payment verified the hold converts to a contract; on expiry/failure it is released. Atomic (DB transaction + unique constraint) so overselling is impossible.
- Remaining slots shown to users must come from the live counter. No fake scarcity.
- When full: waitlist (email on next open month).

## 8. Purchase flow

1. Eligible user selects a program product → sees list price, rebate schedule, **net price**, 12-month term, refund policy summary.
2. Required checkboxes: accepts contract terms (versioned) and the refund policy (consent timestamp, IP and terms version stored).
3. Slot hold created, payment invoice created via existing NOWPayments checkout flow.
4. On **verified** payment (existing webhook/verification, never the browser):
   in a single transaction create `Purchase` (existing), `Entitlement` + `License` (existing, `expiresAt` = +12 months), `RewardContract`, 4 `RebateInstallment` rows, reserve entry, referral commission rows, audit events.
5. Generate contract PDF (§9). If generation fails, the contract is `PENDING_DOCUMENT`, a retry job runs and the admin is alerted; the user is told the document is being prepared, never shown a broken state.

## 9. Delivery: product download and contract download

**Product download** — reuse `ReleaseArtifact`/`License` private-release download. Signed, short-lived link, only for the buyer, only while the entitlement is `ACTIVE`; every download logged (`RewardDownloadLog`: who, when, version, IP). New builds are fetched from the same place.

**Contract download** — a PDF generated at purchase containing: user name, email, user ID, product, list price, rebate schedule with dates, net price, 12-month term, refund policy, terms version, contract ID, issue date. Stored privately; SHA-256 hash stored in `RewardContractDocument`. Terms are a **snapshot**: later changes never alter an issued contract. A copy is emailed. A "Download contract" button stays on the dashboard permanently.

**Entity block:** the owner has decided the contract names only `algotraders24.ai` and no company name, licence number or address. The template has a single config field `legalEntityBlock`, empty by default. **Counsel should confirm** (§15) whether consumer/e-commerce rules in the target markets require seller identification, since an enforceability gap hurts the company, not only the buyer. Changing it later is a config change and does not alter already-issued contracts. Contracts include only the buyer's name/email/ID — never KYC documents (those stay with Sumsub).

## 10. Withdrawal

Reuse the `SellerPayout` model pattern (new `RewardPayout`, separate ledger so seller and program money never mix): USDT, network + address validated, minimum $50, amount ≤ AVAILABLE balance, requires Pro active + VERIFIED at request **and** at admin approval, admin marks PAID with tx reference. Balances: `FROZEN`, `HOLDING`, `AVAILABLE`, `REQUESTED`, `PAID`, `REVERSED`.

## 11. Refund policy

The existing page `frontend/app/company/refund-policy/page.tsx` already says sales are final once a licence is issued, with exceptions (duplicate charge, paid but no licence issued, product materially different, request within 14 days). The program keeps that policy and adds consent at checkout. Required rewrites: that page says refunds go "via Stripe" — stale, since payments are NOWPayments crypto; update before launch. A blanket "no refund under any circumstance" clause is **not** used because it would not override mandatory consumer rights and would weaken the other clauses.

## 12. Data model (proposal — no migration authorized)

`RewardProduct` (config per product: price, rebate %, installments, term, enabled) ·
`RewardSlotMonth`, `RewardSlotHold` ·
`RewardContract` (userId, productId, purchaseId, licenseId, status ACTIVE/FROZEN/ENDED/REVOKED/PENDING_DOCUMENT, startsAt, endsAt, termsVersion, consentAt, consentIp) ·
`RewardContractDocument` (contractId, storagePath, sha256, createdAt) ·
`RebateInstallment` (contractId, seq 1–4, dueAt, amount, status SCHEDULED/FROZEN/RELEASED/CANCELLED, releasedAt) ·
`ReferralCode`, `ReferralAttribution` (codeId, buyerId, purchaseId, createdAt) ·
`ReferralCommission` (purchaseId, partnerId, level, amount, status, availableAt) ·
`RewardLedgerEntry` (append-only; type, amount, refId, idempotencyKey unique) ·
`RewardReserveEntry` ·
`RewardPayout` ·
`RewardDownloadLog` ·
`RewardAuditEvent`.
All money columns in integer cents, not floats (the existing models use floats; this module will not).

## 13. Screens

**Admin:** program on/off flags; products & rebate config; monthly slots (open/close, per-product limit, waitlist); contracts list and detail (status, instalments, freeze/revoke with reason); reserve dashboard (reserved / released / available / liability by month); referral and commission review (self-referral flags); payout queue (approve/reject, tx ref); audit log; contract template version manager.

**User:** program landing (eligibility checklist: Pro / KYC / slot), checkout with net-price display, My Contracts (status, next rebate date, instalment table, Download product, Download contract), Rewards balance (frozen/holding/available/paid), withdrawal request, referral link and commission table.

## 14. Controls

Idempotent webhook handling and ledger writes (unique `idempotencyKey`); DB transactions with row locks for slots and balances; role-based admin permissions; reconciliation job (ledger = reserve + payouts); daily alert if reserve < liability; rate limits on code/withdrawal endpoints; no user input trusted for amounts; full audit trail; feature flags default OFF; owner-only pilot first, then invite-only, then public slots.

## 15. Questions for counsel (list for the lawyer)

1. Does the existing licence cover software sales/hosted services **and** a rebate/commission scheme in the UAE and any target market (India etc.)?
2. Is a fixed, pre-disclosed, withdrawable USDT rebate on a buyer's own purchase treated as a price adjustment, or could it be characterised as a return on a deposit/investment or require a stored-value/payment licence?
3. Is a 4-level referral commission permissible in each target market? What is the maximum number of levels?
4. Must the contract identify the selling legal entity, licence number and address? What are the consequences of identifying only the brand?
5. Is the refund policy (final after licence issue; defined exceptions; 14-day request window) enforceable, and is a consent checkbox sufficient?
6. Required consumer disclosures, cooling-off rights and advertising rules for this product.
7. KYC/AML duties for paying out USDT; tax and invoicing; data protection for contract records.
8. Treatment of frozen balances at contract end or account closure.

## 16. Reuse map (verified on `origin/main`)

| Need | Existing |
|---|---|
| Identity | `SellerIdentity`, `lib/marketplace/identity.ts` (Sumsub, flag `SELLER_IDENTITY_REQUIRED`) |
| Earnings/payout pattern | `SellerEarning`, `SellerPayout`, `lib/marketplace/earnings.ts` (hold 7 days, address validation, USDT) |
| Plan check | `Subscription` (`status`, `currentPeriodEnd`) |
| Purchase, licence, download | `Purchase`, `Entitlement`, `License` (has `expiresAt`), `ReleaseArtifact`, `/api/license`, `private-releases` storage |
| Payments | NOWPayments checkout and verification (owner's decision: Stripe is dead) |
| Alerts | Telegram, email, push |

New code needed: slots, rebate engine and cron, referral attribution/commission, reserve ledger, contract PDF, program checkout, admin and user screens, program-level eligibility/freeze logic.

## 17. Build phases (each needs separate approval)

0. **This spec** + lawyer list. ✅
1. Foundation: models, ledger, eligibility, validate scripts (flags OFF).
2. Purchase flow: slots, consent, checkout, contract + licence issue, PDF, downloads.
3. Rebate/referral engine: quarterly release job, freeze logic, reserve and reconciliation.
4. Withdrawal: `RewardPayout`, admin approval.
5. Admin and user screens.
6. Verification: validate scripts, demo end-to-end, security review (double-spend, slot races), owner-only → invite-only → public.

The owner will supply the MT4/MT5 EA files last; until then products use placeholder releases. **Public launch is gated on counsel's written answers to §15.**

## 18. Decisions and inputs still needed from the owner

1. Real delivery/support cost per EA (to finalize margin).
2. Index rebate: 4 quarters, or spread over 6–8?
3. Referral base: list price (as planned) — confirm; and whether referrers must hold an active contract or only Pro + KYC.
4. Referral cookie window (proposed 30 days).
5. What happens to FROZEN balances at term end (counsel + owner).
6. Minimum payout ($50 proposed) and hold period (7 days proposed).
