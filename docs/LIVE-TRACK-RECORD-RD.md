# AT24 Live Track Record - Myfxbook R&D and build options

Date: 2026-10-08 · Status: R&D only, no code · Owner decision needed (section 9)

Goal (owner): show real-time account results the way Myfxbook does, so a trader can watch an EA's real results
and then pick that EA from AT24.

Sources: the Myfxbook public portfolio page the owner shared (read in the owner's browser; one old 2016 demo-era
account, so layout only), Myfxbook's own verification pages, and third-party reviews/forums (links at the end).
Anything not read directly is marked "reported".

## 1. What Myfxbook actually is

A **portfolio / track-record site for traders**, funded mostly by **broker advertising and affiliate/cashback**
(the page header carries "Open an account with Pepperstone", broker ads, "Cashback", "Rewards", broker reviews, prop-firm
pages). Around the track record it has: a community, a "Systems" list (ranked accounts), Autotrade (copy trading via
partner brokers), contests, calculators, calendar/news, widgets, an API, "Backtest" and "Strategy AI" (new), and a
"Prop Mode" that scores an account against typical prop-firm rules.

### The account page (what a trader looks at) - read directly
- **Header:** account name, `Real (USD)`, broker, "Technical, Automated", leverage 1:200, platform; badges
  **Track record** and **Trading privileges**; "Live update"; share.
- **Summary strip:** Gain, Absolute gain, Daily, Monthly, Drawdown, Balance, Equity (+% of balance), Highest balance,
  Profit, Interest, Deposits, Withdrawals, Updated-at.
- **Equity growth chart** (growth % vs deposits/withdrawals) and **Monthly gain** bars, with drill-down per month.
- **Period table:** Today / Week / Month / Year for Gain, Profit, Pips, Win%, Trades, Lots.
- **Stats:** trades, pips, average win/loss (pips and money), lots, commissions, longs/shorts won, best/worst trade,
  average trade length, **profit factor, standard deviation, Sharpe, Z-score (with probability), expectancy, AHPR/GHPR**.
- **Open trades table** (open date, symbol, action, lots, price, SL, TP, pips, profit, gain).
- Other tabs on the full site (reported): history, advanced statistics, calendar, analytics, risk, monthly.

### How Myfxbook "verifies" - reported (their help page returned 403 to us)
- **Track record verified:** the user gives account number + **investor (read-only) password** + broker + server;
  Myfxbook's servers connect to the broker several times a day, download the original history, compare it with what the
  user's account sends, and mark it verified if there is no discrepancy.
- **Trading privileges verified:** the owner opens a trade whose comment is a key Myfxbook issues, proving they can trade
  the account.
- Their own caveat (reported): they cross-check with the broker's server but are not an auditor or a regulator.

### Known weaknesses (reported by users/forums; this is our opening)
1. Demo results presented as real by sellers using unverified accounts; the badge is the only defence and many users do
   not check it.
2. **"Gain %" is easy to inflate:** start with a tiny deposit, add large deposits later.
3. **Start-date filters** let a seller begin statistics at the bottom of a drawdown.
4. Verification stops at "matches the broker"; it says nothing about luck, overlap, sizing changes or tail risk.
5. The business is ads/affiliate; a visitor is a lead for a broker, not a buyer of a vetted product.

## 2. What AT24 already has (verified in this repo)

