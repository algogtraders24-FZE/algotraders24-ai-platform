# Live Results - public JSON API and directory

Read-only, no sign-in, CORS open (`access-control-allow-origin: *`). Only **public** Live Results pages are ever served: a private or unlisted page answers 404, same as a page that does not exist. Everything is **terminal-reported by each owner's own MetaTrader terminal, not independently verified**.

## Endpoints

| Endpoint | Returns | Cache |
|---|---|---|
| `GET /api/public/live-results` | `{ status:"ok", data:{ generatedAt, source, disclaimer, pages: ResultsSummary[] } }` | 5 min (`s-maxage=300`) |
| `GET /api/public/live-results/<slug>` | `{ status:"ok", data:{ slug, source, disclaimer, results } }` where `results` is exactly the redacted view model the page renders | 60 s (`s-maxage=60`) |

Both are served by the same redacting builder as the page, so a download of the JSON never contains more than the page shows (percent only unless the owner chose to show amounts on that page; the broker name only if the owner chose to show it).

## ResultsSummary (percent only, never money)

`slug, title, description, mode (demo|real|contest), platform (mt4|mt5), broker (self-reported, only if shown) , oneEa, daysSinceFirstSync, lastSyncAt, stale, trades, winRatePct, profitFactor, gainPct (time-weighted), absoluteGainPct, maxDrawdownPct, monthlyPct, yearlyPct, avgMonthlyPct, liveForward{trades,gainPct}, sparkline[<=40], enoughData (>= 30 closed trades), edgeLevel`.

The summary is built from the already-redacted view model, so it carries no amount, lot size or price even on a page that shows amounts (tested).

## Directory and Compare (dashboard > Live Results)

- Search (title, description, broker), filters (demo/real, MT4/MT5, reporting now, at least 30 trades), a sparkline and the key percent figures per page, and a side-by-side **Compare** of up to four pages with an overlaid growth chart.
- **There is no sort by gain, on purpose.** Ranking by gain rewards risk-taking and cherry-picking. Sorts are facts about the track record: recently updated, longest tracked, most trades, lowest drawdown, name. A page with under 30 closed trades is flagged "too few trades to judge".
- The directory API (`/api/private/live-results/directory`) returns the same summaries for signed-in members.

## Limits and honesty

- At most 60 public pages are summarised; computing them reads each page's deals, so the list is cached for 5 minutes per server instance.
- No rate limiting beyond the CDN cache headers; if abuse appears, add a per-IP limiter.
- Nothing here is investment advice; past results do not predict future results.

## MCP tool `live_results`

The AT24 MCP server (read-only, token auth, 200 calls per user per day) now has a ninth tool, `live_results`, over the same public data:

- no arguments (optional `limit`, max 50): a list of public pages with the percent-only summaries above;
- `slug`: one public page in compact form: summary, periods, months, strategies, integrity facts, a downsampled growth series (<= 60 points), the edge level (money sentences removed), and the page's disclosure lines.

Unknown fields (including any user id or an unlisted-page key) are rejected, private and unlisted pages are not reachable, there is no amounts block, no history rows and no open positions, and every output repeats that the data is terminal-reported and not independently verified. Not plan gated (public data). Note: the owner's earlier decision was "no further MCP investment"; this tool is a thin adapter (no new logic) kept because it makes the public pages usable from AI apps for free.
