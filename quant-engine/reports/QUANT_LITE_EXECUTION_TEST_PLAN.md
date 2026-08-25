# Q0.3 — Quant Lite Execution Test Plan

**None of the 18 tests below exist as automated code today** — this
document defines what they should verify, not a report of a test suite
that was run. Where this sprint's or Q0.2's actual session work already
produced real evidence relevant to a test (not a synthetic scenario, but
a real data point), that's cited honestly as partial evidence — never as
a pass/fail for a test that wasn't actually executed. Per the sprint
rule: **do not fabricate results.**

For each test: **Input**, **Expected behavior** (derived from
`QUANT_LITE_EXECUTION_CONTRACT.md`), **Current result**, **Parity
status**, **Evidence**.

---

### TEST 1 — Basic BUY entry + TP

- **Input:** Synthetic 1h OHLC series with a clean uptrend, a spec whose
  `entry_long` condition fires once, price then rises monotonically to
  the TP level without touching SL.
- **Expected behavior:** Position opens at signal-bar-close ± spread/2
  (or real tick Ask, per engine); closes at exactly the TP price; PnL =
  `(tp - entry) × contract_size × vol`, no breakeven/trailing
  interference since price never pulls back.
- **Current result:** Not tested — no synthetic fixture exists in this
  repository.
- **Parity status:** UNTESTED
- **Evidence:** None (no real run isolates this single scenario cleanly
  — real backtests mix many trade types together).

### TEST 2 — Basic SELL entry + TP

- **Input:** Mirror of TEST 1, downtrend, `entry_short` fires once.
- **Expected behavior:** Mirror of TEST 1 with sign flipped.
- **Current result:** Not tested.
- **Parity status:** UNTESTED
- **Evidence:** None.

### TEST 3 — BUY + SL

- **Input:** Uptrend signal, price immediately reverses and hits SL
  before any breakeven/trailing/partial threshold is reached.
- **Expected behavior:** Closes at exactly the SL price, reason="SL",
  full stop-distance loss.
- **Current result:** Not tested as an isolated scenario. Real evidence
  exists that SL exits fire correctly in aggregate (every real backtest
  run this sprint recorded `reason="SL"` trades with PnL consistent with
  the stop distance × volume formula), but this was never isolated to a
  single controlled trade.
- **Parity status:** UNTESTED (isolated) / PARTIALLY OBSERVED (aggregate)
- **Evidence:** `quant-engine/output/engine_comparison.json`,
  `tick_engine_test_v3.log` — real SL-reason trades present with
  formula-consistent PnL, but not a controlled single-trade check.

### TEST 4 — SELL + SL

- **Input:** Mirror of TEST 3.
- **Expected behavior:** Mirror of TEST 3.
- **Current result:** Same status as TEST 3 — not isolated, aggregate
  evidence only.
- **Parity status:** UNTESTED (isolated) / PARTIALLY OBSERVED (aggregate)
- **Evidence:** Same as TEST 3.

### TEST 5 — Breakeven activation

- **Input:** Price moves in favor of the position past `be_trigger_atr`
  × ATR, then reverses to touch the *original* SL level.
- **Expected behavior:** Because breakeven moved the stop to
  `entry + be_lock_atr × ATR`, the trade should close near breakeven
  (small profit), **not** at the original SL price — in the Python
  backtest. In generated code (§GAP-01), the trade would close at the
  original SL for a full loss instead.
- **Current result:** Not tested as an isolated scenario in either
  Python or codegen. This is the single most important test this plan
  defines, because it's the direct proof of GAP-01 — every real
  multi-symbol backtest run this sprint almost certainly contains
  trades that took this path (breakeven is on by default), but none
  were individually inspected to confirm the mechanism fired correctly.
- **Parity status:** UNTESTED — **highest priority test to actually
  build**, since it's the concrete demonstration of the report's top
  CRITICAL finding.
- **Evidence:** None isolated. Indirect: `engine.py:91-94`/
  `runner.py:78-81` code inspection confirms the logic exists and reads
  as correct, but was never exercised by a dedicated test.

### TEST 6 — ATR trailing activation

- **Input:** Price moves strongly in favor of the position past
  `trail_start_atr` × ATR, continues favorably for several more bars
  (stop should tighten each step), then reverses.
- **Expected behavior:** Trade closes at the trailed stop level (better
  than the original SL, likely a profit), never at a level *worse* than
  a previous trail step (trailing only tightens, confirmed by the
  `if (direction>0 and trail>sl)` guard in source).
