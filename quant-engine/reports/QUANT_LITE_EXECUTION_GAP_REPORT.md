# Q0.3 — Quant Lite Execution Gap Report

Every material mismatch identified in
[`QUANT_LITE_EXECUTION_PARITY_MATRIX.md`](QUANT_LITE_EXECUTION_PARITY_MATRIX.md),
assessed for whether the difference is *material* — not just different.
Severity: **CRITICAL** / **HIGH** / **MEDIUM** / **LOW** / **INFORMATIONAL**.

---

### GAP-01 — Breakeven stop not implemented in any code generator

- **Component:** Position management — breakeven
- **Current Python behavior:** Once floating profit reaches
  `be_trigger_atr` × ATR (default 1.0×), the stop moves to
  `entry + be_lock_atr × ATR` (default 0.1×), locking in a small profit.
  Active by default, unconditionally, in every backtest this codebase has
  ever run.
- **Generated-code behavior:** The stop never moves after entry. A trade
  that reaches breakeven-trigger distance and then reverses all the way
  back to the *original* stop loses the full stop distance in the
  generated EA, versus a small profit (or a wash) in the Python backtest.
- **Severity:** CRITICAL
- **Financial/result impact:** Directly changes win/loss classification
  for any trade that reaches the breakeven trigger and then reverses —
  this is not a small effect. It moves both win rate and average
  loss size.
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §13;
  `quant_engine/engine.py:20,91-94`; confirmed absent by grep across
  `codegen_mql5.py`, `codegen_mql4.py`, `codegen_pine.py` (zero matches
  for `breakeven`).
- **Recommended action:** Per Q0.3's "no blind fixes" rule, not fixed
  here. See `QUANT_LITE_EXECUTION_DECISION.md` for the classification
  decision.
- **Must be fixed before Quant Lite:** Yes, in one direction or the
  other (implement in codegen, or disable in the backtest default) — see
  decision document. Shipping the current mismatch to a Quant Lite user
  is the single highest-priority blocker this audit found.

### GAP-02 — ATR trailing stop not implemented in any code generator

- **Component:** Position management — trailing stop
- **Current Python behavior:** Once floating profit reaches
  `trail_start_atr` × ATR (default 2.0×), the stop trails at
  `price - trail_atr_mult × ATR` (default 3.0×), tightening every step,
  never loosening. Active by default, unconditionally.
- **Generated-code behavior:** No trailing logic exists. A large winning
  move that later gives back profit is captured at the (better) trailed
  level in Python, but rides all the way back to the original static SL
  in the generated EA.
- **Severity:** CRITICAL
- **Financial/result impact:** Directly affects average win size and
  max-favorable-excursion capture on trending trades — one of the
  larger single contributors to a strategy's reported profit factor when
  it's driven by a few large winners.
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §14;
  `quant_engine/engine.py:24,96-99`; confirmed absent by grep (zero
  matches for `trail` in all three codegens).
- **Recommended action:** See decision document.
- **Must be fixed before Quant Lite:** Yes — same reasoning as GAP-01.

### GAP-03 — Partial close not implemented in any code generator

- **Component:** Position management — partial close
- **Current Python behavior:** At `partial_atr` × ATR profit (default
  2.0×), 50% of the position closes and books realized PnL immediately;
  the remainder rides with its own (unchanged) SL/TP. Active by default,
  unconditionally, fires once per trade.
- **Generated-code behavior:** The full position rides to SL or TP —
  no partial realization. This changes not just the final result but
  the **shape** of the equity curve (Python realizes profit in two
  steps; the generated EA realizes it in one, later, step, or not at all
  if the remainder later reverses past breakeven).
- **Severity:** CRITICAL
- **Financial/result impact:** Directly changes `trades_total` (a
  partial close is recorded as its own trade row with `reason="PARTIAL"`
  in the Python engines — every historical `trades_total` figure
  includes these), realized-vs-floating PnL timing, and drawdown shape.
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §15;
  `quant_engine/engine.py:28,101-111`; confirmed absent by grep (zero
  matches for `partial`).
