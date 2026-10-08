# Seller listing - simple, MQL5-Market style (spec v2, 2026-10-08)

Owner brief (supersedes v1): keep it simple, like MQL5 Market. Seller uploads the product, optionally submits a backtest
report, adds logo / banner / price. If our system can check the report it does; if not, the listing says **Not checked**.
Sellers who want to prove real-time results attach their demo or live account. No admin step.

## 1. The seller's whole flow (one page, 4 blocks)

1. **Product file** - `.ex5`, `.ex4`, or any other type (`.zip` of a Pine / cBot / Ninja / Python / indicator / template package).
   Platform is picked from a list (MT5, MT4, cTrader, NinjaTrader, TradingView, Other).
2. **Backtest report (optional)** - the MT5 Strategy Tester report (`.xlsx` / `.html`).
3. **Listing details** - title, description, logo, banner, price.
4. **Real-time proof (optional)** - "Attach your demo/live account": install the free AT24 Live Sync EA, pick the results page.
   (Already built: Live Results page -> `listingSlug` -> "Live results of this EA" card on the listing.)

Click **Publish** -> the listing is live and buyable immediately. Nothing waits for an admin.

## 2. What the listing shows (honest labels, never editable by the seller)

| Situation | Label on the listing |
|---|---|
| No report, or a report we cannot read (MT4 report, other platform) | **Not checked** |
| MT5 report readable and the M2-M7 chain finishes | **Checked from the seller's report** + the computed Trust State details (see rule below) |
| Live account attached | separate card: **Live results** (DEMO / REAL label, "terminal-reported, not broker-verified") |

Rule: a Trust State computed from a seller-submitted report is shown as "checked from the seller's report" and is **never**
displayed as the independent `VALIDATED` badge (a report file can be edited). `VALIDATED` stays reserved for AT24-run
backtests (the owner's own products today).

## 3. What runs automatically

- **Upload** straight to a **private** Supabase Storage bucket (same service-role client already used for media); size limit;
  the seller never sees other sellers' files; downloads only via the existing licensed download route.
- **File hygiene** at upload (cheap, instant): allowed extensions only per platform, no `.dll/.exe/.bat/.ps1/.js/.lnk` inside
  a zip, `.ex5/.ex4` header sanity, SHA-256 stored (new hash = new release, as today).
- **Report check**: when a report is uploaded a job row is created; one small worker on our VPS (the existing Python M2-M7
  code, unchanged) picks it up, parses it, runs the chain, writes the result. Failure or unsupported format -> stays
  "Not checked" with the reason. No tester runs, no per-seller compute beyond parsing a report.
- **Buy button** turns on when a price and a stored file exist (same rule as today, now satisfied by the upload).

## 4. Admin load

Zero in the normal path. Only: buyer reports (several distinct reports -> listing auto-suspended, release `REVOKED`),
refund disputes, and (later) payout approvals.

## 5. Phases

1. **Upload + publish**: private bucket, `ListingBuild` row, upload API + wizard block 1 & 3, download route reads from
   Storage (repo path kept as fallback for existing products). Seller can list and sell with no admin step.
2. **Report check**: `ReportCheckJob` table + VPS worker + wizard block 2 + "Not checked / Checked from report" label.
   **BUILT 2026-10-09**: `ReportCheckJob` (additive migration), seller endpoint `.../listings/:id/report`, worker endpoints
   `/api/report-check/v1/claim|complete` (bearer `REPORT_CHECK_WORKER_SECRET`, outbound polling - no inbound port),
   `quant-engine/service/report_check_worker.py` (+ `setup-report-check-worker.ps1`) around the unmodified M2 evidence engine,
   public `ReportCheckCard`. Scope decision: only M2 runs (parse + recompute from the Deals table + compare with the report's own
   summary). M3-M7 are NOT run: they need a version registry and the real market bars, and their Trust State must stay
   reserved for AT24-run backtests. Limits: report <= 50 MB (Supabase per-file cap), 3 reports/listing/day, 3 attempts/job.
3. **Real-time proof in the wizard**: block 4 (attach Live Results page) + live-vs-report comparison line.
   **BUILT 2026-10-09**: wizard explainer (attach itself already existed: Live Results page -> listing picker) + "Report vs live" drawdown line on the report card when a live page is attached.
4. **Money**: seller account, earnings ledger, 10% commission (owner-platform products 0%), payouts. Owner decisions pending:
   payout method, hold days, who bears gateway fees, seller KYC level. No buyer top-up wallet (custodial risk).
5. **Hardening (later, optional)**: DLL-off attach check (see appendix), buyer report button, auto-suspend.

## Appendix - tested MT5 facts (2026-10-08, build 6230) for the later hardening step

- The Strategy Tester does **not** block DLL imports even with `AllowDllImport=0`.
- A compiled `.ex5` does not expose its imports (no `dll` / `kernel32` strings), so a file scan cannot find them.
- Attaching an EA to a live chart with global DLL permission OFF **does** stop a DLL-importing EA from initialising; the
  permission is stored per chart, so such a check needs a fresh instance/profile each time.
- Tester agents cannot read the terminal's `MQL5\Files` (the XXX US30 backtest ran without its model file).
