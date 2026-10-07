# AT24 Live Sync — Product + Technical Spec (no code)

Status: DRAFT for owner review, 2026-10-08. Implementation NOT authorized.
Builds on: `TRADER-EDGE-ANALYZER-SPEC.md`, `MT5-MCP-PHASE0-RD.md`, and the 2026-10-08 hands-on test of a
third-party MT5 connector (notes at the end).

## 1. Goal

Give a trader a **live** AT24 experience with their own MetaTrader 5 account, with **zero install beyond one
Expert Advisor**: live equity and positions, an Edge Analyzer that updates itself (no report upload), and a live
risk monitor. Later: a verified track record, and (separate decision) an own-accounts trade copier.

### Non-goals (hard rules)
- AT24 never receives broker credentials, never connects to the broker, never places or modifies orders.
- The EA is **read-only by construction** (it contains no trade functions; this is checked by a script, §8).
- No advice, no signals, no profit claims.

## 2. What the user does

1. In AT24: **Dashboard → Live Sync → Create device token** (shown once).
2. Download the EA (`AT24LiveSync.ex5` + readable `.mq5` source) and attach it to ONE chart.
3. MT5: *Tools → Options → Expert Advisors → Allow WebRequest for listed URL* → add `https://www.algotraders24.ai`.
4. EA inputs: paste the token. Done. The chart shows "AT24 Live Sync: connected, last sync 12:04:31".

No Python, no command line, no passwords. The EA is **demo-only by default** (`AllowLiveAccount=false`); a live
account needs the user to flip that input knowingly.

## 3. Verified platform facts (MQL5 docs) and what they force

| Fact (source: mql5.com/en/docs) | Consequence for the design |
|---|---|
| `WebRequest()` works in EAs and scripts only, not indicators | Must be an Expert Advisor |
| The URL must be on the terminal allow-list (Tools → Options → Expert Advisors) | Setup step 3; EA detects the failure and shows instructions |
| Only HTTP/HTTPS on ports 80/443 | Endpoint on `https://www.algotraders24.ai` (443) |
| `WebRequest()` is synchronous (blocks) with a timeout | Short timeout (5 s), small batches, run from a timer, never in a tick hot path |
| `WebRequest()` cannot run in the Strategy Tester | Cannot be backtested; verified only on a live/demo terminal |
| `CryptEncode` offers SHA-256 but **no HMAC** | No HMAC signing. Integrity comes from TLS + bearer token + a SHA-256 hash chain (§6) |

Not found in the docs / still **unverified**: practical request-size limits, exact behaviour on reconnect, and that
the EA compiles and runs on the owner's terminal (needs the prototype).

## 4. Data the EA sends (and what it never sends)

**Sends** (batched JSON over HTTPS):
- **Deals** from history (`HistorySelect`): ticket, positionId, time (ms), symbol, type (buy/sell/balance), entry
  (in/out/inout), volume, price, commission, swap, profit, fee, magic, comment (truncated to 40 chars).
- **Snapshots** (every ~30–60 s): balance, equity, margin, free margin, and open positions (ticket, symbol, side,
  volume, open price, SL, TP, profit; max 50).
