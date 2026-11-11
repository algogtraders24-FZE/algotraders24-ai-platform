# AT24 Edge Truth Test - test record (2026-11-11, MT5 only)

| Check | Result |
|---|---|
| MT5 compile | 0 errors, 0 warnings (indicator, self-test, screenshot script) |
| Engine vs independent Python (`mt5/AT24_TT_SelfTest.mq5` + `test/verify_tt.py`) | four synthetic trade lists (noise n=200, real edge n=200, few trades n=25, losing n=400) run through the same deterministic xorshift32 stream: trade count, wins, total, mean, sd, t, profit factor, sign-flip p, bootstrap 5th/95th percentile, chance of a loss, max drawdown, median shuffled drawdown and drawdown rank all identical (4 of 4 lists, 14 numbers each) |
| Behaves sensibly | noise: p 0.84, range -2046 to +572 (cannot tell); edge: p 0.0006, range +1471 to +4160; few trades: p 0.13 (cannot tell, and the dashboard shows "too few trades" below 30); losing: p 1.00, range -5932 to -2122 |
| MT5 live chart (portable terminal) | verdict and all three tests on the built-in SAMPLE list (labelled in red): test/mt5_edge_truth_test_chart.png |
| Account-history reading (`HistorySelect` / deals) | Verified by the Engineering window (2026-11-11) on a real MT5 demo account history: 276 closed trades found, verdict "CANNOT BE TOLD FROM LUCK" (t -1.55, sign-flip p 0.941, 90 % range -5316 to +233, max drawdown worse than 86 % of shuffles). Reads closing deals (OUT / OUT_BY / INOUT, buy or sell), net = profit + commission + swap + fee, with filters for symbol, magic number and last N days. |
| MT4 / TradingView | not built (MT5 only; other agent) |

## What it does
Takes the closed-trade list of the account and asks whether luck alone could plausibly have produced it:
1. Sign-flip test: if profits and losses were symmetric around zero (no edge), how often would a random sign assignment give a total at least as good as yours (one-sided p).
2. Bootstrap: resampling your own trades 2,000 times, the 90 % range of the total and the chance that the total is a loss.
3. Drawdown against shuffled orders: your maximum drawdown versus the typical one if the same trades came in random order.
Verdict: TOO FEW TRADES (under 30), UNLIKELY TO BE PURE LUCK (p < 0.05 and loss chance < 5 %), LOSING BEYOND CHANCE, else CANNOT BE TOLD FROM LUCK. Fixed seed, so the same list always gives the same numbers.

## Notes / limits
- A pass means luck alone is unlikely for THIS list. It does not mean the edge will continue, and a trader who tried many ideas will see lucky lists (multiple testing): the Forward Ledger / pre-registration is the honest answer to that.
- Trades are assumed independent; martingale / grid results (many small wins, rare large losses) can look better than they are. Short histories give wide ranges.
- The SAMPLE mode exists for demonstration only and is labelled on the dashboard.
- Dashboard off in the Strategy Tester by default.
