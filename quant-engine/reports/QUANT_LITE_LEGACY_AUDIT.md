# Q0.2 — AT24 Quant Lite Legacy Engine Audit

**Status:** Read-only audit. No code changes, no database writes, no M-Series
changes were made to produce this document. Every SQL query run against
`quant_engine/market.db` during this audit was a `SELECT` (several via
`mode=ro` URI connections); `strategy_library.db` was queried the same way.
No file under `ea-research/` was modified.

**Scope:** `quant-engine/` (idea-to-code spec engine, landed this session),
`quant_engine/` (the older, separate risk/data engine it depends on),
`quant-engine-handoff/` (the original handoff package), plus everything in
`ea-research/marketplace-research/` found to reference either.

---

## 1. Repository inventory

### `quant-engine/` (~3,290 LOC Python, landed this sprint's earlier work)

| Area | Files | Notes |
|---|---|---|
| Spec engine core | `spec_engine/schema.py` (80), `interpreter.py` (74), `indicators.py` (163) | Spec validation, condition evaluator, 10-indicator math library |
| Backtest engines | `spec_engine/runner.py` (147), `execution_mtf.py` (212), `execution_tick.py` (208) | **Three parallel, non-identical engines** — see §5 |
| Code generators | `spec_engine/codegen_mql5.py` (344), `codegen_mql4.py` (280), `codegen_pine.py` (170) | |
| Strategy generation | `spec_engine/template_builder.py` (215, Option A), `llm_parser.py` (168, Option C) | |
| Library (Option B) | `spec_engine/library_generator.py` (151), `library_search.py` (76), `robustness.py` (50), `strategy_library.db` (2.6MB, 1,764 rows) | |
| Data import | `scripts/import_exness.py` (300, written this sprint) | |
| Demo/entry scripts | `demo.py`, `demo_library.py`, `demo_library_v2.py`, `demo_parser_check.py`, `demo_template_builder.py`, `demo_variations.py`, `build_one_library.py` | No CLI framework — each is a standalone `if __name__` script |
| Verification scripts | `scripts/compare_engines.py`, `scripts/test_tick_engine.py` (written this sprint) | Manual, not a test suite — see §7 |
| Generated artifacts | `output/` — 10 `.mq5`, 10 `.mq4`, 10 `.pine`, 10 `.spec.json`, plus 5 compiled `.ex4`/`.ex5` binaries and assorted JSON reports | |
| Reports | `reports/session_report_idea_to_code.md`, `HANDOFF_SPRINT_idea_to_code.md`, `INTEGRATION_DECISION.md` | Prior-session narrative + this sprint's own integration decision |

### `quant_engine/` (~362 LOC Python — the sibling module `quant-engine/` depends on)

| File | LOC | Role |
|---|---|---|
| `engine.py` | 171 | `RiskConfig` dataclass + generic `run_backtest()`/`summarize()` — the **original**, non-spec backtest engine (built for a different, earlier strategy: `pullback_breakout`, referenced in comments but its source is not present in this repository) |
| `db.py` | 100 | SQLite schema owner for `market.db` (`symbols`, `candles`, `strategy_runs`, `trades`, `equity_curve`, `spread_stats`) |
| `data_import.py` | 91 | Original data loader (`import_xauusd`, `import_fx_pair`, `load_candles`) — imports from `data_raw/*.csv`, a directory **not present** in this repository (referenced but not shipped) |
| `market.db` | 2.0GB | Candle data across 8 symbols (2 pre-existing: `XAUUSD`, `EURUSD` from `data_raw`; 6 new this sprint: `*_EXNESS` from real Exness ticks). Gitignored — correctly excluded from version control. |