- **Account facts, no identity**: currency, mode (demo/real/contest), margin mode (hedging/netting), leverage, and the
  **server-to-UTC offset** (fixes the Edge Analyzer's "broker time" caveat), terminal build.
- A per-account **`accountKey`** = SHA-256(login | server | `accountSalt`), where `accountSalt` is issued by AT24 at
  handshake. AT24 stores only this hash.

**Never sends:** account number, holder name, company, server name, broker credentials, anything from other charts.
The server **rejects** any payload containing forbidden field names (`login`, `name`, `server`, `company`, ...).

## 5. API (stateless, bearer-authenticated; outside `/api/private`, like `/api/mcp`)

- `POST /api/live-sync/v1/handshake` → `{ accountSalt, minIntervalSec, maxBatchDeals, serverTime }`
- `POST /api/live-sync/v1/ingest` → body ≤ 200 KB, ≤ 500 deals, ≤ 50 positions. Response `{ ackSeq, nextSeq, chainHead }`.
- Auth: **device token** (`at24_sync_…`), hashed at rest, shown once, revocable, scope `ingest` (write to OWN data only;
  cannot read anything; separate from the MCP read tokens).
- Gates (fail closed, cheapest first): kill-switch env → method → body size → token → per-device rate limit
  (≤ 30 req/min) → schema validation → forbidden-field check → idempotent write.
- Idempotent: deals keyed by `(accountId, dealTicket)`; resending a batch is harmless.
- Kill switch: env flag turns ingestion off instantly; revoking a token cuts one device immediately.

## 6. Integrity: tamper-evident, and honest about what that means

Each batch carries `seq` (monotonic) and `hash = SHA-256(prevHash || canonicalBatch)`; AT24 stores `prevHash/hash/
receivedAt`. This gives an **append-only commitment**: once reported, a trade cannot be quietly removed or reordered
without breaking the chain, and a restart of the chain is visible as a gap/fork. On first sync the EA reports the full
history, and AT24 **reconciles** (sum of deal results + balance operations vs. reported balance), the same idea as the
Edge Analyzer's check against the terminal's own summary.

**What this does NOT prove** (must be stated wherever "verified" appears):
- The EA runs on the user's machine; a determined user can modify it or rebuild the chain. This is "reported by the
  user's terminal since <first sync>", not independent broker verification.
- Anything before the first sync is whatever the terminal reported then.
- Stronger proof would need a broker-level read-only (investor password) link or a broker integration: out of scope here.

## 7. Server data model (additive; migration applied by the owner, as before)

`LiveSyncDevice` (user, tokenHash, prefix, name, lastSeenAt, revokedAt) · `LiveSyncAccount` (user, accountKey UNIQUE per
user, currency, mode, marginMode, serverUtcOffsetSec, firstSyncAt, lastSyncAt, chainHead) · `LiveSyncDeal`
(account, dealTicket UNIQUE per account, positionId, time, symbol, type, entry, volume, price, commission, swap, profit,
fee, magic, comment) · `LiveSyncSnapshot` (account, time, balance, equity, margin, freeMargin, positions JSON) ·
`LiveSyncBatch` (account, seq UNIQUE, prevHash, hash, receivedAt, dealCount).
Retention: snapshots full-resolution 30 days then daily; deals until the user deletes them. Users can **delete an
account's data** and revoke devices at any time. Per-user isolation on every query. No PII fields exist in the schema.

Mapping to existing code: hedging deals (in/out with the same positionId) become `ClosedTrade` rows, so the Edge
Analyzer's parser-independent core (metrics, patterns, evidence, ruin) runs unchanged. Netting accounts need separate
handling and are **not** in the prototype.

## 8. The EA (design)

- `OnInit`: refuse live accounts unless `AllowLiveAccount=true`; validate token input; test the WebRequest allow-list
  and show the exact fix on failure; `EventSetTimer(30)`.
- `OnTimer`: collect new deals since the last acknowledged time → build JSON → chain hash → `WebRequest` (5 s timeout)
  → on success persist the acknowledged position (terminal global variable / file in `MQL5/Files`); on failure back off
  (30 s → 5 min cap) and keep the unsent range, so nothing is lost or duplicated.
- No JSON library in MQL5: small hand-written serializer with strict escaping and length caps.
- Status on the chart (`Comment()`): connected/last sync/queued deals/last error.
- **Read-only guarantee**: the source never includes `Trade.mqh` and never calls `OrderSend*`, `CTrade`, `PositionClose*`
  etc. A validation script scans the `.mq5` for forbidden identifiers and fails the build if any appear.
- Ships with source so users (and reviewers) can read exactly what it does.

## 9. Stages

| Stage | Scope | Needs |
|---|---|---|
| **P1 prototype** | EA v0.1 (deals + heartbeat, demo-only) · handshake + ingest · tables · token page · a status page ("last sync, N trades") | owner compiles/tests on a DEMO terminal; migration |
| P2 | Live dashboard (equity, positions, drawdown) · "Analyze my synced trades" in the Edge Analyzer (no upload) | P1 verified |
| P3 | Risk monitor: exposure, overlap, drawdown/margin alerts | P2 |
| P4 | Verified track record (optional public page, scoped wording from §6) tied to Marketplace Trust State | P2 + legal wording review |
| P5 | Own-accounts trade copier (separate owner decision; needs a lawyer's answer first) | P1–P3 |

### P1 acceptance (all must hold on a real DEMO terminal)
1. EA compiles in MetaEditor without errors; attaches; shows "connected".
2. Missing allow-list entry produces the clear fix message, not a crash.
3. A closed demo trade appears in AT24 within ~60 s; resending causes no duplicate.
4. Killing the network then restoring it loses nothing and duplicates nothing.
5. Revoking the token stops ingestion immediately; the EA reports "unauthorized".
6. Payload contains no account number/name/server (checked by capturing a request).
7. The `.mq5` scan finds no trade functions.
8. Server tests (auth, idempotency, seq/chain, size caps, forbidden fields, rate limit, per-user isolation) pass.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Account data (balance, positions) reaches our server | Opt-in per device, minimal fields, no identity, user-deletable, clear consent text |
| MQL5/WebRequest limits and blocking | Short timeout, timer-driven, small batches, backoff; verified only by the prototype |
| Windows-only, manual allow-list step is easy to miss | Detect and explain on the chart; setup guide |
| "Verified" overclaims | §6 wording is mandatory; never "independently verified" |
| Netting accounts / MT4 | Out of prototype; separate samples and design |
| Copier later reverses the "no order" stance | Separate decision, own-accounts only, lawyer first (see copier notes) |

## 11. Lessons from the third-party MT5 connector test (2026-10-08)

A community MT5 MCP server was installed and tried: it only worked after pinning `mcp<2` and patching one argument
(the published package crashed on startup), needed a Python venv and a CLI, and when asked for "demo" data the user's
terminal was actually on a live account, so live account number/balance went to the AI provider. Takeaways built into
this spec: zero-install EA; demo-only default; no identity fields; do not depend on unreviewed third-party code.

## 12. Decisions needed from the owner

1. Approve P1 scope (§9) and the demo-only default.
2. Free vs paid: suggested — Live Sync connection and status free, live dashboard/risk monitor/auto-analysis paid.
3. Distribution of the EA: direct download from the dashboard vs. as a free Marketplace product.
4. Who tests: the owner compiles and attaches the EA on a demo terminal (expect a couple of compile-fix iterations).
5. Retention defaults (§7) and the consent wording.

## 13. Decisions taken (2026-10-08, by owner delegation: "do what is best for the project")

1. P1 scope (section 9) approved as written; EA is demo-only by default.
2. Free vs paid: Live Sync connection, device tokens and the status page are free. Live dashboard, risk monitor and
   auto-analysis (P2/P3) will be paid-plan features.
3. EA distribution: direct download of the readable `.mq5` source from the dashboard (the user compiles it in
   MetaEditor, which also lets them read exactly what it does); a compiled `.ex5` can be added later.
4. Retention as in section 7; users can delete an account's synced data and revoke devices at any time.
5. Ingestion is dormant until `LIVE_SYNC_ENABLED=true` (kill switch), and the new tables need the owner-applied
   additive migration, same pattern as the MCP and Edge Analyzer tables.
6. Build order: server side first (tested without MT5), then the EA source (compiled here with MetaEditor and
   statically scanned for trade functions), then the owner's real DEMO-terminal run (P1 acceptance, section 9).

## 14. As built in P1 (differences and additions to the plan above)

- Wire contract and strict closed schema: `frontend/services/live-sync/contract.ts` + `validate.ts` (any unknown field,
  including every identity field, is rejected at every level).
- Chain hash covers integers only (`ticket:timeMsc:profitCents:commissionCents:swapCents:feeCents`), because MQL5 and
  TypeScript format decimals differently; values are stored exactly as received.
- The server returns `lastDealTimeMsc` (acks and chain errors) so a reinstalled EA resumes where the server left off
  instead of resending everything; batches are idempotent either way.
- Device tokens: `at24_sync_...`, hashed at rest, shown once, scope = write own sync data only.
- Dashboard page `/dashboard/live-sync` (device tokens, synced accounts, delete synced data). Ingestion is dormant
  until `LIVE_SYNC_ENABLED=true`; five new tables via the owner-applied additive migration `20261008120000_add_live_sync`.
- EA: `frontend/public/downloads/AT24LiveSync.mq5` (readable source; the user compiles it). Compiled here with
  MetaEditor: 0 errors, 0 warnings. `npm run validate:live-sync-ea` re-checks the read-only/no-identity claims against the
  source and recompiles it on every run (when MetaEditor is installed).
- NOT yet verified: the EA actually running inside a terminal against the real server (P1 acceptance, section 9). The
  strategy tester cannot do this (no WebRequest), so it needs a real DEMO terminal.

## 15. P1 acceptance run on a real DEMO terminal (2026-10-08)

Terminal: MetaTrader 5, Exness demo, hedging. EA compiled in MetaEditor (0 errors/0 warnings), attached to a chart.

| Acceptance item | Result |
|---|---|
| EA compiles, attaches, shows "connected" | Pass |
| EA output reaches the server; chain accepted | Pass: the first batch's SHA-256 chain hash computed by the MQL5 EA equals the server's recomputation (a mismatch would have been refused as `HASH_MISMATCH`) |
| Large history syncs without loss/duplicates | Pass so far: 7+ chained batches, 2,100+ deals = n x 300 exactly, each batch's prevHash equals the previous batch's hash |
| Snapshots (balance/equity/open positions) | Pass |
| No identity leaves the terminal | Pass by construction (strict closed schema; account shown only as a salted fingerprint) |
| No trade functions in the EA | Pass (static scan of the source) |
| Server tests | Pass (23 + 11 checks) |
| New trade appears ~60 s after closing | NOT yet run (the first sync is still catching up on old history) |
| Network loss: nothing lost or duplicated | NOT yet run |
| Token revocation stops ingestion immediately | NOT yet run |
| Missing allow-list shows the clear fix message | NOT yet run |

### Findings from the run
1. **User error found by the EA's own message:** an EA input left empty, then a wrongly pasted token, were both reported
   clearly on the chart ("paste your device token" / "UNAUTHORIZED: check the device token").
2. MT5 remembers the previous inputs of an EA, so after recompiling with a new default the chart keeps the old
   values until the EA is removed and re-attached (or Inputs > Reset).
3. The EA now writes every status change to the Experts log (`SetStatus`) and runs its first sync from the timer
   instead of from `OnInit`, so problems can be diagnosed from the journal without screenshots.
4. Catch-up order is oldest-first (it must be, for the chain): a user with a very long history waits for the
   catch-up before brand-new trades appear. Acceptable for P1; a future improvement is a "recent first" fast path
   with a clearly labelled separate segment.
5. The server's timestamp conversion used `serverUtcOffsetSec = 0` for this broker (Exness servers run on UTC).