- **Recommended action:** See decision document.
- **Must be fixed before Quant Lite:** Yes — same reasoning as GAP-01/02.

### GAP-04 — `runner.py` uses a static, unmeasured spread constant

- **Component:** Spread handling
- **Current Python behavior:** Every call site in this repository passes
  `spread_price=0.30` to `RiskConfig`, hardcoded, never derived from
  real market data.
- **Generated-code behavior:** N/A — real broker spread applies live.
- **Severity:** HIGH
- **Financial/result impact:** Directly measured this sprint: real
  average XAUUSD spread from Exness tick data is ~0.125 (median 0.125,
  IQR 0.112–0.125) — the static 0.30 assumption is roughly **2.4× the
  real cost**. For a strategy trading hundreds of times, this alone can
  be the difference between a reported loser and winner (observed:
  MACD Crossover PF 0.95 under `runner.py`'s static spread vs. PF 2.05
  under `execution_mtf.py`'s real spread, same underlying data window —
  though this comparison also changes SL/TP resolution granularity
  simultaneously, so the two effects are not yet isolated from each
  other; see GAP-06).
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §6; smoke-test spread
  statistics gathered during the Exness import (Q0.2 session work).
- **Recommended action:** See decision document.
- **Must be fixed before Quant Lite:** Not necessarily by fixing
  `runner.py` specifically — `execution_mtf.py` already solves this
  correctly and is the stronger canonical-engine candidate per
  `QUANT_LITE_LEGACY_AUDIT.md` §8. The action is choosing not to build
  Quant Lite on `runner.py`'s spread model, not patching it in place.

### GAP-05 — No slippage cost is modeled in any Python backtest engine

- **Component:** Slippage handling
- **Current Python behavior:** Zero — every fill happens at the exact
  intended price.
- **Generated-code behavior:** MQL5/MQL4 tolerate up to 20 points of
  broker-side deviation on order submission (a fill-rejection guard, not
  a modeled cost); Pine sets no slippage parameter.
- **Severity:** LOW
- **Financial/result impact:** Real slippage on liquid instruments
  (XAUUSD, major FX pairs) during normal conditions is typically small
  relative to the spread already being modeled (or not modeled, per
  GAP-04) — but during news events or thin liquidity it can be material.
  Not measured this sprint; classified LOW on the basis that it's a
  smaller, less certain effect than GAP-01–04, not on the basis of
  having been proven negligible.
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §7, §28.
- **Recommended action:** See decision document.
- **Must be fixed before Quant Lite:** No — informational for now,
  revisit if/when live or paper-trading verification becomes part of
  the product.

### GAP-06 — The three Python engines are not yet cross-validated on identical data windows

- **Component:** Engine-to-engine consistency (not a Python-vs-codegen
  gap — an internal Python-side gap)
- **Current behavior:** `runner.py` (PF 0.95, full 2024–2026 XAUUSD),
  `execution_mtf.py` (PF 2.05, same window), and `execution_tick.py`
  (PF 2.44, **2024 only** — a different, narrower window) were compared
  pairwise but never all three on the exact same date range in the same
  test run.
- **Severity:** MEDIUM
- **Financial/result impact:** Unknown precisely, because the
  granularity effect (coarse-bar vs. minute vs. tick SL/TP resolution)
  and the spread-realism effect (GAP-04) and the time-window difference
  are all currently conflated in the one data point available. This gap
  report cannot currently tell you how much of the PF 2.05 → 2.44 change
  is engine precision versus which specific year performed better.
- **Evidence:** Session comparison logs
  (`quant-engine/output/compare_engines_v2.log`,
  `tick_engine_test_v3.log`).
- **Recommended action:** A future test run with all three engines
  pointed at the identical symbol/date-range/spec, isolating this one
  variable. Not performed in Q0.3 per the "do not rerun large
  optimization searches" instruction — this is flagged as a needed
  **test**, not fixed here.