| Need | Status |
|---|---|
| Real-time data from the user's own terminal (deals, balance, equity, open positions) | **Built and live** (Live Sync P1/P2; real hedging account verified end to end) |
| Tamper-evident history (hash chain, idempotent batches, gap/fork detection) | **Built** |
| Account identity without PII (salted fingerprint only) | **Built** |
| Metrics engine: core stats, patterns, edge evidence (skill vs luck), dependence cap, Monte-Carlo risk | **Built** (Edge Analyzer; now runs on synced accounts) |
| Live panel (equity, floating, margin level, positions, 24 h curve) | **Built** (private, owner-only view) |
| Marketplace with Trust State vocabulary (UNVERIFIED ... UNDER_OBSERVATION, VALIDATED ...) and evidence records | **Built** (listings, evidence, validation; Product #1 published) |
| Public, shareable, privacy-controlled track-record page | **Missing** |
| Gain % that is deposit-adjusted, monthly/daily tables, equity-vs-balance growth chart on a public page | **Missing** (data exists; presentation and some math missing) |
| Pips per trade | **Missing** (needs symbol digits/pip size; not sent by the EA today) |
| Broker-level verification (investor-password style) | **Missing** and deliberately out of scope so far |
| Ranking/explorer, followers, widgets/embeds, API for others | **Missing** |

## 3. Metric coverage: Myfxbook page vs what we can compute today

From the synced deals (closed trades, balance operations) and snapshots (balance/equity/positions):

- **Can do now:** profit, balance, equity, highest balance, deposits, withdrawals, daily/monthly profit and gain, drawdown
  (balance and equity based), trades, lots, commissions, swap, longs/shorts won, best/worst trade, average trade length,
  profit factor, standard deviation, Sharpe-like ratio, expectancy, win rate, open trades with SL/TP, equity growth chart.
- **Need small work:** deposit-adjusted gain (time-weighted return, see section 5), period table, month drill-down.
- **Need EA schema addition (additive):** pips (symbol digits/point), "risk if all SL hit" (tick value/size).
- **Better than Myfxbook (we already have):** edge-evidence level (is it distinguishable from luck, with dependence
  caveats), Monte-Carlo risk range, reconciliation, "dependence detected" warnings.

## 4. What we can build (product concept: "AT24 Live Track Record")

A public (or unlisted-link) page per synced account, with the same look-and-feel a trader expects, but with our integrity
rules built in:

1. **Account header:** demo/real badge (forced, cannot be hidden), currency, platform, hedging/netting, "tracking since
   <first sync date>", "N days live", last update time, and the **chain head hash** (anyone can see it changes only by
   appending).
2. **Summary strip:** gain (time-weighted), drawdown, balance, equity, profit, deposits, withdrawals.
3. **Charts:** equity vs balance growth, monthly gain bars, daily table.
4. **Trades:** closed trades list and open positions (the "real-time" part), refreshed every 30 s.
5. **Stats:** the Myfxbook set plus our **Edge evidence** and **Risk range** blocks.
6. **Privacy controls (owner of the account decides):** show amounts or only percentages; delay open positions by N
   minutes (stops copy-front-running and protects the user); hide symbols if wanted; unlist/delete anytime.
7. **Marketplace link:** a listing can attach a track-record page ("results of this EA on a live account").

## 5. Rules that make it more trustworthy than Myfxbook (and cheap to enforce)

- **No start-date filter, ever.** Statistics always run from the first sync. No cherry-picking.
- **Deposit-adjusted gain:** use time-weighted return (chain-link sub-period returns between balance operations), so a
  small first deposit followed by a large one cannot inflate the percentage. Also show money-weighted for contrast.
- **Forced labels:** demo vs real, and "reported by the user's terminal since <date>; not independently verified".
- **Gap disclosure:** if the chain forked/restarted or sync stopped for more than a threshold, the page says so.
- **Many-accounts disclosure:** if one user has several synced accounts, the page shows how many exist (not their data),
  to discourage "publish only the winner".
- **Mandatory wording** from LIVE-SYNC-SPEC section 6 stays: never "verified" without the scope sentence; never
  "independently verified".
- **Trust State mapping (important):** self-reported live data may support `UNDER_OBSERVATION` / `LIMITED` for a listing
  (live days, drawdown, sample size). It must **never** by itself produce `VALIDATED`, which in this program means more.

## 6. Options and my recommendation

