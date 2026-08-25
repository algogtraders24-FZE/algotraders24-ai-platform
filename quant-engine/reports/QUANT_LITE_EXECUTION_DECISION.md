# Q0.3 — Quant Lite Execution Decision

Decisions only. Built on
[`QUANT_LITE_EXECUTION_CONTRACT.md`](QUANT_LITE_EXECUTION_CONTRACT.md),
[`QUANT_LITE_EXECUTION_PARITY_MATRIX.md`](QUANT_LITE_EXECUTION_PARITY_MATRIX.md),
[`QUANT_LITE_EXECUTION_GAP_REPORT.md`](QUANT_LITE_EXECUTION_GAP_REPORT.md),
and [`QUANT_LITE_EXECUTION_TEST_PLAN.md`](QUANT_LITE_EXECUTION_TEST_PLAN.md).
No code was changed to produce this document. Decision key: **A. KEEP
CURRENT BEHAVIOR** / **B. FIX BACKTESTER** / **C. FIX CODE GENERATORS** /
**D. REMOVE/DEACTIVATE LEGACY DEFAULT** / **E. MARK FEATURE UNSUPPORTED**
/ **F. RESEARCH-ONLY** / **G. DEFER**.

---

## Gap-by-gap decisions

### GAP-01/02/03 — Breakeven / trailing / partial-close not in codegen

**Decision: D, with C as the follow-up, in that order.**

Reasoning: the fastest way to make the system technically honest is to
stop reporting numbers the generated code can't reproduce — that's a
config change (`use_breakeven=False`, `use_trailing=False`,
`use_partial=False` as the default for anything feeding a Quant Lite
surface), not a redesign, and it can happen without touching either
codegen or the backtest math itself. **This is a default change, not a
capability removal** — the feature stays in the engine for users/modes
that don't need code-generation parity (e.g. a pure research/backtesting
workflow that never exports an EA). Implementing breakeven/trailing/
partial in all three code generators (Decision C) is the *better*
long-term outcome — it's real functionality worth having — but it's
strictly larger, slower, and higher-risk (three separate MQL5/MQL4/Pine
implementations to get right, each needing the same kind of
cross-language parity verification that caught 8 real bugs in the
original session) than turning a default off. D unblocks Quant Lite
honesty immediately; C is the correct target state to schedule
afterward, once time allows building and testing it properly rather than
rushing it under a launch deadline. **Do not do C before D** — that
would risk shipping a still-unverified three-way position-management
implementation under time pressure, which is exactly the failure mode
this audit exists to prevent.

**Priority: CRITICAL, blocking.**

### GAP-04 — `runner.py`'s static spread assumption

**Decision: D — `runner.py` does not become the canonical engine;
`execution_mtf.py` does.**

Reasoning: this isn't a bug to patch in `runner.py`, it's a reason
`runner.py` shouldn't be the engine Quant Lite is built on at all.
`execution_mtf.py` already solves this correctly (real per-minute
spread from `market.db`). The fix is an engine-selection decision
(already flagged in `QUANT_LITE_LEGACY_AUDIT.md` §8), not new code.

**Priority: HIGH, blocking on the canonical-engine decision (§ below).**

### GAP-05 — No slippage model

**Decision: E — mark unsupported for Quant Lite v1.**

Reasoning: real cost, but smaller and less certain than GAP-01–04, and
building a defensible slippage model (what magnitude, static or
volatility-scaled, sourced from what evidence) is itself a research
task, not a quick fix. Documenting "Quant Lite does not model slippage"
next to every result is honest and sufficient for v1; modeling it
properly is a Quant Pro-tier differentiator per
`QUANT_LITE_PRODUCT_BLUEPRINT.md` §6.

**Priority: LOW, non-blocking.**

### GAP-06 — Three Python engines not cross-validated on identical windows

**Decision: G — defer to a dedicated test-execution sprint, not this
audit.**

