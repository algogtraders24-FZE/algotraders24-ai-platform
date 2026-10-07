# AT24 Live Results - Myfxbook reference catalog and feature backlog

Date: 2026-10-08 · Status: reference + backlog (no code). Companion to `docs/LIVE-TRACK-RECORD-RD.md` (options,
phases, risks, owner decisions). **Feature name (owner decision): "Live Results".**

Everything under "Observed" was read directly in the owner's logged-in Chrome on 2026-10-08 (account page `account-22`,
`/features`, `/widgets`, `/api`, `/systems`, `/faq`, `/strategy-ai`). The example account is an old 2016 demo-era account
(621 trades, deposits 2,250, withdrawals 1,200), so numbers are for layout and formulas only, never as benchmarks.
Anything not observed is marked "reported". Use this file as the checklist when adding features later.

---

## 1. Account page anatomy (Observed)

**Header:** name, `Real (USD)`, broker, "Technical, Automated", leverage, platform. Buttons: Settings, Discuss (a
per-account comment thread), Custom Analysis, Share. Badge row: Track record, Trading privileges, Live update, Cashback.
Unverified items show a grey "!" icon. A banner can say the user's Myfxbook EA is outdated.

**Prop Mode strip (opt-in):** four dial cards - Trading Days, Daily Loss, Max Loss, Profit Target - "track your performance
against common prop trading rules".

**Left card, tabs Info / Stats / General:** Gain, Abs. Gain, Daily, Monthly, Drawdown, Balance, Equity (with % of
balance), Highest (with date), Profit, Interest, Deposits, Withdrawals, Updated, Tracking (count of people tracking).

**Right card, chart tabs:** Growth, Balance, Profit, Drawdown, Margin (Margin shows "No data" when not reported). Growth
chart = equity-growth line + growth line + daily/monthly bars + deposit (green) / withdrawal (red) markers; a settings
icon changes the series.

**Period table:** rows Today / This Week / This Month / This Year; columns Gain, Profit, Pips, Win%, Trades, Lots, each
with a "(Difference)" comparison.

**Advanced Statistics (tabs):**
- *Trades:* trades, profitability bar, pips, avg win/loss (pips and money), lots, commissions, longs/shorts won
  (count and %), best/worst trade ($ and pips, with dates), average trade length, profit factor, standard deviation,
  Sharpe ratio, Z-score (with probability), expectancy (pips and $), AHPR, GHPR.
- *Summary:* per-symbol table: Longs (trades, pips, profit), Shorts (same), Total (trades, pips, profit, Won%, Lost%),
  per-row mini chart icon and a copy icon.
- *Hourly:* stacked bars, winners vs losers per hour of day (0-23) with counts.
- *Daily:* by day (tab exists; not inspected in detail).
- *Risk of Ruin:* table with columns Loss size 100%...10%; rows **Probability of loss** and **Consecutive losing trades**
  needed to lose that much (e.g. 10% loss: probability 13.14%, 15 consecutive losers). Hover text explains each column.
- *Duration:* scatter of **growth % vs trade duration** (green diamonds = winners, red circles = losers), "data includes
  last 200 transactions".
- *MAE/MFE:* chart (empty for this account).

