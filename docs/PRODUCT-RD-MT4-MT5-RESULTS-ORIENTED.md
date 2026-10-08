# Results-oriented MT4/MT5 products: R&D (2026-10-08)

Method: MQL5 Signals live track records (MT5: 625 signals scraped, MT4: 406; real accounts, >=52 weeks, >=300 trades = 215 / 256 usable), the mql5dev trend index (4,290 posts) and our own M12 evidence. Scripts: `ea-research/mql5-feed/` (`fetch-signals.mjs`, `build-trend-index.mjs`).

**Limits of this data (read first):** the scraped lists are the top of MQL5's quality/funds rankings, so this is a survivorship-biased sample of the winners. Archetypes come from win rate, drawdown and trades/week, not from reading strategy logic. Live results can end abruptly, especially for high-win-rate grid/martingale styles. This is a product-direction input, not a promise of returns.

## What live results look like (real accounts, >=52 weeks, >=300 trades)

| Cluster | MT5 n | MT5 med PF / DD | MT4 n | MT4 med PF / DD | Where the money is |
|---|---|---|---|---|---|
| Low-DD steady (DD<=20%, PF>=1.3) | 32 | 1.74 / 14% | 50 | 2.03 / 15% | NoPain, Gold Reaper, Amazing NZDCAD, GU RS PRO, UpEverest |
| Mid-DD (21-35%, PF>=1.3) | 57 | 1.57 / 29% | 59 | 1.73 / 28% | |
| High win rate >=75% | 61 | 1.83 / 31% | 95 | 1.92 / 33% | largest cluster; tail risk unknown (grid/martingale-like) |
| **Low win rate <=45% (trend/breakout)** | 25 | **1.20 / 36%** | 15 | **1.17 / 38%** | **weakest cluster, least money** |
| Survivors >=150 weeks | 49 | 1.52 / 32% | 113 | 1.48 / 35% | median win 69-72%, 10-13 trades/week |

Findings:
1. Money and longevity follow **low drawdown + PF 1.5+ + 3-20 trades/week**, not high growth %. The best survivors run DD 4-22%.
2. **Breakout/trend-style EAs are the weakest live cluster** (PF about 1.2, DD 36-38%). Our M12 Gold Range Breaker (PF 1.16, win 40%, DD 29-34%) sits exactly there. Gold-named signals overall: median PF 1.35, DD 31-33%.
3. MT4 survivors live much longer (median 135 vs 89 weeks): MT4 is not dead for durable systems, while MT5 holds more subscriber money.
4. Trend index (what the community publishes about): rising = dashboards/tooling, risk/prop-firm guards, gold, AI/MCP; fading = tester/validation, Python, crypto.

## Product shortlist

| # | Product | Why (evidence) | Platform | Risk |
|---|---|---|---|---|
| 1 | **Low-DD multi-pair FX mean-reversion basket** (4-6 crosses, session-filtered, hard ATR stops, no martingale) | Low-DD cluster; e.g. a cross-pair signal at 3.2 trades/week, DD 9%, PF 3.3 over 127 weeks. We already have `AT24_FX_Pairs_Reversion.mq5` (M15 draft) and an MT4 squeeze draft. | MT5 first, MT4 port | medium: needs real-ticks + cost-stress proof before listing |
| 2 | **Gold pullback / mean-reversion companion** to M12 (hard stop always, max 2 positions) | Gold is where subscriber money goes (131 signals, 1.6M USD) but the winners (PF 2+, DD 17-18%) are not breakout styles. Pair with M12 as a 2-system gold portfolio. | MT5 | medium-high: gold tail risk |
| 3 | **Prop-firm / account guard utility** (daily-loss lock, max-DD kill switch, equity trail) | Risk/drawdown is a RISING community theme; no alpha needed; protects other EAs' results; fast to build with EA Core. | MT5 + MT4 | low |
| 4 | **Broker cost + spec auditor** (hourly spread profile, contract specs, commission/swap) | Tooling is the fastest-rising theme; also fixes our own "spread UNKNOWN" evidence gap. | MT5 | low |
| 5 | Ship every product with **Live Sync** (public, terminal-reported live track record) | Buyers pick by live record, and we sell on verified evidence. | both | low |

Do NOT build: martingale/grid "high win rate" EAs (largest cluster, but unbounded tail; conflicts with our honest-evidence positioning), crypto (fading), AI-branded EAs without a measurable edge.

## "Best coding" standard (what every new product ships with)
- **AT24_EA_Core** for all orders (symbol fill mode, OrderCheck pre-flight, retcode classes, no resend on unknown outcome, risk-based lots via OrderCalcProfit).
- **AT24_EA_Validation** (OnTester score + frames report) so optimization prefers stable, low-DD sets.
- Restart-safe state (global variables or file), equity guard (daily loss + max DD kill switch), hard stop on every position, spread/rollover filter fed by the broker's own spread profile, news filter from a saved calendar file (calendar API does not work in the tester).
- Thin platform adapter (G01 pattern) so MT4 ports reuse the strategy file.
- Self-test script and parity backtest for every refactor.

## Ship gate (a product is listed only if all hold)
1. Real-ticks backtest: >=300 trades, PF >= 1.3, max equity DD <= 25%.
2. Cost stress: PF >= 1.15 with spread x2 (custom symbol) and commission/swap on.
3. Walk-forward: >= 70% of windows positive; no single window above the stated DD.
4. >= 8 weeks demo forward through Live Sync with results inside the backtest range.
5. Listing copy states the exact inputs of the evidence run and expected drawdown (as done for M12).

## Suggested order
Account guard (3) and cost auditor (4) first: smallest, reusable inside every later product. Then FX basket (1), built from `AT24_FX_Pairs_Reversion.mq5` through the ship gate. Gold companion (2) after M12's defaults/evidence question is settled.
