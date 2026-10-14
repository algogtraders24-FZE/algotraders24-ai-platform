# Edge Analyzer: "Check against my rules" - plan (no code yet)

Status: 2026-10-14, PLANNING GATE. Nothing below is built. Owner decides scope before any code.

## The problem
A trader (especially on a prop-firm challenge) writes rules - daily loss limit, max drawdown, allowed instruments and hours - then
cannot easily tell whether their real trade history obeyed them. Today "My Trading Rules" (Knowledge page) reaches Ask AI only as
text; nothing compares it with the user's actual trades.

## What the data can and cannot answer (from `services/edge-analyzer/types.ts`)
The MT5 report gives CLOSED trades only: `symbol, direction, volume, openTime, closeTime, stopLoss, net`, plus `initialDeposit`,
balance operations and the terminal's own max balance drawdown.

| Rule | Checkable? | Honest limit |
|---|---|---|
| Daily loss limit (% of balance) | Yes: group `net` by day on a running balance | "Day" = broker server time as printed; a firm may reset at another hour. Floating (open) loss is not in a closed-trade report, so a breach inside a trade can be missed. |
| Max drawdown (%) | Yes, balance basis (the terminal's own figure already reconciles) | Equity drawdown (open P&L) is not available - this can understate a firm's equity-based number. |
| Allowed instruments | Yes: `symbol` vs list | Broker suffixes (XAUUSD.m) need normalising. |
| Allowed hours / sessions | Yes, if the user states hours and the broker's UTC offset | Report times are broker time, not UTC. |
| Max trades per day | Yes | - |
| Risk per trade (%) | Only roughly: needs SL distance x volume x contract size per symbol | Contract size/tick value are not in the report; estimate for known symbols only, label "estimated", skip otherwise. |
| Free-text rules ("no trading around news") | No | Not machine-checkable; show the text next to the result, never a verdict. |

## Proposed V1 (smallest useful)
1. Structured, optional extra fields in the rules form: daily loss %, max drawdown % (already there), allowed instruments, trading hours
   + broker UTC offset, max trades per day. Stored in the same rules document AND as a small JSON the checker reads (the document stays the
   Ask AI source).
2. A pure, deterministic module `services/edge-analyzer/rules-check.ts` -> per rule: `{ rule, status: passed | breached | not-checkable, evidence }`
   with the exact days/trades that breached. No AI anywhere in the numbers.
3. UI: a "Rules check" card on `/dashboard/edge-analyzer` (after the analysis), each line with its limit and the evidence; a plain footer:
   "Closed trades only, broker time, balance basis - confirm against your firm's own dashboard."
4. Gating: follow the Edge Analyzer split already in place (free = summary, paid = full) - owner decision needed.
5. Tests: fixtures with a known breach on day N, exact-limit day (not a breach), day-boundary trades, instrument suffixes, empty rules, no initial deposit
   (percent rules become not-checkable, never guessed).

## Explicit non-goals
No pass/fail "you would have passed the challenge" claim, no prop-firm rule database (rules change; the user's own text is the source),
no live monitoring (that is Live Sync alerts, a separate feature), no AI-written verdict.

## Decisions needed from the owner
1. Is V1 limited to the five checkable rules above?
2. Free or paid (current Edge Analyzer gating)?
3. Is a Live Sync version ("alert me when I am near my daily loss limit") wanted next? It would use equity, which fixes the main limit above.
