# Q0.3 — Quant Lite Execution Contract

**Status:** Audit only. Defines what the CURRENT legacy execution model
actually does, proven from source, not what it should do. No code was
changed to produce this document. Every claim below cites the file and
line/function responsible.

**Scope covered:** `quant_engine/engine.py` (base engine, `RiskConfig`),
`quant-engine/spec_engine/runner.py`, `execution_mtf.py`,
`execution_tick.py` (the three spec-based Python backtesters),
`codegen_mql5.py`, `codegen_mql4.py`, `codegen_pine.py`.

Classification key: **IMPLEMENTED** / **PARTIALLY IMPLEMENTED** /
**NOT IMPLEMENTED** / **AMBIGUOUS** / **NOT APPLICABLE**.

---

## 1. Data model

**IMPLEMENTED.** A flat pandas DataFrame with columns `ts, open, high,
low, close` (plus one column per indicator, appended by
`indicators.py::compute_all`). No volume column is used by any signal or
risk logic anywhere in the spec pipeline (`quant_engine/db.py`'s
`candles` table has a `volume` column, populated by the Exness importer
as tick-count, but no spec-engine file reads it). Source: `runner.py:24`,
`execution_mtf.py:62`, `execution_tick.py:57` (all call
`compute_all(df.copy(), spec["indicators"]).dropna()`).

## 2. Candle/tick semantics

**PARTIALLY IMPLEMENTED — three different semantics coexist.**
`runner.py` operates on the spec's own timeframe bars only (e.g. 1h) for
everything, signal and execution alike. `execution_mtf.py` uses the
spec's timeframe for signals but real 1-minute bars (`market.db`'s
`candles` table, `timeframe='1m'`) for fill/SL/TP resolution.
`execution_tick.py` uses the spec's timeframe for signals but real,
unaggregated ticks (streamed live from the Exness zip files via
`scripts/import_exness.py::iter_tick_chunks`) for fill/SL/TP resolution.
These are not three configurations of one semantic — they are three
different backtest loops. See `QUANT_LITE_LEGACY_AUDIT.md` §5.1.

## 3. Signal evaluation timing

**IMPLEMENTED, consistently across all three Python engines.** A signal
is evaluated once per **closed** signal-timeframe bar, using that bar's
own values (`cur`) and the immediately preceding signal bar's values
(`prev`), via `interpreter.py::evaluate_entry(spec, cur_row, prev_row)`.
No engine evaluates a signal on a still-forming (unclosed) bar. Source:
`runner.py:110` (`evaluate_entry(spec, cur, prev)` inside the per-bar
loop, `cur = rows[i]`), `execution_mtf.py:177`
(`evaluate_entry(spec, cur_sig, prev_sig)` where both are the two most
recently *closed* signal bars), `execution_tick.py:170-172` (same
pattern, gated on `signal_advanced`).

## 4. Entry timing

**AMBIGUOUS in a specific, documented way — differs by engine.**
- `runner.py`: fills at the same signal bar's own close price
  (`price_now = cur["close"]`, `entry_price = price_now + spread/2`),
  i.e. entry is assumed instantaneous at the signal bar's close. Source:
  `runner.py:59,112`.
- `execution_mtf.py`: fills at the first 1-minute bar whose timestamp is
  `>=` the signal bar's close, using that minute's real spread. Source:
  `execution_mtf.py:119,179` (`price_now = cur["close"]` where `cur` is
  the current 1-minute row).
