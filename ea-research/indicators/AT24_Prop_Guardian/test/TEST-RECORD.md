# AT24 Prop Guardian - test record (2026-11-04, MT5 EA)

The EA places no trades of its own. It reads your account, and when your daily or max loss reaches `InpActAtPct` (default 90 %) of the limit you set, it closes every managed position, deletes pending orders and blocks new ones. Version 1.01 adds the runaway guard below.

## What changed in 1.01 (the Guardian fix)
Self-test finding (v1.00): when something keeps re-opening trades while the account is locked, the Guardian closes every one of them and each forced close costs the spread (289 forced closes in one 5-day stress run). New inputs: `InpMaxBlocks` (default 5, 0 = off) raises a RUNAWAY alert (alert, push, log, red dashboard line) once that many trades were re-opened during one lock; `InpStopAtLimit` (default false) optionally stops closing them after the alert.

## Strategy Tester self-test (portable MT5, XAUUSD M5, 2026-10-26..30, 10,000 USD, self-test opens 1 lot every 10 minutes, even while locked)
| Run | Settings | Result |
|---|---|---|
| A | daily 5 %, max 10 %, act 90 % | locked once (max loss, at 90 % used), RUNAWAY alert at the 5th re-opened trade, 289 forced closes, 0 positions left open, never unlocked (max-loss lock needs manual UNLOCK by design) |
| B | max loss 100 % (daily lock only) | 3 locks, 3 unlocks at the next daily reset, RUNAWAY alert once per lock (2), 0 positions left open |
| C | as B + `InpStopAtLimit=true` | after the alert Guardian stopped closing (only 5 forced closes); the carried-over positions were closed all at once at the next lock (92 positions, daily loss used 1046 %) |

Reading: the alert fires at the right moment and resets per lock; daily lock/unlock and the manual max-loss lock behave as designed. Run C shows why `InpStopAtLimit` stays OFF by default: leaving re-opened trades open is far more expensive than the spread.

## Not tested / limits
- Dashboard (including the new RUNAWAY line) was not captured on a live chart: the portable test terminal has no account login, so the EA does nothing there. Dashboard layout is unchanged except one label line.
- Alerts/push were exercised only as log lines in the tester.
- A position carried across the daily reset counts against the NEW day's limit (basis = balance at reset). Set `InpBasis` to equity if your firm uses equity.
- Protection tool, not a guarantee: gaps, slippage, a stopped EA or a stopped VPS can still cause losses beyond a limit. Not affiliated with any prop firm.