This module was **missing from the original handoff zip** — it was supplied separately mid-sprint after `demo.py` failed with `ModuleNotFoundError: engine`. Its own upstream source (`data_raw/` CSVs, the `pullback_breakout` strategy, `quant_engine/optimizer.py` referenced in `robustness.py`'s docstring) is not part of this repository at all. **`quant_engine/` is itself an artifact handed off from a separate, larger, unshipped project** — treat it as a vendored dependency, not a component this repo fully owns.

### `quant-engine-handoff/`

The original handoff package: `idea_to_code_handoff.zip` (the `quant-engine/` source), `quant_engine_min.zip` (the trimmed `quant_engine/` sibling), and `HANDOFF_SPRINT_idea_to_code.md`. Historical record only — already extracted and landed. No action needed.

### Import/dependency graph (textual)

```
demo*.py / build_one_library.py / scripts/*.py
        |
        v
quant-engine/spec_engine/{runner,execution_mtf,execution_tick}.py --imports--> quant_engine/engine.py (RiskConfig, summarize)
        |                                                                              ^
        v                                                                              |
    indicators.py, interpreter.py, schema.py                          quant_engine/data_import.py, db.py (market.db)
        |
        v
codegen_mql5.py / codegen_mql4.py / codegen_pine.py   (no runtime dependency on the above — pure spec-in, string-out)

spec_engine/library_generator.py --imports--> template_builder.py, robustness.py
spec_engine/library_search.py    --imports--> library_generator.py (for get_conn() only)
spec_engine/llm_parser.py        --imports--> schema.py, anthropic (lazy import, optional dep)
spec_engine/interpreter.py::SpecStrategy -- DEAD CODE, see §2 -- never instantiated by any caller in this repo
```

External dependencies actually used: `pandas`, `numpy`, `anthropic` (only for `llm_parser.py`, lazily imported). **No `requirements.txt`, `pyproject.toml`, or `setup.py` exists anywhere in either directory** — nothing pins versions or declares these as dependencies; they happen to already be installed in this machine's Python 3.11 environment.

---

## 2. Architecture reconstruction

```
Idea (plain text)
   |
   +-- Option A: template_builder.build_spec()   [deterministic, self-tested]
   +-- Option B: library_generator grid + robustness.spec_walk_forward()  [pre-computed, batch]
   +-- Option C: llm_parser.parse_idea_to_spec()  [Claude tool-use, never live-tested]
   |
   v
Spec (dict, validated by schema.validate_spec())
   |
   +--> Python backtest: THREE separate engines, not one (see §5)
   +--> codegen_mql5.generate_mql5()   -> .mq5 source
   +--> codegen_mql4.generate_mql4()   -> .mq4 source
   +--> codegen_pine.generate_pine()   -> .pine source
```

- **Spec → parser → strategy representation:** the Spec dict *is* the strategy representation — there is no separate intermediate object. `interpreter.py` defines a `SpecStrategy` class implementing the interface `quant_engine/engine.py`'s generic `run_backtest()` expects, but **it is dead code**: `SpecStrategy.next_signal()` raises `NotImplementedError` unconditionally, and its own docstring says so explicitly ("callers should use `spec_engine.runner.run_spec_backtest` ... rather than `quant_engine.engine.run_backtest` directly"). Nothing in this repository instantiates `SpecStrategy`. It was scaffolding for an integration path that was abandoned in favor of `runner.py`'s own reimplemented loop.
- **Strategy generation:** three independent code paths (A/B/C) that all converge on the same `validate_spec()` gate. Option A is proven (self-test at import). Option B is proven to *run* but its stored results are stale (§3). Option C has never been executed against a live model.
- **Indicator layer:** `indicators.py` — 10 types (EMA, SMA, RSI, ATR, MACD, BB, STOCH, ADX, DONCHIAN, SUPERTREND), all implemented, all mirrored across the 3 codegens (confirmed by direct comparison — every type string appears in all three files). Formulas checked for look-ahead: none use negative shift or centered windows; DONCHIAN explicitly shifts by 1 to exclude the current bar; SUPERTREND is a forward-only iterative recurrence. **No look-ahead found in the indicator math itself.**
- **Backtest/execution layer:** see §5 — this is the audit's central finding.
- **Risk layer:** `quant_engine/engine.py::RiskConfig` — one shared dataclass consumed by all three spec engines *and* the original `run_backtest()`. Defaults: `use_breakeven=True`, `use_trailing=True`, `use_partial=True`, `use_daily_limit=True`, session filter 7–19. **Every RiskConfig instantiation found in this repository (8 call sites, including the one that built the 1,764-strategy library) uses these defaults unmodified** — nothing in `quant-engine/` ever turns them off or overrides them explicitly.
- **Optimization:** `robustness.py::spec_walk_forward()` — walk-forward *evaluation* (fixed params across N chronological folds), not optimization. No parameter-search/optimizer exists in `quant-engine/`; `quant_engine/optimizer.py` is referenced in a docstring but is not present in this repository.
- **Reporting:** `quant_engine/engine.py::summarize()` is the single source of all backtest statistics (`trades_total`, `win_rate_pct`, `profit_factor`, `total_return_pct`, `max_drawdown_pct`, `final_balance`, `trade_cycles`). No separate reporting/formatting layer exists — callers print the dict directly or dump it to JSON.
- **Code generation:** see §5/§6 — feature-incomplete relative to the backtest engines that produce the metrics displayed alongside the generated code.
- **Validation/testing:** none exists as an automated suite — see §7.

---

## 3. 1,764-strategy library audit

Queried `strategy_library.db` directly (read-only):

- **Total rows:** 1,764 — exactly 588 × 3, confirmed against the grid math in `library_generator.py` (28 trigger-param combos × 7 filter-param combos × 3 risk presets = 588).
- **Symbol/timeframe families:** `XAUUSD` 1h (588), `XAUUSD` 4h (588), `EURUSD` 1h (588) — matches the session report's claim exactly.
- **Spec format:** every row's `spec_json` is a full, schema-valid Spec (built via `template_builder.build_spec()`, which self-validates before returning).
- **Generated code:** the library stores **specs only** — no MQL5/MQL4/Pine source is stored per library row. Only ~10 example specs (a small hand-picked subset, not the library) have generated code sitting in `output/`.
- **Duplicate/variant strategies:** **zero** duplicate `(name, symbol, timeframe)` rows — clean.
- **Stale metrics — critical finding:** every one of the 1,764 rows was computed by `runner.py` (the original, single-timeframe engine) against the **pre-Exness data source** (`XAUUSD` from `data_raw` 5m CSVs, Aug 2020–Aug 2025; `EURUSD` from `data_raw` m15 CSVs, 2012–Mar 2022) — **before** this sprint's account-blown fix and **before** the real Exness tick data existed. This confirms and sharpens the checkpoint note already on record: these numbers are not just "a different data source," they were also generated by an engine with a since-fixed correctness bug (§5's account-blown issue) that could silently understate losses on any row that would have gone deeply negative. **None of the 1,764 stored metrics should be treated as current or trustworthy without a full rebuild.**
- **Missing provenance/version/hash:** the `library` table schema has no `engine_version`, `data_source`, `generated_at`, or `spec_hash` column. There is no way to tell, from the database alone, which engine version or data vintage produced any given row — this audit is the only reason that's currently known at all.
- **Which components are actually executable:** `build_library()` is a live, correct function (traced end-to-end) — it is not broken, just **stale**. Re-running it now (not done — out of scope for this audit) would overwrite the table with `runner.py`'s current (fixed) behavior, still against the original `data_raw` source unless also re-pointed at `XAUUSD_EXNESS`/`EURUSD_EXNESS`.