- `execution_tick.py`: fills at the exact real tick that triggered the
  entry check (the first tick at or after the signal bar's close),
  using that tick's real Ask (buy) or Bid (sell). Source:
  `execution_tick.py:183` (`entry_price = ask_i if direction > 0 else bid_i`).

None of the three "look ahead" past the signal bar's own close to decide
*whether* to enter — the ambiguity is only in *what price* the fill
happens at, which is progressively more precise (bar-close approximation
→ minute-level → real tick) across the three engines, not contradictory.

## 5. Exit timing

**IMPLEMENTED, SL/TP-triggered, checked every step of the engine's own
granularity** (every signal bar in `runner.py`, every minute in
`execution_mtf.py`, every tick in `execution_tick.py`). Exit happens the
instant price touches the stored SL or TP level — never delayed to a bar
close. Source: `runner.py:65-66`, `execution_mtf.py:125-126`,
`execution_tick.py:110-112`.

## 6. Spread handling

**PARTIALLY IMPLEMENTED — improves across the three engines, none model
a bid/ask beyond what's described.**
- `runner.py`: a single static `risk.spread_price` value supplied by the
  caller (every call site in this repo uses `0.30`, hardcoded, never
  measured from real data). Source: `runner.py:112`.
- `execution_mtf.py`: real, time-varying average spread per 1-minute bar,
  read from `market.db`'s `candle_spread` table (populated by
  `scripts/import_exness.py` from actual Exness bid/ask ticks). Source:
  `execution_mtf.py:120` (`spread_now = cur.get("spread", ...)`).
- `execution_tick.py`: the real bid/ask of the exact triggering tick — no
  averaging at all. Source: `execution_tick.py:104` (`spread_i = ask_i -
  bid_i`, though `spread_i` itself is computed but not directly used for
  entry pricing — entry fills at the tick's real `ask_i`/`bid_i`
  directly, which already embeds the true spread).
- All three apply spread **only at entry** (half added to the buy side /
  subtracted from the sell side via the entry-price formula, or the raw
  Ask/Bid in `execution_tick.py`); none re-apply spread at exit (SL/TP
  exits at the stored level directly, no additional spread deduction).

## 7. Slippage handling

**NOT IMPLEMENTED** in any of the three Python backtest engines — every
fill happens at the exact intended price (entry: spread-adjusted signal
price; exit: the exact SL/TP level). No random or fixed slippage
component exists anywhere in `runner.py`, `execution_mtf.py`, or
`execution_tick.py`. Confirmed by absence — no `slippage` identifier
appears in any of the three files.

## 8. Commission handling

**PARTIALLY IMPLEMENTED, effectively dead.** `execution_mtf.py` and
`execution_tick.py` both added a `commission_per_lot` deduction this
sprint (`getattr(risk, "commission_per_lot", 0.0)`, subtracted from PnL
on every close), but `quant_engine/engine.py::RiskConfig` has no such
field — every real call always evaluates this to `0.0`. `runner.py` and
the base `engine.py::run_backtest()` have no commission concept at all.
Source: `execution_mtf.py:80,136,155`, `execution_tick.py:66,124,143`;
absence confirmed in `quant_engine/engine.py:13-36`.

## 9. Position sizing

**IMPLEMENTED, identical formula across `engine.py`, `runner.py`,
`execution_mtf.py`, `execution_tick.py`:**
`vol = max(0.01, round((balance × risk_pct / 100) / (sl_dist ×
contract_size), 2))`. Floors at 0.01 lot; no max-lot cap, no lot-step
rounding beyond the 2-decimal `round()`. Source: `engine.py:136-137`,
`runner.py:128-129`, `execution_mtf.py:195-196`,
`execution_tick.py:196-197` — all four are line-for-line the same
formula.

## 10. Risk-per-trade calculation

**IMPLEMENTED.** `risk_money = balance × (risk.risk_pct / 100.0)`,
computed fresh at entry against the **current** balance (not the
starting balance), so risk-per-trade compounds as the account grows or
shrinks. Same source lines as §9.

## 11. Stop-loss calculation

**IMPLEMENTED, consistent formula, two modes.** `sl = entry_price -
direction × sl_dist`, where `sl_dist = atr_value × risk.sl_atr_mult`
(ATR mode) or a fixed `risk.sl_points` (PIPS mode — a raw price-unit
distance despite the name, per `schema.py`'s own docstring, not a
broker pip count). Identical across `runner.py:118-119`,
`execution_mtf.py:185-186`, `execution_tick.py:203-204`, and mirrored in
all three codegens (`codegen_mql5.py:235`, `codegen_mql4.py`, per
`QUANT_LITE_LEGACY_AUDIT.md` — same default 3.0/2.0-mult constants).