Reasoning: Q0.3 was explicitly scoped as reconciliation/audit, not a
license to rerun large comparisons (per the sprint brief's own
instruction not to rerun large optimization searches). This is
correctly a **test to build** (TEST plan items, especially TEST 5 and a
proper cross-engine-same-window comparison), not a finding to resolve
by more ad-hoc runs in this sprint.

**Priority: MEDIUM, blocking on the canonical-engine decision, not
blocking Quant Lite's honesty work (GAP-01–03).**

### GAP-07 — Session filter silently ignored by the spec-engine pipeline

**Decision: E — mark unsupported, and say so explicitly, rather than B
(fix backtester to honor it).**

Reasoning: the `RiskConfig` object *has* a `session_start`/`session_end`
field that implies session filtering is active, but the entire
spec-engine pipeline ignores it. The honest fix here is not necessarily
"implement it" — it's "stop implying it's active." Concretely: either
document plainly that the spec engine doesn't support session
restriction (cheapest, immediate), or actually wire it in later as a
real feature (larger). For Quant Lite v1, E is sufficient — this is a
much smaller, less financially material gap than GAP-01–03, and doesn't
warrant the same urgency.

**Priority: MEDIUM, non-blocking for Quant Lite v1, but the
silently-ignored-config aspect specifically should be documented before
launch regardless of which fix path is eventually chosen.**

### GAP-08 — Dead commission hook

**Decision: A — keep as-is, for now, with a comment fix.**