---

## 4. `market.db` dependency audit

**Writers found (2, both outside the M-Series):**
1. `quant_engine/data_import.py` (`import_xauusd`, `import_fx_pair`) — original, pre-sprint, populated the `XAUUSD`/`EURUSD` rows from `data_raw/` CSVs not present in this repo.
2. `quant-engine/scripts/import_exness.py` — this sprint's own importer, populated the 6 `*_EXNESS` symbols plus the additive `candle_spread` table.

**No other writer exists.** `trades`, `equity_curve`, and `strategy_runs` tables are all empty (0 rows) — nothing has ever written backtest results back into `market.db` itself; every script that runs a backtest keeps its results in memory/JSON only.

**Readers found, including the M-Series (this is the important part):**

| File | Reads | Access mode |
|---|---|---|
| `quant_engine/data_import.py::load_candles()` | `candles` table | plain `sqlite3.connect()`, read+write connection but only issues `SELECT` in this function |
| `ea-research/marketplace-research/m4-validation-engine/regime_classifier.py` | `candles WHERE symbol='XAUUSD_EXNESS' AND timeframe='15m'` | `sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)` — **read-only connection** |
| `ea-research/marketplace-research/m4-validation-engine/tag_trades_with_regime.py` | same, via `regime_classifier.load_candles()` | read-only |
| `ea-research/marketplace-research/m4-validation-engine/reconstruct_equity_curve.py` | `candles(ts, close)` for `XAUUSD_EXNESS` | `mode=ro` |
| `ea-research/marketplace-research/m4-validation-engine/pdhpdl_strategy_backtest.py` | `candles(ts,open,high,low,close)` | `mode=ro` |
| `ea-research/marketplace-research/m12-gold-product-01/generate_pdhpdl_extended_evidence_chain_full_real.py` | indirectly, via the M4 modules above | read-only |
| `ea-research/marketplace-research/m12-gold-product-01/generate_pdhpdl_extended_evidence_chain_regime_tagged.py` | indirectly, via `tag_trades_with_regime.py` | read-only |