## 12. Take-profit calculation

**IMPLEMENTED**, same structure as §11
(`tp = entry_price + direction × tp_dist`). Same source lines.

## 13. Breakeven behavior

**IMPLEMENTED in all three Python backtest engines and the base engine
— NOT IMPLEMENTED in any of the three code generators.** Python:
once floating profit reaches `be_trigger_atr` × ATR, the stop moves to
`entry + direction × be_lock_atr × ATR` (only if that's an improvement
over the current stop). Enabled by default
(`RiskConfig.use_breakeven=True`, `quant_engine/engine.py:20`) and
**never disabled by any call site in this repository** (see the
RiskConfig audit, §below). Source: `engine.py:91-94`, `runner.py:78-81`,
`execution_mtf.py:144-147`, `execution_tick.py:132-134`. Codegen:
confirmed absent by direct search across all three generator files —
zero matches for `breakeven`.

## 14. ATR trailing behavior

**Same split as §13 — IMPLEMENTED in Python (default on), NOT
IMPLEMENTED in codegen.** Trail level: `price_now - direction ×
trail_atr_mult × ATR`, applied once floating profit reaches
`trail_start_atr` × ATR, only tightening the stop, never loosening it.
Source: `engine.py:96-99`, `runner.py:82-85`, `execution_mtf.py:148-151`,
`execution_tick.py:135-138`. Codegen: absent, zero matches for `trail`.

## 15. Partial-close behavior

**Same split again — IMPLEMENTED in Python (default on, 50% close at
`partial_atr` × ATR profit), NOT IMPLEMENTED in codegen.** Closes
`round(vol × partial_pct, 2)` of the position once, flags
`partial_done=True` so it never fires twice per trade. Source:
`engine.py:101-111`, `runner.py:86-96`, `execution_mtf.py:152-163`,
`execution_tick.py:139-150`. Codegen: absent, zero matches for
`partial`.

## 16. Multiple-position behavior

**IMPLEMENTED — single position at a time, consistently everywhere.**
Every Python engine refuses a new entry while `position is not None`
(`runner.py:107`, `execution_mtf.py:174`, `execution_tick.py:170`, and
the base `engine.py:123-124`). Every codegen enforces the same rule via
a broker-side open-position check before entry: MQL5's
`HasOpenPosition()` (`codegen_mql5.py:275-285,322`), MQL4's equivalent
over `OrdersTotal()` (`codegen_mql4.py:215-217,258`), and Pine's
`strategy.position_size == 0` guard (`codegen_pine.py:151,156`). No
pyramiding, no hedging, no multi-symbol concurrent positions anywhere in
this codebase. **This is genuine parity** — the one execution behavior
where Python and all three code generators agree exactly.

## 17. Same-bar entry/exit behavior

**IMPLEMENTED as a documented, conservative convention, in the Python
engines only** (not applicable to codegen — real MT4/5/TradingView
platforms resolve this via the actual market, not a simulation choice).
When both SL and TP are touched within the same evaluation step (bar /
minute / tick, per engine), **SL is always assumed to have happened
first** — a deliberately pessimistic tie-break, not an attempt to
determine the true order. `execution_mtf.py` and `execution_tick.py`
additionally **count** how often this ambiguity actually occurs
(`same_minute_sl_tp_conflicts`, `same_tick_sl_tp_conflicts`) rather than
resolving it silently. Source: `engine.py:80-81`, `runner.py:68-69`,
`execution_mtf.py:126-134`, `execution_tick.py:106-112,116`.

## 18. Intrabar assumptions

**Directly tied to §2/§17.** `runner.py` assumes a signal-timeframe
bar's `high`/`low` are reachable in any order within that bar (checked
via simple `>=`/`<=` comparison, no ordering inferred) — the coarsest
assumption of the three. `execution_mtf.py` narrows the "any order"
window to one real minute. `execution_tick.py` removes the assumption
almost entirely — real tick order is used directly, with the SL-first
tie-break applying only in the residual case of two conditions being
true on the exact same tick (a real, but rare, occurrence — 0 times in
every test run performed this session on the tested specs).

