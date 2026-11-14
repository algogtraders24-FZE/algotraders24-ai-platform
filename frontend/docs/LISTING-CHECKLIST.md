# Listing checklist (read before you create or edit ANY marketplace listing, post or page)

These are the problems that keep coming back. Each one cost us a fix PR. Check them before you publish, not after.

## 1. Title (what Google and the share card show)
- The site adds ` — Algotraders24 AI` to every page title. Keep the listing title **<= 40 characters** if you can; `pageTitle()` (lib/seo/titles.ts) drops the suffix when the whole thing would pass 60, and cuts at a word beyond that. Do not put the platform, the asset, "EA", "v1.02" and a slogan all into the title.
- The platform goes into `platformTag` (MT4, MT5, TradingView). It is added to the description automatically for twin listings, so do not repeat it in the title unless the two builds must look different.
- One title per listing. No two listings with the same title.

## 2. Description (the first ~150 characters ARE the Google snippet)
- The meta description is cut at 155 characters. The **first sentence must stand alone**, say what the tool does, and be written for the listing: not a quote, not "Hello traders", not markdown, not a URL.
- 70-155 characters of useful text before anything else. No "[PRODUCT NAME] by ALGOTRADERS24 AI" headers at the top.
- MT4 / MT5 / TradingView builds of the same idea must **not share their first sentence**. (`withPlatform()` now prefixes the platform, but write them differently anyway.)
- Apostrophes are fine; do not paste HTML.

## 3. Never publish
- **No main logic** of an EA or indicator (entry, exit, ATR rules, filters, parameters that reveal them) in a listing, README or post. Generic wording plus honest evidence and risk only.
- **No profit claims, win-rate promises, "guaranteed", "AI never loses", signals or buy/sell calls.** Backtest numbers only with the label BACKTEST, the real report, and its settings. Never fake a Trust State (VALIDATED needs the real checks) and never fake ratings or reviews (structured data too).
- Third-party code or licences that are unconfirmed: do not sell.
- Always carry "Not financial advice" where results appear.

## 4. Test and demo listings
- A test listing that was ever public stays in Google as a 404 (`/marketplace/at24-test-contract-owner-test`). Create tests **unpublished**, with an obviously fake slug, and delete them when done.
- Do not use real user data, keys or secrets in a listing, a script or a screenshot.

## 5. Cost and load (Vercel + Supabase)
- Every push builds. **Batch changes into fewer PRs.** Docs-only and `.md`-only changes skip the build on purpose.
- Supabase egress went 12.9 GB on a 0.18 GB database because the full blog list was read thousands of times. Do not add queries that read a whole table or big JSON on every request, in a cron every few minutes, or in a loop. Select only the columns you need, cache lists, and check `Query Performance` after a new cron or page.
- Never turn on Vercel's "pause production deployments" budget switch: it takes the whole site offline when the budget is hit.

## 6. Before you open the PR
- `npm run validate:seo` (title/description length rules, twin descriptions, canonical, schema) and the validator for what you touched. `npx tsc --noEmit`, `npx eslint <files>`.
- After deploy, run the production crawl (all sitemap URLs: status, title and description length, one h1, canonical, og:image, noindex) and fix what it flags. A new listing page should show: title <= 60 rendered, description 70-155, `Product` + `Offer` JSON-LD only when price and release are real.
- Say plainly in the PR what you did **not** verify.

## 7. How we work
- The owner reads Hinglish: explain first, in plain words, then build. Report faithfully: if a test failed or something was skipped, say so.
- Recurring decision rules live in the shared memory folder (`MEMORY.md` index). Read it at the start of a session.