**This is a real, live, load-bearing dependency, not a hypothetical one.** The M4/M12 files above were modified as recently as **2026-08-24 14:19–14:20** (same day as this audit) — an active, separate work-stream is currently using `quant_engine/market.db`'s `XAUUSD_EXNESS` candles for the PDH/PDL Gold product's regime classification, equity-curve reconstruction, and parameter-sensitivity backtesting. This directly supersedes part of `INTEGRATION_DECISION.md`'s framing: while the *strategy/spec layer* of `quant-engine/` genuinely has no automatic path into the M-Series (confirmed — no M-Series file imports `spec_engine` or reads `strategy_library.db`), the **raw market-data layer** (`market.db`'s candles) already is a shared, real dependency between the two projects.

**Read-only vs. write paths:** confirmed 100% read-only from the M-Series side — every M4/M12 file found uses `mode=ro` URI connections issuing only `SELECT`. No write path from M-Series into `market.db` exists.

**Zero modification made to the DB during this audit:** confirmed — `market.db`'s table list, row counts, and symbol contents were checked before and treated as read-only throughout; no `INSERT`/`UPDATE`/`DELETE`/schema-altering statement was executed by this audit.

---

## 5. Execution/backtest correctness audit

### 5.1 Three non-identical backtest engines exist for the same Spec format

| | `runner.py` (original) | `execution_mtf.py` (this sprint) | `execution_tick.py` (this sprint) |
|---|---|---|---|
| Signal resolution | spec's own timeframe (e.g. 1h) | spec's own timeframe | spec's own timeframe |
| Fill/SL/TP resolution granularity | **same coarse bar as the signal** | 1-minute real bars | real ticks (no aggregation) |
| Spread | static `risk.spread_price` (a caller-supplied constant, e.g. 0.30 used in every script this sprint) | real per-minute average spread from `candle_spread` | real bid/ask at the exact tick |
| Same-bar SL+TP ambiguity | resolved as SL-first (documented, consistent with the base `engine.py`) | resolved chronologically via 1m bars; same-minute ties still resolved SL-first (counted via `same_minute_sl_tp_conflicts`) | resolved chronologically per real tick; same-tick ties resolved SL-first (counted via `same_tick_sl_tp_conflicts`) |
| Account-blown guard | **fixed this sprint** | **fixed this sprint** | **fixed this sprint**, but only directly re-verified against a case that never triggered it (§ note below) |
| Used by | `demo.py`, `library_generator.py` (the entire 1,764-strategy library) | ad-hoc via `compare_engines.py` | ad-hoc via `test_tick_engine.py` |