**Trading Activity (tabs):**
- *Open Trades (n):* Ticket, Open Date (and planned close), Symbol, Action, Lots, Open Price, SL (price, pips, $),
  TP (price, pips, $), Pips, Net Profit, Gross Profit, Swap, Gain, **Magic**, a **tag** icon (user trade tags: "tag the
  trade") and a **comment** icon. Total row.
- *Open Orders (n):* pending orders.
- *History (n):* Ticket, Magic, Open Date, Close date, Symbol, Action, Lots, SL, TP, Open Price, Close Price, Pips, Net
  Profit, Gross Profit, Duration, Gain, Swap, Commissions, **Time Profitable, Drawdown, Risk Reward, Max, Min, Entry
  Accuracy, Exit Accuracy, Profit Missed** (the last group needs the price path inside each trade).
- *Exposure:* by-direction table: Symbol, Action, Lots, Open Price, Pips, Net Profit, Gross Profit, Swap, Gain.
- A gear icon changes visible columns.

**Monthly Analytics:** bars of monthly gain with a toggle **Change / Profit / Lots / Pips**. Clicking a month opens:
**Reward:Risk ratios per symbol** (bar chart), **Currencies popularity** (pie), **Average holding time per symbol** (long
vs short bars).

**Below the fold:** broker ads ("Top Forex Brokers", "Open Live Account"), news/price ticker, sponsor header.

### Formulas confirmed from the page numbers
- Absolute gain = profit / total deposits (852.10 / 2,250 = 37.87%).
- Balance = deposits - withdrawals + profit (2,250 - 1,200 + 852.10 = 1,902.10 vs page 1,902.07).
- Gain (37.35%) is a separate compounded figure (not profit / deposits).

---

## 2. Platform features (Observed, `/features`, in their order)

Secure read-only connection (never asks for trading login; investor access) · Account privacy (control balance, trade
size, broker, etc.) · **Private invitation link with its own privacy settings** · Verification system · Advanced charts ·
Live economic calendar · Live markets information · Main portfolio (all systems at a glance) · Monthly performance ·
Advanced statistics · Advanced summary (per currency, in money or pips) · Average holding time (long/short per currency)
· Currency popularity · Account watch (watch-list with performance changes) · **Export (CSV, PDF, HTML)** · Contests ·
Directional analysis · **Filter by magic number (per-EA results)** · Filter by symbol · Multi portfolio · Real-time
analysis (time frames, filters) · System search (only verified systems are listed) · **Trades journal (comment + attach
files per trade)** · Twitter connection (each trade posts to X) · Widgets · API · **Custom start (ignore earlier data)** ·
Economic-calendar email notification · Strategies analysis (back-test reports) · Hourly statistics · Mobile app ·
**Vouching system** · **Account update failure notification** · Profit chart · Equity chart · Forex sentiment · Community
outlook map · **Compare systems** · **Duration analysis** · **Trade tagging with custom analysis by tag**.

## 3. Widgets (Observed, `/widgets`)

Account widgets: Sleek short (horizontal; name, growth, drawdown, monthly; 8 colours) · Sleek long (vertical, forum
signature) · Mini · Small · Medium (with small gain/equity chart) · Large (large chart) · **Open trades widget** · Custom
widget (7 types, size, title, font, 10 colour templates or custom) · Systems widget (live chart of all systems) ·
**Browser widget** (trades plotted on a live price chart, symbol/timeframe selectable, show/hide open trades, orders,
economic events). Other widget groups: General, Toolbar, Broker, Market.

## 4. Systems list, copy, other products (Observed)

- `/systems`: ranked list with columns System, Gain, Drawdown, Monthly, Yearly, Badges (e.g. "Live update"), Performance,
  buttons Subscribe / View details, filters "Available to Subscribe / All Systems / Available to Copy", Compare, 43 pages.
  **Only fully verified systems (track record + trading privileges) are listed** (FAQ). Top entries show gains such as
  +17,893% with 44% drawdown: sorting by raw gain rewards risk-taking and tiny-start tricks (we will not rank by gain).
- Autotrade/Subscribe = copy trading through partner brokers (reported).
- **Strategy AI:** generate MT5 strategies without coding, with pricing and a "recent strategies" list showing gain and
  drawdown. **Backtest** (new). Overlaps with AT24 Quant Lite/Quant Chat/Quant Pro, which we already have.
- Business model: sponsor, broker ads/affiliate, cashback, rewards points, broker/prop-firm/EA/VPS reviews and lists.
- API: public API (XML/JSON) to read an account's data programmatically (reported details not inspected).
- Verification (reported): investor-password pull from the broker several times a day + trade-comment key for trading
  privileges; they state they are not an auditor.

---

## 5. AT24 coverage map and backlog

Legend: **H** have today · **S** small work, no EA/schema change · **E** needs EA v1.1 (additive fields) · **M** needs
migration (additive) · **X** deliberately not copying. Tier: **F** free · **P** paid (suggestion, owner decides).

### 5.1 Core page (T1/T2 - first release)
| Feature | Source | Status | Tier |
|---|---|---|---|
| Header, DEMO/REAL badge, tracking-since, N days live, last update | accounts | S | F |
| Integrity badges (terminal-reported, chain intact, last-sync age, gap detected, balance reconciles) | chain + reconcile | S | F |
| Stats card (gain, abs gain, daily, monthly, drawdown, balance, equity %, highest+date, profit, swap, deposits, withdrawals) | deals+snapshots | S | F |
| Time-weighted gain next to absolute gain | balance ops | S | F |
| Chart tabs Growth / Balance / Profit / Drawdown / Margin with deposit-withdrawal markers | snapshots+deals | S | F |
| Period table (today/week/month/year) | deals | S | F |
| Trades stats (PF, SD, Sharpe-like, expectancy, best/worst with dates, avg length, longs/shorts won) | engine | S | F |
| Z-score, AHPR, GHPR (descriptive labels) | engine | S | P |
| Summary per symbol (longs/shorts/total/won%) | deals | S | F |
| Hourly winners-vs-losers chart, daily table | engine | H/S | F |
| Duration scatter (growth % vs duration) | deals | S | P |
| Risk of Ruin table (loss size vs probability vs consecutive losers) | ruin engine | S | P |
| **Edge evidence (skill vs luck) + Monte-Carlo risk range** (Myfxbook has nothing like it) | engine | H | P |
| Open trades, history, exposure (by direction) | snapshots+deals | S | F |
| Monthly analytics Change/Profit/Lots + drill-down (reward:risk per symbol, popularity, avg holding) | deals | S | F |
| Privacy controls: percent-only, hide size/symbols, position delay N min | page settings | M | F |
| Visibility private / unlisted link / public; private invitation link | page settings | M | F |
| Mandatory disclosure block ("terminal-reported, not independently verified") | static | S | F |

### 5.2 Needs EA v1.1 (one additive step, existing installs keep working)
| Feature | Why EA change |
|---|---|
| Pips everywhere (total, avg win/loss, monthly pips) | symbol digits/point not sent |
| Open Orders (pending orders) | not sent |
| MAE/MFE, Time Profitable, Max/Min, Entry/Exit Accuracy, Profit Missed | needs price path inside each trade (EA reads M1 bars open->close) |
| Risk if all SL hit | tickValue/tickSize + priceCurrent in positions |
| Planned SL/TP in pips and money on open trades | derived from pips + tick value |

### 5.3 Community / growth (after the core page is stable)
| Feature | Notes |
|---|---|
| Per-account discussion thread (Myfxbook "Discuss") | needs moderation, report/takedown; M |
| Follow / watch list + "N tracking" count + change notifications | M |
| Filter by magic number (per-EA view on a multi-EA account) | data exists (deal magic). **Rule:** a filtered view must show "filtered by magic X; account has N magics" to prevent cherry-picking |
| Trade tags + journal (notes/files per trade) + analysis by tag | M; also feeds the private risk monitor |
| Export CSV/PDF/HTML | S; PDF reuses the Edge PDF writer |
| Widgets/embeds: sleek short/long, mini, medium/large with chart, open-trades widget, custom; badge image; iframe | read-only, cached; paid = remove AT24 branding |
| Compare two accounts/EAs side by side | S after core |
| "Backtest vs live" overlay (AT24 Quant backtest equity vs real forward equity) | unique to AT24; needs backtest import link; S/M |
| Marketplace link: listing shows live results, "live since", forward-vs-backtest | trust-state rule below |
| Leaderboard/explorer | **Not by gain.** If ever: rank by days live, drawdown, sample size, evidence level; later |
| Contests | later |
| API/MCP read access to a public page's stats | later; MCP tool `live_results_summary` |
| Share cards for X/Telegram | S; auto-post of every trade = X (privacy) |

### 5.4 Private monitor features Myfxbook has that fit AT24 Live Sync
Account update failure notification (EA disconnected) · alerts (margin level, daily loss, drawdown) · prop-rule tracker
(trading days, daily loss, max loss, profit target dials, opt-in) · email notification. These are the "alerts" item already
on the Live Sync list and share the same data.

### 5.5 Deliberately NOT copying (and why)
- **Custom start date on public pages** (cherry-picking). Owners may filter their own private view only.
- **Ranking by raw gain**, vouching/popularity scoring (gameable).
- **Broker ads / affiliate / cashback** as the business (our value is marketplace trust, not lead-gen).
- **Investor-password broker pull** now (storing credentials or running terminals server-side needs its own security and
  legal review; it is the only way to claim broker-level verification).
- **Copy trading/Autotrade** (owner decision; regulatory).
- Free-text "Unknown feature" placeholders obviously.

### 5.6 Integrity rules that apply to every item above (from the R&D doc, repeated so nothing is missed)
No start-date filter on public pages · time-weighted gain beside absolute gain · forced DEMO/REAL label · wording "reported
by the user's terminal since <date>; not independently verified" (never "verified"/"proof") · gap/fork disclosure ·
"N accounts / N magics exist" disclosure for filtered views · default for non-owner viewers: percent-only and delayed open
positions · self-reported data may support Trust State `UNDER_OBSERVATION`/`LIMITED`, **never `VALIDATED` alone** ·
cache public pages · lawyer's read before public launch.

### 5.7 Data we already store that makes this cheap
`live_sync_deals` (ticket, positionId, time, symbol, type, entry, volume, price, commission, swap, profit, fee, **magic**,
comment), `live_sync_snapshots` (balance, equity, margin, freeMargin, open positions with SL/TP), `live_sync_batches` (hash
chain), `live_sync_accounts` (mode, currency, margin mode, leverage, first/last sync). Engine: `analyzeTrades()` +
`dealsToHistory()` + `summarizeLive()`. Gaps are only those in 5.2.

### 5.8 Suggested build order (each its own PR)
1. T1 stats engine (all "S" rows in 5.1; pure, tested).
2. T2 page + visibility/privacy (needs the one additive migration) - demo pilot, private first.
3. Export + disclosure polish; unlisted link.
4. EA v1.1 (pips, pending orders, SL-risk fields; MAE/MFE last).
5. Widgets/embeds + marketplace link.
6. Alerts (EA down, margin, daily loss) + prop-rule tracker.
7. Follow/discussion/journal/tags; compare; backtest-vs-live overlay.
8. Controlled seller opening, then wider.