- **Current result:** Not tested as an isolated scenario.
- **Parity status:** UNTESTED
- **Evidence:** None isolated; code inspection only
  (`engine.py:96-99`).

### TEST 7 — Partial close

- **Input:** Price moves favorably past `partial_atr` × ATR exactly
  once, then the remainder rides to TP.
- **Expected behavior:** One `reason="PARTIAL"` trade row at 50% of
  original volume, booked at the price when the threshold was crossed;
  one final `reason="TP"` row for the remaining 50% volume; `vol`
  reduction and `partial_done=True` prevent a second partial fire.
- **Current result:** **Real evidence exists** — the tick-engine test
  this sprint (`test_tick_engine.py`, MACD Crossover, 2024) recorded
  exactly this pattern in practice: trade pairs with matching
  `entry_time` and near-identical `entry_price`, one `reason="PARTIAL"`
  followed seconds later by one `reason="TP"` on the remaining volume
  (e.g. entry `2024-01-05 08:00:00`, PARTIAL at 0.07 lot then TP at
  0.08 lot — volumes sum to the original 0.15 lot). This is genuine,
  observed evidence, not a synthetic test, but it does confirm the
  mechanism works as designed in at least one real case.
- **Parity status:** OBSERVED WORKING (real data) / UNTESTED (as a
  controlled synthetic scenario)