## 19. Account balance/equity handling

**IMPLEMENTED, identical pattern across all four Python engines.**
`balance` updates only on realized PnL (SL/TP/partial closes);
`equity`/floating PnL is tracked separately per step and never
persisted back into `balance` until a position actually closes. Source:
`engine.py:115-116`, `runner.py:99-100`, `execution_mtf.py:165-167`
(sampled per-minute, not per-tick, for the 1-minute engine — a
performance choice), `execution_tick.py:159-163` (sampled per-minute
even in the tick engine, for the same reason — the equity *curve* is
minute-resolution even though trade execution is tick-resolution).

## 20. Margin/account-blow behavior

**FIXED THIS SPRINT (Q0.2) in `runner.py`, `execution_mtf.py`,
`execution_tick.py` — STILL UNFIXED in the base `quant_engine/engine.py`.**
Before the fix, nothing stopped `balance` from going negative and the
sizing formula (§9) from continuing to open trades against a
negative/zero balance (floored at the 0.01 minimum lot). The fix adds an
`account_blown` flag: once `balance <= 0`, no further entries are opened
for the rest of the run. Verified this sprint: `demo.py`'s reference
numbers are unchanged after the fix (it never triggered for those
specs), and Bollinger Mean Reversion's drawdown on real 2024-2026
XAUUSD data correctly caps at −100.01% post-fix versus an impossible
−141.36% pre-fix. Source of the fix:
`runner.py` (`account_blown` variable, gate at the entry-check line),
`execution_mtf.py` (same pattern), `execution_tick.py` (same pattern).
**`quant_engine/engine.py::run_backtest()` was not touched (out of scope
both for Q0.2 and Q0.3 — vendored dependency) and still has the
identical unguarded pattern** at `engine.py:136-137`. Not applicable to
codegen — real brokers enforce their own margin-call/stop-out, which no
generated EA needs to reimplement.

## 21. Time/session handling

**AMBIGUOUS split, worth stating precisely.** `quant_engine/engine.py`'s
`run_backtest()` DOES honor `RiskConfig.session_start`/`session_end`
(default 7–19) via `in_session()` (`engine.py:39-42,126`). **None of the
three spec-engine backtesters (`runner.py`, `execution_mtf.py`,
`execution_tick.py`) reference `session_start`/`session_end`/
`in_session` at all** — confirmed by direct search, zero matches in all
three files. So the spec pipeline silently ignores a `RiskConfig` field
that the sibling base engine honors. None of the three code generators
implement a session/trading-hours filter either — this is the one
place where Python (spec-engine) and codegen happen to agree, but only
because both sides independently ignore the same setting, not because
either deliberately implements the same behavior.

## 22. Determinism

**IMPLEMENTED.** Given a fixed spec, fixed input data, and fixed
`RiskConfig`, every engine produces bit-identical output on repeat runs
— confirmed in practice this sprint (`demo.py` re-run after the
account-blown fix reproduced the original cloud session's numbers
exactly). No engine uses any random-number source, timestamp-of-run
value, or unordered-collection iteration in a way that could vary
output between runs.

## 23. Randomness, if any

**NOT APPLICABLE.** No randomness exists anywhere in the four Python
engines or three code generators — confirmed by absence (no `random`,
`np.random`, or similar import anywhere in `quant-engine/spec_engine/`
or `quant_engine/engine.py`). No Monte Carlo, no perturbation testing,
no stochastic slippage/spread model exists in this codebase.

## 24. Data gaps

**AMBIGUOUS / NOT IMPLEMENTED, distinct from missing-value handling
(§25).** No engine detects or flags an irregular time gap between
consecutive bars (e.g. a weekend, a broker outage, a feed disconnect) —
the loops iterate row-by-row over whatever rows are present in the
DataFrame, with no check on `ts[i] - ts[i-1]`. A large real gap would
silently be treated as if adjacent bars were continuous. Whether this
matters in practice depends on how gappy the underlying data source is;
this audit did not measure gap frequency/size in the imported Exness
data, so the practical impact is unproven — hence AMBIGUOUS rather than
a confirmed severity.