These are not three views of one engine — they are three separately-implemented backtest loops that happen to share the same entry/exit condition evaluator (`interpreter.evaluate_entry`). On the one real comparison run made this sprint (MACD Crossover, XAUUSD real data), they produced materially different verdicts: PF 0.95 (runner.py, full 2024–2026) → PF 2.05 (execution_mtf.py, same window) → PF 2.44 (execution_tick.py, 2024 only, not a matching window). **These are not yet cross-validated against each other on identical windows** — the tick-engine test used a different date range than the MTF comparison, so the PF 2.05 vs. 2.44 difference conflates "engine granularity" with "different time period" and should not be read as a clean apples-to-apples result.

### 5.2 Critical finding: generated code does not implement the risk management the backtest evidence assumes

`quant_engine/engine.py::RiskConfig` defaults **all** of breakeven-stop, ATR trailing-stop, and 50%-partial-close **to `True`**, plus a 3%-of-day-balance daily loss circuit-breaker and a 7–19 session-hour filter. Every `RiskConfig(...)` call site found in this repository (8 of them, including `build_one_library.py`, which produced the entire 1,764-row library) leaves these defaults unmodified.

None of `codegen_mql5.py`, `codegen_mql4.py`, or `codegen_pine.py` implement breakeven, trailing, or partial-close logic anywhere (confirmed by direct grep across all three files — zero matches for `breakeven`/`trail`/`partial`). The generated EAs/script open a position with a **static** SL/TP and hold it unmanaged until one level is hit. None of them implement the daily loss circuit-breaker either.

**This means every backtest number this system has ever produced — the entire 1,764-strategy library, every demo run, and every number reported to you this sprint (MACD PF 2.44, Bollinger PF 0.19, etc.) — reflects active position management that the corresponding generated `.mq5`/`.mq4`/`.pine` file does not and cannot reproduce live.** This is a materially larger gap than the spread/granularity issues already found and fixed: those affect the *size* of the reported numbers; this affects whether the reported numbers describe the same trading behavior as the deliverable code at all. Every `.mq4`/`.mq5`/`.pine` file that exists today, and everything the 1,764-strategy library claims, needs to be read with this in mind.

A second, smaller instance of the same class of gap: the session-hour filter (`session_start`/`session_end`, defaulting to 7–19) is honored by `quant_engine/engine.py::run_backtest()` (the base, non-spec engine) but is **not implemented anywhere in `runner.py`, `execution_mtf.py`, or `execution_tick.py`** (confirmed by grep — zero matches for `session_start`/`in_session` in any spec-engine file). So even within the Python-only world, the base engine and the spec engines silently disagree about whether this RiskConfig field does anything.

### 5.3 Other correctness points

- **Slippage:** not modeled anywhere.
- **Commissions:** `execution_mtf.py`/`execution_tick.py` added a `commission_per_lot` hook this sprint via `getattr(risk, "commission_per_lot", 0.0)`, but `RiskConfig` itself has no such field, so it silently evaluates to `0.0` in every real run — an unused, dead hook. `runner.py` and the base `engine.py` have no commission hook at all.
- **Position sizing:** consistent formula (`risk_money / (sl_dist × contract_size)`, floored at 0.01 lot) across `engine.py`/`runner.py`/`execution_mtf.py`/`execution_tick.py`. No max-lot cap or lot-step rounding in the Python engines — but `codegen_mql5.py`'s `CalcLots()` *does* apply `SYMBOL_VOLUME_STEP`/`SYMBOL_VOLUME_MIN` via real broker `SymbolInfo` calls, making the generated EA's sizing **more** realistic than the Python backtest on this one specific point (a rare case where codegen is ahead of the backtest, not behind it).
- **Determinism:** fully deterministic given fixed spec + data + RiskConfig — no randomness anywhere in any backtest path. No Monte Carlo/perturbation testing exists in `quant-engine/` at all (the M1 marketplace schema reserves a `monteCarloSummary` field for this in the *other*, M-Series `RiskAnalysis` model — unrelated to this codebase).
- **Account-blow handling:** fixed this sprint in `runner.py`, `execution_mtf.py`, `execution_tick.py` (verified: `demo.py`'s reference numbers unchanged after the fix; Bollinger Mean Reversion's drawdown correctly caps at −100.01% instead of the previous impossible −141.36%). **`quant_engine/engine.py::run_backtest()` — the base engine — still has the identical unfixed bug** (same `risk_money = balance × risk_pct%` pattern with no `balance <= 0` guard). This audit does not fix it (no code changes this sprint), but it's a real, present vulnerability in a file three other components depend on.

