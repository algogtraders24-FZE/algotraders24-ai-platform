# Algo Contracts - $10 live test (owner only)

A contract called **Test Contract (owner only)** costs **$10**: rebate 4 x $1 (one instalment a day, so the whole thing finishes in 4 days),
net price $6, referral commission 20 cents direct (2% / 1% / 1% / 1% of $10 = 20 / 10 / 10 / 10 cents). Only owner accounts
(`algogtraders24@gmail.com`, `pravinawari@outlook.com`) can see or buy it. Everything else behaves exactly like the real contracts.

## 1. Vercel settings (Production), then redeploy
| Variable | Value | Why |
|---|---|---|
| `REWARDS_HOLD_DAYS` | `0` | a released amount is withdrawable at once (normal: 7) |
| `REWARDS_MIN_PAYOUT_USD` | `1` | minimum withdrawal $1 (normal: $50; it can only be lowered) |
| `REWARDS_WITHDRAWALS` | `true` | only for the test; set it back to off/empty afterwards |
| `REWARDS_MULTI_LEVEL` | `true` (optional) | to see the upper levels paid |
After the test **delete the first two** so the real rules (7-day hold, $50 minimum) apply again.

## 2. Make the product
1. Marketplace -> sell: create a listing **priced exactly $10.00 (one-time)**, upload a build (any of the v1.03 `.ex5` files), publish it. Note the listing id.
2. Admin -> **Algo Contracts** -> *Products* -> row "Test Contract (owner only)": paste the listing id, **Save and switch on**. It refuses if the price is not $10 or there is no published build.
3. Admin -> *Monthly slots*: open this month for the test product with limit 1 or 2.

## 3. People you need (each needs a paid Pro plan and a verified identity)
- **Buyer**: an account with a real paid Pro plan and KYC verified.
- **Referrer** (optional, to test commission): another account, same conditions. On Algo Contracts press *Create my referral link*.
  Owner accounts can create a link even without Pro/KYC, but are only PAID when they qualify.

## 4. Run the flow
1. Referrer: copy the link (`.../r/CODE`). Buyer: open it in a browser, log in, open Algo Contracts, buy the Test Contract (two ticks, then pay about $10 in crypto).
   Note: NOWPayments has a minimum amount per coin; if it refuses $10, choose a coin with a lower minimum.
2. After payment: the page shows the contract (Preparing documents, then Active), the email with the contract PDF arrives, *Product and key* leads to the licence page.
3. Admin -> Algo Contracts: the contract is listed, the reserve shows $4 held and balanced.
4. Next day (or press **Run the daily check now** in admin on each of the 4 days): instalment 1 ($1) is released. The referrer's 20 cents is released at the first check.
5. Buyer: *Balance and withdrawals* shows $1 available. Press Withdraw (TRC20/ERC20/BEP20 address). Admin -> *Open withdrawals*: mark paid with the transaction reference.
6. Check the pause rule: let the buyer's Pro lapse or remove KYC (in a test account), run the daily check, and the next instalment shows **paused, kept for you**.

## What to look at
Price/rebate/net on the card and in the PDF; the 4 dates; commission amount; the contract PDF download; the email; the reserve staying balanced; the badge ("Test Diamond", grey).

Tested on a scratch Postgres (`scripts/e2e-rewards-db.ts`, the "TEST contract" block). Not yet run against NOWPayments or live storage.