## 25. Missing-data behavior

**IMPLEMENTED, for NaN values specifically.** `compute_all(...).dropna()`
drops any row where an indicator hasn't warmed up yet (or where a
formula produced NaN, e.g. `RSI`'s `avg_loss.replace(0, np.nan)` guard).
This only handles NaN cells within otherwise-present rows — it is not
the same mechanism as gap detection (§24). Source: `runner.py:24`,
`execution_mtf.py:62`, `execution_tick.py:57`.

## 26. Unsupported conditions

**IMPLEMENTED as a validation gate, not a runtime behavior.**
`schema.py::validate_spec()` rejects unknown indicator types and unknown
condition operators before any backtest runs (`runner.py:20-22` and
equivalent in the other two engines call `validate_spec` and raise
`ValueError` on any error). It does **not** validate numeric ranges
(zero/negative periods or multipliers pass validation and fail silently
downstream, typically as "never trades" rather than a crash — see
`QUANT_LITE_LEGACY_AUDIT.md` §6).

## 27. Error handling

**PARTIALLY IMPLEMENTED.** Three specific guards exist: (1) spec
validation errors raise `ValueError` before any backtest work happens;
(2) insufficient data (`len(df) < 50`) returns an empty, well-formed
result rather than crashing (`runner.py:25-26` and equivalent); (3)
division-by-zero is guarded in several indicator formulas via
`.replace(0, np.nan)`. **Beyond these three specific cases, no engine
wraps its main loop in a try/except** — an unexpected error (e.g. a
missing expected column, a malformed spec that passes `validate_spec`
but breaks downstream) would raise an unhandled Python exception and
terminate the run rather than degrading gracefully or reporting a
structured error.

## 28. Code-generation assumptions