---

## 6. Strategy-generation audit

- **Spec validation (`schema.py::validate_spec`):** catches unknown indicator types, unknown ops, and a risk config that claims `ATR` mode without a valid `atr_id` reference. Does **not** validate numeric ranges — a spec with `period=0`, a negative `mult`, or `sl_atr_mult=0` passes validation and only misbehaves downstream (division by zero in some indicator formulas, or a zero-width stop that `runner.py` explicitly guards with `if sl_dist > 0` — so the practical failure mode is "silently never opens a trade," not a crash).
- **Parser behavior:**
  - **Option A (`template_builder.py`):** deterministic, self-tested at import (`_self_test()` builds every trigger×filter combo), reliable.
  - **Option C (`llm_parser.py`):** has never been executed against a live model in this repository (no `ANTHROPIC_API_KEY` available in this environment). Two staleness issues found on inspection: (1) `DEFAULT_MODEL = "claude-sonnet-4-5-20250929"` — not a current model ID; (2) the system prompt explicitly tells the model "Only use indicator types EMA/SMA/RSI/ATR/MACD/BB — nothing else exists yet," which is now **false** — `schema.py`/`indicators.py` support 10 types (STOCH/ADX/DONCHIAN/SUPERTREND were added after this prompt was written, per the "nothing else exists yet" phrasing) and all three codegens implement them. The LLM parser is currently artificially restricted to 6 of 10 supported indicators.