Reasoning: purely cosmetic/documentation risk (a reviewer could
mistakenly believe commission is modeled), not a behavioral one — it
evaluates to 0.0 today and always has. Not worth a `RiskConfig` schema
change for a feature nobody has asked to actually use yet. If/when a
real commission model is built (natural Quant Pro candidate, sourced
per-broker), this hook becomes real; until then, a one-line comment
clarifying it's currently inert is sufficient — not a priority for this
sprint (no code was changed here, per Q0.3's scope).

**Priority: INFORMATIONAL, non-blocking.**

### GAP-09 — No broker minimum-stop-distance validation

**Decision: F — research-only.**

Reasoning: only matters for tight ATR-multiplier configs on specific
symbol/broker combinations, unmeasured impact, and it's a shared gap
(not a Python-vs-codegen divergence) so it doesn't compromise the
honesty of any reported number the way GAP-01–04 do. Worth a defensive
`SYMBOL_TRADE_STOPS_LEVEL` check in codegen eventually, but only after
real usage surfaces it as an actual problem, not preemptively.

**Priority: LOW, non-blocking.**

---

## Canonical engine decision

**Decision: `execution_mtf.py` is the stabilization target; `runner.py`
is retired from that role (kept only for historical/reference
reproduction of `demo.py`'s original numbers); `execution_tick.py` stays
research-only.**

Reasoning: `execution_mtf.py` is the only one of the three that gets
spread right (real, per-minute) at a computational cost that's actually
viable for library-scale rebuilds (`execution_tick.py`'s ~15–20 minutes
per symbol-year per spec, observed directly this sprint, is not viable
for anything beyond spot-checking a small number of specs).
`runner.py`'s coarse same-bar SL/TP resolution and hardcoded 0.30 spread
are both strictly worse approximations of the same thing
`execution_mtf.py` already does better. This decision is **not yet
proven** by a matching-window comparison (GAP-06) — it's the reasoned
choice given what's known, to be confirmed, not overturned, once that
test exists.

---

## Strategy library impact

Per the sprint's explicit instruction: **the 1,764-strategy library was
not regenerated and its stored metrics were not altered.** Findings only:

1. **Did all library strategies use `RiskConfig` defaults?** Yes —
   `build_one_library.py`'s single `RiskConfig(...)` call site (line 23)
   is identical in pattern to every other call site in the repository:
   only `risk_pct`/`spread_price`/`contract_size`/`start_balance` are
   supplied, leaving `use_breakeven`/`use_trailing`/`use_partial`/
   `use_daily_limit` at their class defaults.
2. **Were those defaults enabled during historical generation?** Yes —
   the class defaults are `True` for all three position-management
   toggles and have been since `quant_engine/engine.py` was written
   (there is no evidence, in this repository, of them ever having been
   `False`).
3. **Which metrics are therefore potentially affected?** All 1,764 rows'
   `trades_total`, `win_rate_pct`, `profit_factor`, `total_return_pct`,
   `max_drawdown_pct`, `final_balance`, and every `wf_*` walk-forward
   column — every one of those numbers reflects active breakeven/
   trailing/partial-close management that no corresponding generated
   `.mq4`/`.mq5`/`.pine` file implements (none were ever generated for
   the library rows in the first place — see
   `QUANT_LITE_LEGACY_AUDIT.md` §3 — but *if* they were, per §GAP-01–03,
   they would not reproduce these numbers).
4. **Recommended labeling: yes, `LEGACY-BACKTEST-EVIDENCE`, not
   `VALIDATED-PERFORMANCE`.** This matches the M-Series' own vocabulary
   discipline (`M0.1_product_model_freeze.md` principle 1 — no metric is
   evidence until independently validated) and is a strictly more
   conservative, more honest label for exactly the same underlying data.
   **No deletion, no rewrite** — the existing 1,764 rows stay exactly as
   they are; only a labeling/documentation change is recommended, and
   even that is a future-sprint action item, not something this
   audit-only sprint performs.
5. **Recommended future migration:** a full rebuild against
   `execution_mtf.py` (once confirmed canonical per the decision above)
   and real Exness data (`XAUUSD_EXNESS`/`EURUSD_EXNESS`, which the
   original library's symbols predate), with `engine_version`,
   `data_source`, and `generated_at` columns added to the schema so this
   exact ambiguity can't recur silently next time. Not scoped or
   scheduled here — a recommendation only, per the sprint brief.

---

## MACD / Bollinger check

**Reframed question, as instructed: does their reported backtest
behavior depend on risk features the generated implementation does not
reproduce? Not "are they profitable."**

**Answer: yes, for both, unambiguously.** Every `RiskConfig(...)` call
site used to produce these two results (`compare_engines.py`,
`test_tick_engine.py`) used the unmodified class defaults —
`use_breakeven=True`, `use_trailing=True`, `use_partial=True`. Concrete,
directly observed evidence that the mechanisms actually fired (not just
theoretically active):

- **MACD Crossover (391 trades, PF 2.44, +97.0%, Max DD −3.68%,
  2024, tick engine):** contains real `reason="PARTIAL"` trade rows
  (e.g. the `2024-01-05 08:00:00` entry closing in two steps, 0.07 lot
  then 0.08 lot, both profitable) — direct proof that partial-close
  fired and contributed to this result. Breakeven/trailing contribution
  specifically was not isolated (no dedicated test — see TEST 5/6 in the
  test plan), but both were active for the entire run and cannot be
  ruled out as contributors.
- **Bollinger Mean Reversion (415 trades, PF 0.19, −91.69%, 2024,
  tick engine):** the same defaults were active. Its `account_blown`
  event (real, observed, `final_balance=$831.08`) is itself partly a
  function of position-management behavior interacting with a losing
  streak — a strategy without active partial-close realizing profit
  early might have drawn down differently. Not isolated either way.

**Conclusion for both: these numbers are correctly classified as
engine-generated backtest evidence, not validated strategy performance
— confirmed, not just asserted — and specifically, neither number can
currently be claimed as "what the generated MQL5/MQL4/Pine file would
produce."** They remain valid historical evidence of *what this specific
engine configuration did on this specific data*, exactly as the sprint
brief already stated, and are not deleted or rewritten here.

---

## Codegen audit — previously identified cross-language bugs

Re-inspected `codegen_mql5.py`, `codegen_mql4.py`, `codegen_pine.py`,
`template_builder.py`, and the relevant risk-preset/`RiskConfig` code
this sprint. All 8 bugs from the original session report remain fixed,
confirmed by direct source inspection (not re-derived, cross-checked
against what Q0.2 already verified):

| # | Original bug | Still fixed? | Evidence |
|---|---|---|---|
| 1 | Missing shift(2) prev-bar variables in MQL5/MQL4 | Yes | `codegen_mql5.py` generates `closeC_prev`/etc. at `OnTick()` bar level; per-indicator `read_prev` blocks present for every type |
| 2 | Stochastic slowing=3 vs 1 mismatch | Yes | `codegen_mql5.py:80` (`iStochastic(...,1,MODE_SMA,...)`), `codegen_mql4.py` comment confirms `slowing=1` explicitly, matching `indicators.py::stochastic()` |
| 3 | MACD signal line SMA vs EMA mismatch | Yes | Manual EMA-recurrence signal block present and unchanged in both `codegen_mql5.py:184-204` (`_macd_signal_block_mql5`) and `codegen_mql4.py` (`_macd_signal_block`) |
| 4 | PIPS-mode stop distance scale (300/600 vs 3.0/6.0) | Yes | All three codegens and `runner.py`/`execution_mtf.py`/`execution_tick.py` consistently default to `sl_points=3.0`/`tp_points=6.0` |
| 5 | Supertrend lookback window too short | Yes | `codegen_mql5.py:123` (`lookback = max(150, period * 15)`), matches `indicators.py`'s own approach |
| 6 | Donchian off-by-one (current bar included) | Yes | `indicators.py:81-82` (`high.shift(1).rolling(...)`), `codegen_mql5.py:105-114` (shift 2/3, excluding current bar), `codegen_pine.py:56-57` (`high[1]`) — all three consistent |
| 7 | Supertrend sign flip in Pine | Yes | `codegen_pine.py:65-66` (`{iid}_trend = -{iid}_dirRaw`), comment explicitly documents the convention difference |
| 8 | Pine position sizing disconnected from risk% | Yes | `codegen_pine.py:136-139` (real `riskMoney`/`lossPerContract`/`qty` formula), `strategy.position_avg_price`-anchored SL/TP (`codegen_pine.py:161-169`) |

**No regression found. No unrelated changes introduced during this
re-inspection** — this was a read-only confirmation pass, consistent
with the sprint's scope.

---

## Final classification

| Component | Decision | Reason | Priority |
|---|---|---|---|
| Breakeven (backtest default) | **D** — deactivate as the Quant Lite default | Codegen can't reproduce it; honesty requires the backtest not claim it either, until C is done | CRITICAL |
| ATR trailing (backtest default) | **D** | Same reasoning | CRITICAL |
| Partial close (backtest default) | **D** | Same reasoning | CRITICAL |
| Breakeven/trailing/partial (codegen implementation) | **C** — scheduled, not immediate | Real target state, but larger/riskier than D; do after D, not instead of it | HIGH (post-launch-honesty) |
| `runner.py` as an engine | **RETIRE from canonical role**, keep for historical reference only | Strictly dominated by `execution_mtf.py` on spread and SL/TP resolution | HIGH |
| `execution_mtf.py` | **KEEP — canonical engine candidate** | Best cost/accuracy tradeoff; not yet proven via GAP-06's cross-validation | HIGH |
| `execution_tick.py` | **F — research-only** | Correct, real tick fidelity, but too slow for library-scale use today | MEDIUM |
| Static spread (`runner.py`) | **D** (via engine retirement above) | Not a patch target — the engine it's part of is being retired from the canonical role | HIGH |
| Slippage | **E — mark unsupported** | Smaller, less certain effect; real modeling is a Quant Pro research task | LOW |
| Commission hook | **A — keep, cosmetic note only** | Currently inert, not misleading in behavior, only in appearance | INFORMATIONAL |
| Session filter (spec engine) | **E — mark unsupported explicitly** | Currently silently ignored despite `RiskConfig` implying otherwise; document, don't necessarily implement | MEDIUM |
| Stop-distance/freeze-level validation | **F — research-only** | Unmeasured real-world impact, shared gap not a divergence | LOW |
| Cross-engine window comparison (GAP-06) | **G — defer to a test-execution sprint** | Out of Q0.3's audit-only scope | MEDIUM |
| 1,764-strategy library | **REFACTOR** (unchanged this sprint) | Label `LEGACY-BACKTEST-EVIDENCE`; rebuild only after canonical engine + real data source confirmed | MEDIUM |
| Indicator math (`indicators.py` + 3 codegens) | **KEEP** | All 10 types correct and mirrored; all 8 known cross-language bugs re-confirmed fixed | — |
| Multiple-position enforcement | **KEEP** | Genuine four-way parity, no action needed | — |
| `quant_engine/engine.py` (base engine, account-blown bug) | **DO NOT TOUCH** this sprint / **G — defer** | Vendored dependency; same unfixed bug as pre-Q0.2 spec engines, but out of scope here | MEDIUM (future) |
| `quant_engine/market.db` | **DO NOT TOUCH** | Confirmed live M-Series dependency (Q0.2); zero writes this sprint, verified by `git status` | — |
| `at24-quant-engine/` | **DO NOT TOUCH / OUT OF SCOPE** | Separate project, own sprint numbering, not opened beyond a top-level directory listing this sprint | — |

---

## Q0.3 COMPLETE

**1. What exactly does the Python backtester execute?** Three different
things, not one — see the execution contract. `execution_mtf.py` is the
recommended canonical target; `runner.py` and `execution_tick.py` are
not equivalent to it.

**2. What exactly does each code generator produce?** Correct entry
signals and correct static SL/TP across all 10 indicator types (all 8
previously-known cross-language bugs re-confirmed fixed), but **no**
breakeven/trailing/partial-close/session-filter — a materially smaller
feature set than what the Python backtest evaluates by default.

**3. Where are the differences?** Documented exhaustively in the parity
matrix; three CRITICAL, one HIGH, two MEDIUM, two LOW, one
INFORMATIONAL gap, per the gap report.

**4. Which differences materially affect results?** Breakeven, trailing,
partial-close (CRITICAL — proven present and firing in real runs, e.g.
the observed PARTIAL trade pair in MACD Crossover's 2024 tick-engine
run) and the static-spread assumption (HIGH — measured ~2.4× the real
average XAUUSD spread).

**5. Which historical metrics are affected?** All 1,764 library rows,
plus every backtest number produced by this project to date, including
this sprint's own MACD/Bollinger checkpoint numbers — none deleted or
rewritten, all recommended for `LEGACY-BACKTEST-EVIDENCE` labeling.

**6. Which risk defaults caused the mismatch?** `RiskConfig.use_breakeven`
/`use_trailing`/`use_partial`, all `True` by default in
`quant_engine/engine.py`, never overridden by any of the 7 call sites in
this repository, and structurally impossible to disable at the
spec/JSON level (only at Python `RiskConfig(...)` construction).

**7. Can the execution model be made deterministic?** It already is —
confirmed directly (TEST 17, real `demo.py` re-run). Determinism was
never the problem; parity with the generated code was.

**8. What minimum parity is required for Quant Lite?** At minimum:
Decision D applied (backtest defaults matched to what codegen actually
does) before any Quant Lite number is shown to a user — this is the
launch-blocking item.

**9. What should be fixed?** Nothing was fixed this sprint (by design).
Recommended first fix, next sprint: apply Decision D (deactivate
breakeven/trailing/partial as the Quant Lite default) — small,
low-risk, immediately closes the CRITICAL gap.

**10. What should remain unsupported?** Slippage, session filtering, and
broker stop-distance validation for Quant Lite v1 (Decisions E/F) —
honestly documented as absent, not silently missing.

**11. What should remain research-only?** `execution_tick.py`
(too slow for library-scale use today) and broker stop-distance
validation.

**12. What should never be copied into Quant Pro?** `runner.py`'s
static-spread, coarse-SL/TP-resolution model, and the current
codegen/backtest mismatch itself (GAP-01–03) — Quant Pro inherits the
*fixed* version of this reconciliation, never the current gap.

### Execution contract summary
Three non-identical Python backtest engines share one risk-management
layer (`RiskConfig`, defaults all position-management features on); code
generation implements entry/exit/sizing/indicators correctly but omits
all dynamic position management. Fully deterministic. No randomness. No
automated test suite exists anywhere in this codebase.

### Parity matrix summary
6 genuine parities (mostly indicator math and structural guarantees like
single-position enforcement), 3 shared-absence "parities," 5 partial
parities (mostly a precision spectrum across the three Python engines,
not true Python-vs-codegen conflicts), **3 confirmed NO PARITY items —
all three the CRITICAL position-management gap** — and 4 ambiguous items
needing further investigation (slippage semantics, broker time-zone
reconciliation, data-gap detection).

### Critical gaps
GAP-01 (breakeven), GAP-02 (trailing), GAP-03 (partial-close) — codegen
does not implement any of them; Python backtest runs all three by
default with no per-spec opt-out.

### Historical-result impact
All 1,764 library rows and every backtest number this project has ever
produced reflect this gap. Recommended relabeling to
`LEGACY-BACKTEST-EVIDENCE`. Nothing deleted or rewritten.

### Recommended fixes
Decision D first (deactivate the three defaults for Quant Lite's own
`RiskConfig` usage — smallest, fastest, immediately closes the
CRITICAL/blocking gap), Decision C second (real codegen implementation,
scheduled separately, not rushed), canonical-engine selection
(`execution_mtf.py`) pending the GAP-06 cross-validation test.

### Files changed
None. Five new files created:
`QUANT_LITE_EXECUTION_CONTRACT.md`, `QUANT_LITE_EXECUTION_PARITY_MATRIX.md`,
`QUANT_LITE_EXECUTION_GAP_REPORT.md`, `QUANT_LITE_EXECUTION_TEST_PLAN.md`,
this document — all under `quant-engine/reports/`.

### Files untouched
Every `.py` file in `quant-engine/spec_engine/`, `quant-engine/scripts/`,
`quant_engine/`; `market.db`; `strategy_library.db`; everything under
`ea-research/`, `frontend/`, `mt5-bridge/`, `at24-quant-engine/`.
Confirmed via `git status` before and after this sprint's work —
zero unexpected changes.

### `market.db` status
Untouched. Read-only queries only (table/row-count/symbol checks,
consistent with Q0.2's own findings, not re-verified with new writes).
Its live dependency status for M4/M12 (established in Q0.2) is
unchanged and was not affected by this sprint.

### M-Series status
Untouched. Not opened, not read, not modified beyond the grep-based
dependency discovery already completed in Q0.2 (not repeated this
sprint — no new M-Series investigation was needed for Q0.3's scope).

### Exact recommendation for Q0.4
**Do not start Q0.4 automatically, per the sprint brief.** If/when
authorized, the recommended Q0.4 scope is narrow and low-risk: implement
Decision D only (change the `RiskConfig` defaults used for any
Quant-Lite-facing backtest to `use_breakeven=False`,
`use_trailing=False`, `use_partial=False`, matching what the code
generators actually produce) — not a redesign, not new codegen
functionality, not a library rebuild. That one change closes the
CRITICAL gap this entire sprint was built around, with the smallest
possible surface area, and can be verified against the exact same
`demo.py` reference-reproduction check already proven reliable in Q0.2.
