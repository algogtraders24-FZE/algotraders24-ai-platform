# Trader Edge Analyzer — Product Spec (R&D + scope, no code)

Status: DRAFT for owner review, 2026-10-07. Implementation NOT authorized.
Context: follows the MCP R&D (`MT5-MCP-PHASE0-RD.md`). MCP reaches only technical users; this is the
product that gives an ordinary trader a visible benefit on the AT24 platform itself.

## 1. The problem it solves

Most retail traders cannot answer two questions about their own trading:
1. **"Why am I losing?"** (which habits, sessions, symbols, sizes hurt me)
2. **"Is my result skill or luck?"** (is there a measurable edge, or just a lucky/unlucky streak)

MT5 shows a trade list and a few totals. It does not explain behavior or test significance.

## 2. What the user does (the whole experience)

1. Open **Dashboard → Edge Analyzer**.
2. Upload their MetaTrader account-history report (or a generic CSV).
3. Get a report in seconds: headline verdict, key numbers, patterns found, risk-of-ruin view,
   and a short list of "things worth investigating". No setup, no AI client, no credentials.

Works for any trader who can export history; MT5 first, MT4 and generic CSV next.

## 3. Input

| Source | Notes |
|---|---|
| MT5 History report (HTML / XLSX) | "Report" saved from the terminal's History tab. First-class. |
| MT5/MT4 CSV export | Column-mapped. |
| Generic CSV | open time, close time, symbol, type, volume, open price, close price, commission, swap, profit |

**Hard dependency:** the parser must be built and tested against REAL exports. The repo has no
sample. Owner to provide 2–3 real (anonymized or demo-account) reports before E1. Layouts differ by
terminal version/language; guessing the format would produce silently wrong numbers.

Limits: 12 MB file (a real 892-trade report is 4.8 MB because MT5 writes UTF-16), 20,000 trades, closed trades only (floating P/L is excluded and stated).

### 3a. E0/E1 findings from a REAL MT5 report (English, hedging account)

- File is **UTF-16LE with BOM**; contains sections Positions, Orders, Deals, Open Positions, Working Orders, Results.
- Positions header lists 13 columns but every data row has **14**: an unlabelled comment cell (EA/strategy tag) sits between Type and Volume. A guessed parser would have shifted every column.
- Numbers use a space for thousands and "." for decimals; non-English or comma-decimal reports are rejected, not guessed.
- The terminal's own **Results block** lets us reconcile: on the real file all 11 checks match exactly (net/gross profit and loss, trade counts, max balance drawdown 8 837.40 / 61.91%, absolute drawdown).
- Drawdown only reproduces when trades are walked in **close-time** order (open-time order gave 46.41% vs the terminal's 61.91%).
- MT5 counts a trade with profit >= 0 as a "profit trade"; our win rate counts only profit > 0 and reports breakeven separately.
- The comment tag enables a per-strategy/EA breakdown, which many traders will find the most useful view.

## 4. Analysis (all deterministic, no LLM computes numbers)

Reuses the vendored engine: `computeCoreMetrics` and `computeRiskRatios`
(`frontend/vendor/at24-quant-engine/dist/domain/metrics`): net profit, profit factor, win rate,
expectancy, average trade, max drawdown, Sharpe/Sortino/Calmar (per-trade, 0 risk-free, disclosed),
recovery factor, ulcer index.

New, built here:

1. **Where you lose** — P&L, win rate and expectancy by hour/day, symbol, direction, holding time,
   lot-size bucket. Broker server time is not UTC; the report states the assumed timezone and lets
   the user set it.
2. **Behavior flags** (only what the data can support; each shows its evidence and sample size):
   - Size after losses vs after wins (possible revenge sizing)
   - Time between trades after a loss (possible tilt)
   - Average holding time of losers vs winners (holding losers longer)
   - Win rate vs payoff ratio (high win rate but negative expectancy, etc.)
   - Loss-streak and drawdown-duration profile
3. **Edge evidence** — is expectancy distinguishable from zero?
   - Bootstrap confidence interval for expectancy and a permutation/sign test p-value
   - Output is a level, never a promise: `Insufficient data` (n < 30) / `No evidence of edge` /
     `Weak` / `Moderate` / `Strong`, with the sample size and the plain-language caveat.
   - Never labelled "validated". Past results do not predict future results.
4. **Risk of ruin view** — Monte-Carlo resampling of the user's own trades; shows the spread of
   outcomes and probability of hitting a drawdown threshold the user chooses. Assumptions disclosed
   (trades independent, same size distribution).
5. **Things worth investigating** — 3–5 ranked, evidence-linked observations. Phrased as questions
   to look into, never as instructions to trade.

## 5. Output

- Web report page (cards: verdict, numbers, charts, patterns, ruin view, caveats)
- PDF export
- Later: expose via MCP as `edge_analysis` (read the user's saved analysis), and an optional
  plain-language narrative where an LLM only rewrites already-computed findings (every number is
  cited from the computed JSON; the model never calculates).

## 6. Privacy and security (a statement contains sensitive data)

- Process in memory; store **only** normalized trades + aggregates, and only if the user saves.
  Raw uploaded file is never retained.
- Strip account number, name, broker server from anything stored or logged.
- Per-user isolation on every query; delete-my-analysis button; no sharing in v1.
- Upload hardening: MIME/extension/size/row caps, HTML parsed with a non-executing parser, all
  rendered text escaped, no remote fetches from file content.
- Rate-limit per user; analysis is CPU-bound (Monte Carlo) so cap iterations.

## 7. Honesty and claims

Not investment advice. States sample size everywhere. Insufficient data is a first-class result.
No profit/accuracy claims; "edge evidence" ≠ "validated". Marketing may say "see what your trade
history actually shows", not "find your winning strategy".

## 8. Architecture

```text
POST /api/private/edge-analyzer/analyze (multipart)
  -> parsers/ (mt5-html | mt5-xlsx | csv)  -> normalize (ClosedTrade[])
  -> metrics (vendored engine) + patterns + edge-evidence + ruin
  -> EdgeReport (typed JSON)  -> UI / PDF  [-> optional save]
```
Lives in `frontend/services/edge-analyzer/`. Page: `/dashboard/edge-analyzer`. Optional persistence:
one additive table (`EdgeAnalysis`) = owner-gated migration, as with MCP.

## 9. Phases

| Phase | Scope | Needs |
|---|---|---|
| E0 | Collect real MT5 report samples; parser spike | Owner provides samples |
| E1 | Parsers + normalize + core metrics + patterns (no DB), tests | E0 |
| E2 | Edge evidence + ruin Monte Carlo, determinism tests (seeded) | E1 |
| E3 | API route + dashboard page + report UI | E2 |
| E4 | Save/delete (migration), PDF export | owner migration go |
| E5 | MCP `edge_analysis` tool + optional narrative | E4 |

## 10. Decisions needed from the owner

1. **Plan gating:** free = summary + 3 patterns; paid = full report + PDF + ruin view? (suggested)
2. **Storage default:** analyze-only (nothing saved) vs save-by-default (suggested: analyze-only, opt-in save).
3. **Sample files** for E0 (blocking).
4. **Positioning copy** approval (section 7).
