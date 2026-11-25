# Pipflow vs our Pro Chart engine: what we can and cannot match (R&D note)

Status: R&D note for the owner, 2026-11-26. Everything measured here is on past Exness candles, before spread and commission. Nothing is a promise.

## 1. What Pipflow publishes about its logic

I read pipflow.org (home, support, learn, pricing, terms), its MQL5 and App Store pages. Findings:

- **No method is published.** Nothing says how entry, stop, target, bias or the "score" are produced. No definition of order block, fair value gap, sweep or session. The word "score" does not appear on any page. No documentation or video explains the logic; the learn page has eight short walkthroughs.
- **What they do say:** the AI assistant (Jessica) marks support and resistance, order blocks, fair value gaps, liquidity sweeps and structure breaks, then explains them; plans show one entry, stop and target; strategies are rule sets over 13 indicator families plus filters; the paid tiers use bigger models ("frontier cloud models" on Elite).
- **Plans:** free 10 analyses a day (the "3/10" chip in their screenshots), Starter $149.99, Pro $299.99, Elite $999.99 per month.
- **Accuracy:** no aggregate live win rate is published on the pages read. The "56% win-rate LIVE" on their plan card is their own number with no stated sample or method. It cannot be verified or compared.

My reading, clearly marked as an inference: the long text analysis ("mean reversion toward the 50 EMA") and the choice of a counter-trend LONG at the current price look like model judgement on top of the drawn zones, not a fixed rule set. That is why the same chart gives a SHORT in our engine (retest after a bearish break) and a LONG in theirs (sweep of the low, V-recovery).

## 2. What we match already

Same drawn layers (order blocks, FVG, sweeps, structure, levels, sessions), the plan box with entry/stop/target and R:R, the analysis text (PRAGYA), a 10-a-day style free limit, voice, a trade tab. The EMA50 value in their text (3,560) is the same number our readout computes (3,559.63).

## 3. Measured accuracy of our rule (the only accuracy we can check)

Plan rule replayed bar by bar on about 2.4 years of H1 Exness candles of five instruments (XAUUSD, EURUSD, GBPUSD, BTCUSD, USOIL), no look-ahead, stop first, no overlapping trades, 2R target. Out of sample = the last 40% of each instrument's time span.

| Variant | Trades | Avg R per trade (std. error) | Target first | Out of sample avg R |
|---|---|---|---|---|
| Our rule today (score 3 or more) | 2,701 | +0.09 (0.03) | 36% | +0.07 (0.04) |
| Only when EMA20/EMA50 trend agrees | 2,102 | +0.09 (0.03) | 36% | +0.08 (0.05) |
| Score 5 or more | 697 | +0.15 (0.05) | 38% | +0.11 (0.09) |
| Target at the EMA50 when it gives R:R 1 to 3, else 2R | 2,739 | +0.09 (0.03) | 37% | +0.06 (0.04) |
| Target at the EMA50 only (skip otherwise) | 1,053 | +0.03 (0.04) | 39% | -0.04 (0.07) |

On gold alone (373 trades) the same rule gave +0.11 R with a hit rate of 37%; filters for higher-timeframe agreement, London/New York hours or a required sweep did not help out of sample.

What this says: the rule has a small positive average (break-even for a 2R target is a 33% hit rate, we are at 36 to 37%). It is a weak edge, not a strong one. Making the EMA50 the target, which is what Pipflow's plan does on this chart, did not improve it. No simple filter tested here improved it reliably.

## 4. The gap, honestly

I cannot say that "10 to 20% of the accuracy is missing", because Pipflow's accuracy is not published and its logic is not visible. What can be said:

- Features visible in their screenshots that we did not have: additional targets and the EMA50 reference (added now), session tags (added), a compact record line on the card (added), session ranges listed as zones (not built).
- A possible real difference is the counter-trend setup after a liquidity sweep with a fast recovery. Our rule only trades retests after a structure break. Testing a sweep-reversal rule needs a definition of the stop and the entry; the test harness (scripts/rnd-plan-variants.ts) is ready for it.
- A model-judged layer (PRAGYA choosing between candidate setups from measured facts) is possible, but it can only be trusted if it is measured the same way, on past candles, before it is shown as a signal.

## 5. Recommendation

1. Keep the engine's numbers as they are; publish only measured records with their sample size.
2. Let the signal record we already store (My signals and the admin scoreboard) collect real, forward results for a few weeks; that is the honest comparison to any "live win rate".
3. If we want to go further on accuracy: test the sweep-reversal rule with the same harness (about a day), and only ship it if it holds out of sample.