- **Evidence:** `quant-engine/output/tick_engine_test_v3.log`
  (this session's real run).

### TEST 8 — SL and TP reached within same candle

- **Input:** A bar/minute/tick whose range spans both the SL and TP
  level.
- **Expected behavior:** SL-first tie-break fires (documented,
  conservative convention) — exit reason is "SL" even though TP was
  also technically touched.
- **Current result:** **Real evidence exists.** `execution_mtf.py`'s
  MACD Crossover run recorded `same_minute_sl_tp_conflicts=2` (2
  occurrences across 690 trades on 3 years of XAUUSD 1-minute data);
  `execution_tick.py`'s runs recorded `same_tick_sl_tp_conflicts=0` in
  both tests performed (MACD and Bollinger, 2024). This confirms the
  counter mechanism itself works and that the ambiguity is genuinely
  rare at finer granularity (0 occurrences per real tick vs. 2 per
  real minute, consistent with expectations), but no test isolates a
  single instance to confirm the *resolution* (which side actually got
  picked) is correct.
- **Parity status:** OBSERVED WORKING (counter mechanism, real data) /
  UNTESTED (resolution correctness, isolated)
- **Evidence:** `compare_engines_v2.log`, `tick_engine_test_v3.log`.

### TEST 9 — Multiple positions

- **Input:** A second `entry_long`/`entry_short` signal fires while a
  position is already open.
- **Expected behavior:** No second position opens — confirmed by code
  inspection as the one behavior with full four-way parity
  (`QUANT_LITE_EXECUTION_PARITY_MATRIX.md`).
- **Current result:** Not tested as an isolated scenario, but
  structurally guaranteed by the `if position is not None: continue`
  gate present in every engine before any entry-evaluation code runs —
  a second entry is not merely unlikely, it's unreachable code-path-wise
  while a position is open.
- **Parity status:** UNTESTED (isolated) but HIGH CONFIDENCE from static
  code structure (not the same as a proven test)
- **Evidence:** Source inspection only — `runner.py:107`,
  `execution_mtf.py:174`, `execution_tick.py:170`.

### TEST 10 — Risk percentage sizing

- **Input:** Two identical specs differing only in `risk_pct` (e.g. 1%
  vs 2%).
- **Expected behavior:** Position size scales linearly with `risk_pct`
  for the same stop distance and balance.
- **Current result:** Not tested — every real run this sprint used
  `risk_pct=1.0` exclusively; no comparison across different risk
  percentages was performed.
- **Parity status:** UNTESTED
- **Evidence:** None.

### TEST 11 — Spread impact

- **Input:** Identical spec/data run once with `spread_price=0.0` and
  once with a realistic value.
- **Expected behavior:** Higher spread should strictly reduce reported
  profit factor/return for the same trade sequence (spread is a pure
  cost, applied identically to every entry).
- **Current result:** Not tested as a controlled A/B — the real
  comparison performed this sprint (`runner.py`'s static 0.30 vs.
  `execution_mtf.py`'s real ~0.125 average) conflates the spread change
  with the SL/TP-granularity change (GAP-06), so it does not cleanly
  isolate spread's effect alone.
- **Parity status:** UNTESTED (isolated)
- **Evidence:** `compare_engines_v2.log` (confounded, not isolated).

### TEST 12 — Slippage impact

- **Input:** N/A — no slippage model exists in any Python engine to
  test (§GAP-05).
- **Expected behavior:** Cannot be defined until a slippage model is
  either built or explicitly declared out of scope.
- **Current result:** NOT APPLICABLE — feature does not exist.
- **Parity status:** NOT APPLICABLE
- **Evidence:** Confirmed absence, `QUANT_LITE_EXECUTION_CONTRACT.md` §7.

### TEST 13 — Commission impact

- **Input:** N/A — `commission_per_lot` is a dead field
  (`RiskConfig` has no such attribute, §GAP-08).
- **Expected behavior:** Cannot be defined until `RiskConfig` gains a
  real commission field.
- **Current result:** NOT APPLICABLE — feature is structurally inert.
- **Parity status:** NOT APPLICABLE
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §8.

### TEST 14 — Insufficient stop distance

- **Input:** A spec whose `sl_atr_mult`/`sl_points` produces an `sl_dist`
  of 0 or a negative value.
- **Expected behavior:** Per source, `runner.py`/`execution_mtf.py`/
  `execution_tick.py` all guard with `if sl_dist > 0:` before opening a
  position — a zero/negative stop distance should result in **no trade
  ever opening**, not a crash or a divide-by-zero.
- **Current result:** Not tested directly, but the guard is present and
  unconditional in source for all three engines — the same
  high-confidence-from-structure caveat as TEST 9 applies.
- **Parity status:** UNTESTED (isolated) but HIGH CONFIDENCE from static
  code structure
- **Evidence:** Source inspection — `runner.py:127`,
  `execution_mtf.py:194`, `execution_tick.py:206`.

### TEST 15 — Account drawdown/account-blow condition

- **Input:** A spec/data combination that produces a sustained losing
  streak sufficient to drive `balance` to zero or below.
- **Expected behavior:** Once `balance <= 0`, no further entries open
  for the remainder of the run (`account_blown` guard, fixed Q0.2);
  `total_return_pct`/`max_drawdown_pct` should cap at exactly −100%
  rather than continue past it.
- **Current result:** **Real evidence exists — this is the strongest
  test in this entire plan**, because it's the one scenario that
  actually occurred naturally in real data this sprint. Bollinger Mean
  Reversion on real XAUUSD 2024–2026 data drove the account to
  `final_balance=$831.08`/`account_blown=True` (tick-engine, 2024
  window) and to a capped −100.01% drawdown (MTF engine, full window)
  post-fix, versus an impossible −141.36% pre-fix. Both the trigger
  condition and the halt behavior are confirmed working on real data,
  not a synthetic fixture.
- **Parity status:** CONFIRMED WORKING (real data, both pre/post-fix
  states observed and compared)
- **Evidence:** `compare_engines_v2.log`, `tick_engine_test_v3.log`,
  and this sprint's direct trade-log inspection (Bollinger trade #515
  crossing to negative balance, subsequent trades correctly floored at
  minimum lot pre-fix / correctly halted post-fix).

### TEST 16 — Missing/invalid market data

- **Input:** A spec run against a DataFrame with `NaN` values (e.g. an
  indicator's warm-up period) or fewer than 50 rows total.
- **Expected behavior:** `NaN` rows are dropped by `compute_all(...).
  dropna()`; a total of fewer than 50 usable rows returns an empty,
  well-formed result (`{"trades_total": 0, "error": "not enough bars"}`)
  rather than crashing.
- **Current result:** The `<50` guard fires routinely in normal
  operation (every `spec_walk_forward()` fold that's too short hits this
  exact path, observed throughout the library-generation and
  robustness-scoring code this sprint), so this path is exercised in
  practice, just not via a dedicated isolated test with an intentionally
  malformed input.
- **Parity status:** OBSERVED WORKING (real usage) / UNTESTED
  (adversarial/malformed input specifically)
- **Evidence:** `robustness.py:23-24` code path, exercised during
  library generation (indirect).

### TEST 17 — Repeated execution produces identical results

- **Input:** Same spec, same data, same `RiskConfig`, run twice.
- **Expected behavior:** Byte-identical output both times.
- **Current result:** **Confirmed directly this sprint.** After applying
  the account-blown fix, `demo.py` was re-run and reproduced the
  original cloud session's exact reference numbers (0 trades/PF n/a for
  RSI+EMA; 1765 trades/PF 0.92/−33.86%/−48.5% for MACD; 2039
  trades/PF 0.90/−55.32%/−62.14% for Bollinger) — an independent
  verification of determinism across a real code change (proving the
  fix didn't introduce any incidental behavior change for these specs,
  *and* proving repeat-run determinism as a side effect).
- **Parity status:** CONFIRMED
- **Evidence:** This session's `python demo.py` re-run, compared
  against `quant-engine/output/demo_summary.json`.

### TEST 18 — Different data ordering does not silently alter deterministic results where ordering should be irrelevant

- **Input:** N/A as stated — every backtest in this codebase is
  inherently order-dependent by design (a chronological trade sequence,
  where balance/equity/position state at step N depends on steps
  1..N-1). There is no operation in `runner.py`/`execution_mtf.py`/
  `execution_tick.py` that claims order-independence (unlike, say, a
  parallel aggregation where reordering should be safe).
- **Expected behavior:** This test as literally stated does not apply
  to a sequential backtest loop — the correct framing is narrower:
  confirm that *within one chronological run*, the streaming/chunked
  data ingestion (`scripts/import_exness.py`'s chunk-boundary handling)
  produces the same result as an unchunked read of the same data.
- **Current result:** **Partially confirmed by accident this sprint** —
  the duplicate-timestamp investigation (Q0.2 session work) compared a
  50,000-row chunk size against a 2,000,000-row chunk size on the same
  real XAUUSD 2024 file and found the smaller chunk size produced 2
  duplicate-minute artifacts that the production chunk size did not,
  which was root-caused to a genuine source-data anomaly (an
  out-of-order stretch in the raw feed) rather than a chunking bug —
  but this did demonstrate that chunk size *can* affect output in edge
  cases, which is exactly what this test category exists to catch, even
  though the specific instance found was traced to real data, not a
  code defect.
- **Parity status:** PARTIALLY TESTED (chunk-size sensitivity confirmed
  present in one specific, understood, non-systemic case) — a proper
  version of this test (fixed synthetic tick data, multiple chunk
  sizes, assert identical output) does not exist and should be built.
- **Evidence:** Q0.2 session diagnostic output (duplicate-row
  investigation on `Exness_XAUUSD_2024.zip`).

---

## Summary

| # | Test | Status |
|---|---|---|
| 1 | Basic BUY + TP | UNTESTED |
| 2 | Basic SELL + TP | UNTESTED |
| 3 | BUY + SL | UNTESTED (isolated) / partial aggregate evidence |
| 4 | SELL + SL | UNTESTED (isolated) / partial aggregate evidence |
| 5 | Breakeven activation | **UNTESTED — highest-priority test to build** |
| 6 | ATR trailing activation | UNTESTED |
| 7 | Partial close | OBSERVED WORKING (real data) |
| 8 | Same-candle SL+TP | OBSERVED WORKING (counter mechanism) / resolution untested |
| 9 | Multiple positions | UNTESTED, high structural confidence |
| 10 | Risk % sizing | UNTESTED |
| 11 | Spread impact | UNTESTED (isolated) |
| 12 | Slippage impact | NOT APPLICABLE (feature doesn't exist) |
| 13 | Commission impact | NOT APPLICABLE (feature is dead) |
| 14 | Insufficient stop distance | UNTESTED, high structural confidence |
| 15 | Account blow | **CONFIRMED (real data, strongest evidence in this plan)** |
| 16 | Missing/invalid data | OBSERVED WORKING (indirect) |
| 17 | Repeated execution determinism | **CONFIRMED** |
| 18 | Data-ordering sensitivity | PARTIALLY TESTED (one real instance) |

**Zero of the 18 tests exist as automated, isolated, assertion-based
code.** Two (TEST 15, TEST 17) have strong real-data confirmation from
this sprint's actual work. The rest range from "structurally
high-confidence but unverified" to "genuinely unknown." Building TEST 5
(breakeven activation) as a real, isolated, synthetic test should be the
first concrete engineering task of whichever sprint follows this one —
it is the direct, controlled proof of this report's top CRITICAL finding.