- **Code generation:** feature-complete for entry-condition translation and all 10 indicator types (verified all three codegens implement all 10); feature-**incomplete** for position management (§5.2).
- **Supported indicators/operators:** 10 indicators, 7 condition operators (`>`, `<`, `>=`, `<=`, `==`, `cross_above`, `cross_below`). Conditions within `entry_long`/`entry_short` are AND-only — no OR logic, no multi-timeframe conditions, no volume or candlestick-pattern support.
- **Unsupported combinations:** nothing prevents a spec with empty `entry_long` and `entry_short` (a spec that structurally can never trade) — this isn't a crash, it's the exact, already-observed "RSI+EMA, 0 trades" case from `demo.py`'s own reference run. Not a bug, but worth noting as a silent-no-op class rather than a validation error.
- **Generated-code safety:** spec names flow into generated MQL5/Pine string literals (EA comment, Pine `strategy()` title) via a simple `.replace(" ", "")` or quote-substitution — no escaping of backslashes or embedded quotes. Not exploitable today (`template_builder.py`'s names are fully controlled, code-generated strings), but would become a real generated-code-corruption risk the moment a user-facing UI or the (currently untested) LLM parser lets free-text idea names flow straight into a spec's `name` field without sanitization.

---

## 7. Test audit

**No automated test suite exists** — no `pytest`/`unittest` file anywhere in `quant-engine/` or `quant_engine/`.

What exists instead:
- `template_builder.py::_self_test()` — runs at import time, builds every trigger×filter combination and asserts it passes `validate_spec()`. Proves the wizard's *spec construction* is always schema-valid. Proves nothing about backtest correctness.
- `demo.py`'s own historical comparison against `output/demo_summary.json` — a manual, human-read comparison, not an assertion-based regression test. This sprint's re-run of it (confirming exact reproduction after the account-blown fix) was done by eye, not by an automated diff.
- `scripts/compare_engines.py` and `scripts/test_tick_engine.py` (written this sprint) — ad-hoc verification scripts with no assertions; they print numbers for human review and exit 0 regardless of what those numbers are.

**Missing coverage — the most important gap:** nothing in this repository checks any indicator formula (RSI, MACD, ATR, ADX, Supertrend, etc.) against an independent reference implementation (e.g. TA-Lib, or a hand-worked example). Every verification done so far — in this audit and in the original session report's "8 bugs found" — has been **cross-engine self-consistency**: does the Python formula match what the MQL5/Pine code computes? That catches *drift between the three languages*, but a formula that is consistently wrong in all three languages (an actual math error, not a translation error) would pass every check that currently exists. This is a distinct risk category from anything fixed so far.

**Known failures:** none currently open (the account-blown bug found and fixed this sprint is the only known-failure-class issue, and it's resolved in 3 of 4 sibling engines — see §5.3 for the fourth).

**False-confidence risk:** the biggest one is exactly §5.2 — a casual reader of `demo.py`'s output or the 1,764-strategy library sees numbers that look like evidence of a working, profitable trading system, with no signal anywhere in the output that those numbers assume position-management behavior the paired `.mq5`/`.mq4`/`.pine` file doesn't implement.

---

## 8. Dependency classification

| Component | Classification | Reasoning |
|---|---|---|
| `spec_engine/schema.py` | **KEEP** | Solid validation gate, used correctly everywhere, minor range-check gap is a `FIX` not a redesign |
| `spec_engine/indicators.py` | **KEEP** | All 10 formulas correct-by-construction, no look-ahead found, mirrored consistently across codegens |
| `spec_engine/interpreter.py::evaluate_entry` | **KEEP** | Correct, minimal, used consistently by all 3 engines |
| `spec_engine/interpreter.py::SpecStrategy` | **RETIRE** | Dead code — `next_signal()` unconditionally raises `NotImplementedError`; nothing instantiates it |
| `spec_engine/template_builder.py` (Option A) | **KEEP / FUTURE QUANT LITE** | Deterministic, self-tested, zero external dependency — the strongest candidate for a free-tier product surface |
| `spec_engine/llm_parser.py` (Option C) | **FIX** | Never live-tested; stale model ID; prompt restricted to 6/10 supported indicators; needs a real test pass with a real API key before any trust is placed in it |
| `spec_engine/library_generator.py` + `strategy_library.db` (Option B) | **REFACTOR** | Mechanism is sound; stored data is stale (§3) and needs provenance columns (`engine_version`, `data_source`, `generated_at`) before it can be trusted again |
| `spec_engine/library_search.py` | **KEEP** | Correct, safe (order-by is constrained to a fixed column whitelist despite the f-string appearance), just depends on a stale table |
| `spec_engine/robustness.py` | **KEEP / FUTURE QUANT LITE** | Real, working walk-forward evaluation; worth its own promotion into the M-Series `WALK_FORWARD` validation layer per `INTEGRATION_DECISION.md` |
| `spec_engine/variation_suggester.py` | **KEEP** | Honest-by-construction (reports "no improvement" truthfully), no correctness issues found |
| `spec_engine/runner.py` | **FIX, then RETIRE in favor of one canonical engine** | Correctness-fixed this sprint, but its coarse same-bar SL/TP resolution and static spread are strictly worse than `execution_mtf.py`; keeping three parallel engines long-term is a maintenance and drift risk |
| `spec_engine/execution_mtf.py` | **KEEP — candidate for the canonical engine** | Best cost/accuracy tradeoff (real spread, 1m resolution) of the three; needs the session-filter gap addressed and cross-validation against `execution_tick.py` on matching windows before being trusted as "the" engine |
| `spec_engine/execution_tick.py` | **RESEARCH-ONLY for now** | Correct in design, real tick-level fidelity, but slow (~15–20 min per symbol-year per spec) and only spot-tested — not viable as the default engine for a library-scale (1,764+) rebuild without a major performance pass |
| `spec_engine/codegen_mql5.py` / `codegen_mql4.py` / `codegen_pine.py` | **FIX — do not ship as-is** | Feature-incomplete relative to the backtest evidence they're paired with (§5.2); this is the single highest-priority fix before any Quant Lite product surface reuses these generators |
| `scripts/import_exness.py` | **KEEP / DO NOT TOUCH casually** | Correct, tested at scale (2.0GB imported, verified against a real duplicate-timestamp edge case), now a **shared dependency of the M-Series** (§4) — any future change here needs to consider M4/M12 impact, not just `quant-engine/`'s own use |
| `quant_engine/engine.py` (`RiskConfig`, `run_backtest`, `summarize`) | **DO NOT TOUCH** this sprint / **FIX** flagged for a future sprint | Vendored dependency from an unshipped project; `run_backtest()` has the same unfixed account-blown bug as the pre-fix spec engines; not touched per this sprint's explicit "no code changes" rule, but should not be assumed safe |
| `quant_engine/data_import.py`, `db.py` | **DO NOT TOUCH** | Same vendored-dependency status; `db.py`'s schema is now load-bearing for the M-Series too |
| `quant_engine/market.db` | **DO NOT TOUCH outside a coordinated change** | Shared, live dependency of M4/M12 as of this audit — any schema or data change here needs to account for that, not just `quant-engine/`'s own needs |
| Demo scripts (`demo*.py`, `build_one_library.py`) | **RETIRE / REPLACE** | Useful as historical proof-of-concept, but not a real entry point for any product — a Quant Lite product needs real API/CLI surfaces, not one-off scripts |
| `scripts/compare_engines.py`, `scripts/test_tick_engine.py` | **REFACTOR into a real test suite** | The intent (cross-engine validation) is exactly right; the implementation (manual scripts, no assertions) is not durable |

---

## 9. M-Series boundary audit

Already detailed in §4. Summary:

- **No dependency exists between `quant-engine/`'s strategy/spec layer (schema, template_builder, codegen, the 1,764-strategy library) and the M-Series.** Confirmed by grep: no file under `ea-research/` imports `spec_engine`, reads `strategy_library.db`, or references `quant-engine` (hyphen) at all.
- **A real, live, read-only dependency exists between `quant_engine/market.db`'s candle data and the M-Series** (`m4-validation-engine`'s `regime_classifier.py`, `tag_trades_with_regime.py`, `reconstruct_equity_curve.py`, `pdhpdl_strategy_backtest.py`, and `m12-gold-product-01`'s two `generate_pdhpdl_extended_evidence_chain_*` scripts), specifically on the `XAUUSD_EXNESS` symbol this sprint imported. This dependency is confirmed 100% read-only (`mode=ro` connections, `SELECT`-only) — no write path from M-Series into `market.db` exists, and no M-Series file, table, or record was modified by this audit.
- **This changes the practical stakes of "DO NOT TOUCH" for `market.db` and `scripts/import_exness.py`:** they are no longer purely `quant-engine/`'s own sandbox. A future re-import, schema change, or symbol-key rename there needs to check M4/M12 impact first.
- No M-Series engine (`m2-evidence-engine/`, `m4-validation-engine/`, etc.) was modified, and no M-Series data (Evidence, Validation, Trust Status, or the `pdhpdl_gold_extended_evidence_chain_result.json` artifact) was touched, read for write purposes, or altered by this audit.

---

## 10. Product extraction

Deferred to the companion document, [`QUANT_LITE_PRODUCT_BLUEPRINT.md`](QUANT_LITE_PRODUCT_BLUEPRINT.md), which defines the actual free-product boundary using the classifications above.

---

## Appendix: checkpoint findings re-confirmed

- **MACD Crossover: 391 trades, PF 2.44, +97.0%, Max DD −3.68%** and **Bollinger Mean Reversion: 415 trades, PF 0.19, −91.69%** are correctly classified as *engine-generated backtest evidence, not validated strategy performance* — this audit adds a specific, concrete reason beyond "different execution assumptions": **both numbers were generated with active breakeven/trailing/partial-close management that no generated `.mq4`/`.mq5`/`.pine` file for either spec implements** (§5.2). Even setting aside engine-granularity differences, these numbers do not describe what the paired generated code would do live.
- The legacy strategy library's historical metrics are confirmed not authoritative, for two independent reasons: a since-fixed correctness bug in the engine that produced them, and a data-source change (§3) — either alone would be sufficient to require a rebuild before trusting them again.