| Option | What | Value | Risk/effort |
|---|---|---|---|
| **A. AT24's own accounts first** | Public pages for the owner's accounts running AT24/marketplace EAs (live account already synced) | Direct answer to "traders see real results before choosing an EA"; zero third-party data risk | Low legal risk (own data); small build |
| B. Opt-in public pages for any user | Myfxbook-style open platform | Traffic and network effect | High: fraud, moderation, privacy, financial-promotion rules; larger build |
| C. Explorer/leaderboard | Ranked public accounts | Discovery | Needs B first; invites gaming |
| D. Widgets/badges/embed + share cards | Embed live stats on sellers' own sites | Distribution | Small after A |
| E. Broker-level verification | Investor-password pull from the broker (what Myfxbook does) | The strongest trust signal | Heavy: we would store investor passwords or run MT5 terminals server-side; separate security/legal review |
| F. Copy trading | Autotrade-like | Revenue | Not planned (owner decision; regulatory) |

**Recommendation: A, then D, then B in a controlled form (invite-only sellers), skip C/E/F for now.** A needs only what
exists; it also forces us to get the integrity wording and privacy controls right on our own data before opening to others.

## 7. Phased plan (each phase is a separate reviewable PR)

- **T1 - Stats engine (pure, tested):** time-weighted gain, daily/monthly tables, period table, growth series, open
  trades summary; reuse Edge engine. No schema change.
- **T2 - Public page (owner's own accounts):** `/track/<slug>` with visibility `private | unlisted | public`, privacy
  controls (percent-only, position delay), mandatory disclosure block, SEO off for unlisted. Needs one additive migration
  (visibility, slug, privacy flags) applied by the owner.
- **T3 - Marketplace link:** attach a track record to a listing; Trust State rule from section 5; "live since" shown on the
  listing.
- **T4 - Share/embed:** badge image and iframe widget (read-only, cached).
- **T5 - Controlled opening:** seller-invite flow, abuse reporting, takedown, terms.
- Later, only on separate decision: pips and SL-risk fields in the EA, broker-level verification research.

## 8. Risks

- **Legal/financial promotion:** publicly showing performance to attract buyers is regulated in many places. The entity is
  an FZE; get a lawyer's read on wording, disclaimers and any "results" display before T2 goes public (owner already has
  this open for the copier question; combine them).
- **Overclaim:** the integrity is "tamper-evident reporting", not broker audit. Wording is the main control.
- **Privacy:** balances can identify people; default to percent-only for non-owner viewers.
- **Gaming:** many accounts, demo-as-real, EA rebuilt by a determined user. Mitigated by section 5, not eliminated.
- **Load:** public pages must be cached; do not let page views hit per-viewer heavy queries.

## 9. Decisions needed from the owner

1. Start with **Option A (our own accounts)**? (recommended)
2. Which account is the first public pilot: the live account already synced, or a demo running a marketplace EA?
   Note the live account is small (about 60 USD), which is honest but modest; a demo-labelled page is fine if clearly
   marked.
3. Default privacy for public viewers: **percent-only** with delayed open positions? (recommended)
4. Get the lawyer question answered before T2 goes public (combine with the copier question).

## Sources

- Myfxbook account page shared by the owner (read in the owner's browser, 2026-10-08): https://www.myfxbook.com/portfolio/account-22/1549989
- Myfxbook, "Why Verify?": https://www.myfxbook.com/help/?p=300 (403 to our fetcher; content taken from search summaries)
- https://daytrading.com/myfxbook
- https://forums.babypips.com/t/a-guide-to-using-and-recognising-myfxbook-accounts/52656
- https://forums.babypips.com/t/ways-to-recognize-fake-and-real-accounts-on-myfxbook/194062
- https://dev.to/xauusdrobot/how-to-read-a-myfxbook-record-before-trusting-any-trading-ea-cc7
- https://traderssecondbrain.com/guides/myfxbook-alternative