**IMPLEMENTED for indicators and static SL/TP, NOT IMPLEMENTED for
dynamic risk management (§13-15,20) or session filtering (§21).**
Code generation assumes: single-position-at-a-time (§16, matches
Python); static SL/TP set once at entry and never adjusted (does NOT
match Python, whose default RiskConfig actively adjusts SL via
breakeven/trailing); real broker execution for slippage/margin (MQL5/MQL4
allow up to 20 points of order-fill deviation via `req.deviation=20`
(`codegen_mql5.py:313`) and `OrderSend(...,20,...)`
(`codegen_mql4.py:249`) — a real-world tolerance, not a simulated cost,
and Pine sets no explicit slippage parameter at all); zero commission
modeling (matches Python's effectively-dead commission hook); no
broker minimum-stop-distance (`SYMBOL_TRADE_STOPS_LEVEL`/freeze level)
check before submitting an order — a generated EA could have its SL/TP
rejected by a real broker for being too close to price, and nothing in
the codegen or the Python backtest models or catches that.

---

## RiskConfig audit

**Default values** (`quant_engine/engine.py:13-36`):

| Field | Default |
|---|---|
| `risk_pct` | 1.0 |
| `spread_price` | 0.20 |
| `contract_size` | 100 |
| `start_balance` | 10000 |
| `use_breakeven` | **True** |
| `be_trigger_atr` / `be_lock_atr` | 1.0 / 0.1 |
| `use_trailing` | **True** |
| `trail_start_atr` / `trail_atr_mult` | 2.0 / 3.0 |
| `use_partial` | **True** |
| `partial_atr` / `partial_pct` | 2.0 / 0.5 |
| `use_daily_limit` | **True** |
| `daily_max_loss_pct` | 3.0 |
| `session_start` / `session_end` | 7 / 19 |

**Override mechanism:** `RiskConfig.__init__(**kw)` — any field can be
overridden by keyword at construction time. There is **no per-spec
override mechanism for the boolean toggles** (`use_breakeven`,
`use_trailing`, `use_partial`, `use_daily_limit`). `schema.py`'s spec
`risk` object only carries the *threshold* fields
(`be_trigger_atr`/`trail_start_atr`/`partial_atr`/etc., which
`runner.py`/`execution_mtf.py`/`execution_tick.py` read via
`risk_cfg.get(key, risk.<default>)` as a per-spec override of the
*value* if the corresponding feature is already on) — never the
booleans themselves. **A spec cannot disable breakeven/trailing/partial;
only the Python caller's `RiskConfig(...)` construction can.**

**Are defaults always applied?** Yes. Every `RiskConfig(...)` call site
found in this repository (7 in `quant-engine/`, plus the base engine's
own default) constructs it with only `risk_pct`, `spread_price`,
`contract_size`, `start_balance` supplied — never touching the boolean
toggles:

```
build_one_library.py:23    demo.py:88             demo_library.py:25
demo_variations.py:57      demo_parser_check.py:75 scripts/test_tick_engine.py:45
demo_template_builder.py:31 scripts/compare_engines.py:98
```

**Library generation:** `build_one_library.py`'s `RiskConfig(...)` call
is identical to every other call site — the entire 1,764-strategy
library was built with all three position-management features and the
daily circuit-breaker active by default.

**Standalone backtests:** same — every demo script and this sprint's own
`compare_engines.py`/`test_tick_engine.py` used the class defaults
unmodified.

**Do code generators receive the same configuration?** **No.**
`generate_mql5(spec)`, `generate_mql4(spec)`, `generate_pine(spec)` each
take only the `spec` dict — never a `RiskConfig` object. Even the
threshold fields that a template-built spec *does* carry
(`spec["risk"]["be_trigger_atr"]` etc.) are never read by any of the
three codegen functions (confirmed: none of `_handles_and_reads`,
`generate_mql5`, `generate_mql4`, `_indicator_lines`, `generate_pine`
reference those keys). **Generated code does not serialize the risk
configuration beyond the static SL/TP distance formula (§11/§12).**

| Risk Feature | Default | Python Backtester (all 3 engines) | MQL5 | MQL4 | Pine | Library Impact |
|---|---|---|---|---|---|---|
| Breakeven | ON | Active, unconditionally (no spec-level opt-out) | Not generated | Not generated | Not generated | All 1,764 rows generated with this active |
| ATR trailing | ON | Active, unconditionally | Not generated | Not generated | Not generated | All 1,764 rows generated with this active |
| Partial close (50%) | ON | Active, unconditionally | Not generated | Not generated | Not generated | All 1,764 rows generated with this active |
| Static SL | — | Active | Generated, matches | Generated, matches | Generated, matches | Consistent |
| Static TP | — | Active | Generated, matches | Generated, matches | Generated, matches | Consistent |
| Risk % | 1.0 | Active | `InpRiskPercent` input, matches formula | matches | `riskPercent` input, matches formula | Consistent |
| Max positions | 1 (hardcoded, not a `RiskConfig` field) | Enforced | Enforced (`HasOpenPosition`) | Enforced (`OrdersTotal` check) | Enforced (`position_size==0`) | Consistent — genuine parity |
| Stop-distance limits (broker min-stop/freeze level) | — | Not modeled | Not checked before send | Not checked before send | N/A (no broker concept in Pine) | Consistent absence, not a divergence |
| Daily loss circuit-breaker (3%) | ON | Active, unconditionally (all 3 spec engines) | Not generated | Not generated | Not generated | All 1,764 rows generated with this active |
| Session filter (7-19) | ON (base engine only) | **Ignored by all 3 spec engines** despite the field being ON by default | Not generated | Not generated | Not generated | No library impact (spec engine never applied it either) |

---

*Continued in the companion documents:
[`QUANT_LITE_EXECUTION_PARITY_MATRIX.md`](QUANT_LITE_EXECUTION_PARITY_MATRIX.md),
[`QUANT_LITE_EXECUTION_GAP_REPORT.md`](QUANT_LITE_EXECUTION_GAP_REPORT.md),
[`QUANT_LITE_EXECUTION_TEST_PLAN.md`](QUANT_LITE_EXECUTION_TEST_PLAN.md),
[`QUANT_LITE_EXECUTION_DECISION.md`](QUANT_LITE_EXECUTION_DECISION.md).*