- **Must be fixed before Quant Lite:** Should be resolved before
  finalizing which engine becomes canonical (`QUANT_LITE_LEGACY_AUDIT.md`
  §8's open item on `execution_mtf.py`).

### GAP-07 — Session filter silently ignored by the entire spec-engine pipeline

- **Component:** Time/session handling
- **Current Python behavior:** `RiskConfig.session_start`/`session_end`
  defaults to 7–19 and is honored by the base `quant_engine/engine.py`,
  but **none** of `runner.py`/`execution_mtf.py`/`execution_tick.py`
  reference it at all — every spec-engine backtest trades 24/5
  regardless of this setting.
- **Generated-code behavior:** Also absent — codegen never receives or
  implements a session filter.
- **Severity:** MEDIUM
- **Financial/result impact:** Unmeasured. Session filtering is a common
  real-world risk control (avoiding illiquid Asian-session gold trading,
  for instance); its complete absence from the entire spec pipeline
  means every reported backtest number implicitly assumes 24/5 trading
  even though the underlying `RiskConfig` object suggests the *intent*
  was to restrict it.
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §21; grep confirms
  zero matches for `session_start`/`in_session` in all three spec
  engines.
- **Recommended action:** See decision document — this is a "does the
  spec engine silently ignore its own config" bug, independent of the
  Python-vs-codegen mismatch theme of GAP-01–03.
- **Must be fixed before Quant Lite:** Not necessarily — could
  legitimately be decided as "Quant Lite doesn't support session
  filtering at all, and that's fine" (Decision E, mark unsupported)
  rather than "fix the silent-ignore bug." Either is honest; leaving it
  silently ignored while `RiskConfig` implies it's active is not.

### GAP-08 — Commission hook exists in two engines but is permanently dead

- **Component:** Commission handling
- **Current Python behavior:** `execution_mtf.py`/`execution_tick.py`
  both subtract `commission_per_lot × volume` from every close — but
  `RiskConfig` has no such field, so this always evaluates to `0.0`.
- **Severity:** INFORMATIONAL
- **Financial/result impact:** None currently (the hook is inert) — but
  it creates a false impression on code review that commission is
  modeled when it structurally cannot be without an unrelated
  `RiskConfig` change.
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §8.
- **Recommended action:** See decision document.
- **Must be fixed before Quant Lite:** No — cosmetic/documentation-level
  issue, not a behavioral one.

### GAP-09 — No broker minimum-stop-distance / freeze-level validation anywhere

- **Component:** Stop-distance validation
- **Current Python behavior:** Not modeled — any `sl_dist`/`tp_dist`
  greater than zero is accepted.
- **Generated-code behavior:** Not checked before `OrderSend` in either
  MQL5 or MQL4 — a real broker could reject an order whose SL/TP is
  closer to price than its `SYMBOL_TRADE_STOPS_LEVEL`/freeze level, and
  the generated EA has no defensive check for that failure mode.
- **Severity:** LOW
- **Financial/result impact:** Only relevant for very tight
  ATR-multiplier configurations on symbols/brokers with wide minimum-stop
  requirements — plausible but unmeasured, and it's a shared gap (both
  sides absent) rather than a Python-vs-codegen divergence, so it
  doesn't distort the *comparison* between backtest and live behavior
  the way GAP-01–04 do.
- **Evidence:** `QUANT_LITE_EXECUTION_CONTRACT.md` §28; grep confirms no
  `STOPLEVEL`/`FREEZELEVEL` reference anywhere in either MQL codegen.
- **Recommended action:** See decision document.
- **Must be fixed before Quant Lite:** No — informational, worth a
  defensive check in codegen eventually but not a correctness-of-results
  issue.

---

## Severity summary

| Severity | Count | Items |
|---|---|---|
| CRITICAL | 3 | GAP-01, GAP-02, GAP-03 |
| HIGH | 1 | GAP-04 |
| MEDIUM | 2 | GAP-06, GAP-07 |
| LOW | 2 | GAP-05, GAP-09 |
| INFORMATIONAL | 1 | GAP-08 |

No CRITICAL or HIGH item was fixed in Q0.3 — per the sprint's explicit
"no blind fixes" instruction, all nine are documented for the decision
document to classify, not resolved in place.
