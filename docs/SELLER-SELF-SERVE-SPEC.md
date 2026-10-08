# Seller self-serve listing - automated trust ladder (spec, 2026-10-08)

Owner brief: a seller must be able to list an EA **without any AT24 admin step**, it must be easy, and admin load must be
as small as possible. The Live Results system (Live Sync EA + public results page) is part of the proof.
This is a design document - nothing in it is built yet. Phase 1 needs the owner's go.

## 1. Where we are (verified in code, main @ 2026-10-08)

| Step a seller needs | Today | Who does it |
|---|---|---|
| Create listing, branding, price, preview, submit | self-serve (`/marketplace/sell`, `/marketplace/my-products`) | seller |
| Upload the compiled build (.ex5 / zip) | **no route** - builds are files in `frontend/private-releases/` committed to git, registered by scripts | AT24 |
| Backtest evidence + Trust State (M2-M7 Python chain) | run by hand on a PC | AT24 |
| Show real forward results on the listing | **done**: Live Sync EA -> Live Results page -> `listingSlug` -> "Live results of this EA" card | seller |
| Money: seller share, commission, payout | **nothing** (`Purchase` has gross only; buyer pays the platform) | n/a |

Two hard facts that shape the design:
1. Vercel's file system is read-only at runtime -> seller uploads need object storage (Supabase Storage, private bucket).
2. The M2-M7 chain is Python and heavy (a 90 MB tester report took ~10 min to parse) -> it cannot run in a Vercel function;
   it needs a worker on our VPS (same pattern as the Quant Lite exec service).

## 2. The trust ladder (all automatic)

A listing climbs levels on its own; each level is shown on the listing and none can be edited by the seller.

| Level | How it is earned | Automatic gate |
|---|---|---|
| L0 Listed | seller creates the listing | schema checks |
| L1 Build checked | seller uploads the zip; worker loads the EA in the MT5 **Strategy Tester with DLL imports disabled** and runs a short smoke run | EA must initialise, place/skip orders without errors, not need DLLs; result -> release `PUBLISHED` (buyable) or `REJECTED` with the exact reason |
| L2 AT24 backtest | seller picks symbol / period / deposit / set file; **our worker runs the tester itself**, produces the report, then M2-M7 | Trust State computed exactly as today (VALIDATED only if every rule passes) |
| L3 Live forward record | seller installs the free AT24LiveSync EA and attaches the Live Results page to the listing (wizard step) | existing hash-chain + "terminal-reported, not broker-verified" disclosure; DEMO/REAL/CONTEST label |
| L4 Cross-check | system compares live vs backtest | automatic flags (below) |

Seller-uploaded tester reports are **not** the primary path: a report file can be edited, so a listing built only on it is
capped (never VALIDATED, labelled "seller-submitted report"). Independence comes from running the backtest ourselves.

## 3. Admin load = exceptions only

Admin touches nothing in the normal path. A queue shows only:
- **Auto-flags**: live drawdown > 2x backtest drawdown; live profit factor < 1 after N trades; live account stops reporting;
  results page contradicts the listing text; build re-check fails.
- **Buyer reports** (button on the listing; N distinct reports -> listing auto-suspended pending review).
- **Payout approvals** (until payouts are automated).
- **Disputes / refunds.**
Everything else - upload, build check, backtest, Trust State, publishing - is system-driven. Revoking is automatic
(`ReleaseArtifact.releaseStatus = REVOKED` already exists and download already refuses non-PUBLISHED releases).

## 4. What gets built

New tables (additive, no existing table touched except nullable columns):
- `SellerProfile` (userId, displayName, country, payoutMethod/payoutRef, termsAcceptedAt, status).
- `ListingBuild` (listingId, version, storageKey, sha256, size, status UPLOADED|CHECKING|PASSED|REJECTED, rejectReason, checkedAt).
- `VerificationJob` (listingId, buildId, kind BUILD_CHECK|BACKTEST, params JSON {symbol, period, deposit, setFile}, status QUEUED|RUNNING|DONE|FAILED, startedAt, finishedAt, logTail, resultRef).
- `ListingFlag` (listingId, source AUTO|BUYER, rule, detail, status OPEN|RESOLVED).

Server:
- `POST /api/private/marketplace/listings/:id/builds` (signed upload URL -> Supabase Storage; size/type limits; zip only).
- Worker API (token-authenticated, VPS only): claim next job, upload log/report, mark done.
- On `DONE`: reuse the existing ingestion + eligibility code and `MarketplaceEvidenceRecord`; no new trust logic.
- Download route: read from Storage instead of `private-releases/` (keep the repo path as fallback for existing products).

Worker (VPS, dedicated Windows account, **no secrets on it**):
- Portable MT5 instance per job, driven by a tester `.ini` (proven locally on 2026-10-08: tester run + report + `ShutdownTerminal`).
- Only symbols with real history on our feed are offered (XAUUSD, BTCUSD, US30, EURUSD, GBPUSD, USOIL ...).
- Per-job time limit; max concurrent jobs; per-seller quota (free: 2 backtests per listing, then paid or admin-granted).
- Writes the report -> `evidence_engine.py` -> curve -> M3-M7 (existing scripts, parametrised instead of per-product copies).

Seller UI:
- `/marketplace/sell` becomes a 5-step wizard: Account & terms -> Listing details -> Upload build + set file -> Choose backtest -> Connect Live Results.
- Status page with a live timeline (Queued -> Running -> Done) and exact failure reasons.
- Guide page rewritten to match.

## 5. Risks (and the mitigation chosen)

| Risk | Mitigation |
|---|---|
| Malicious .ex5 sold to buyers | DLL imports blocked at build check; worker has no secrets; instant auto-revoke; buyer report button; seller identity + terms; disclaimer on every listing |
| Fake performance | AT24-run backtest is the default; seller reports capped; live record is hash-chained and labelled terminal-reported |
| Cherry-picked live account | magic-number filter always shows "account has N magics"; listing shows live-vs-backtest side by side |
| Seller's IP | terms: builds are stored encrypted-at-rest, never shown, delivered only to licensed buyers; no source accepted |
| Tester cost / queue | quotas, time limits, one worker at first |
| Money (wallet, commission) | Phase 4, ledger first, **no buyer top-up wallet** (custodial risk); lawyer review before payouts go live |

## 6. Phases

1. **Storage + upload + automatic build check** (L1). Seller can list and be buyable with zero admin step.
2. **Automatic backtest + Trust State** (L2).
3. **Live Results inside the wizard + live-vs-backtest comparison + auto-flags** (L3/L4).
4. **Seller account, earnings ledger, 10% commission, payouts** (owner decisions pending: payout method, hold period, who bears gateway fees, seller KYC).
5. **Reports / auto-suspend / disputes tooling.**

## 7. Owner decisions still needed

- Phase 1 go-ahead (this spec).
- Free quota for AT24-run backtests (suggested 2 per listing).
- Worker host: the existing VPS (suggested) or a separate one.
- Commission/payout answers (Phase 4): payout method, hold days, gateway-fee bearer, seller KYC level.
