# quant-engine — Integration Decision

Written per `HANDOFF_SPRINT_idea_to_code.md` task 5, in the style of
[`M12_decision_report.md`](../../ea-research/marketplace-research/m12-gold-product-01/M12_decision_report.md) —
a short, explicit written classification, not an implicit default.

**This is not M13.** M13 is reserved for seller economy/pricing per
`M0.1_product_model_freeze.md`. quant-engine arrived from a separate cloud
session that never saw the M-series pipeline; it is treated here as an
outside contribution being classified against that pipeline, not a
continuation of its sprint numbering.

---

## Classification: (c) — narrower, with a specific promotion path

Not (a) full feeder. Not (b) fully standalone either. Two things are true
at once, and the sprint brief's own "something narrower" option is what
actually fits:

1. **The wizard/library/LLM-parser stay outside the marketplace pipeline
   as a standing capability.** They are a rapid-prototyping and
   candidate-generation tool for you, the researcher — not an automatic
   feed into Evidence/Validation/TrustStatus.
2. **Any single strategy this engine produces can still be manually
   promoted, one at a time, into the real M-series pipeline** — starting
   as a brand-new `TradingSystemVersion` with zero Evidence of its own
   (M0.1 principle 10), going through the exact same audit-first process
   G01 and M12 went through. Never a bulk/automatic promotion of the
   whole grid.
3. **The walk-forward robustness-scoring technique
   (`spec_engine/robustness.py`) is worth reusing as a method inside
   M4/M5**, independent of whether any quant-engine-authored strategy
   itself ever becomes a product.

## Reasoning

### Why not (a), full feeder, right now

M0.1/M1's whole model is built around **one deeply-audited candidate at a
time** — G01 got a 12-file research build with full CSV telemetry across
~9.3 years; M12 got a dedicated audit report, source-version
reconciliation, and 14/15 explicit PASS tests before even reaching
"classification A." That process is deliberately slow and manual by
design (M0.1 principle 2: reproducibility: Evidence not traceable to a
named, versioned generator process cannot be trusted the same way).

quant-engine's whole design point is the opposite: volume. The
pre-computed library alone is 1,764 strategies, and its own session
report is explicit that most of them are noise — only 74/468 (16%)
profitable on XAUUSD 1h, 27/477 (6%) on EURUSD 1h. Feeding all of that
through a per-Version Evidence → Validation → RiskAnalysis → History →
TrustStatus chain built for one-candidate-at-a-time depth would either
(a) overwhelm that pipeline with mostly-known-noise candidates, or (b)
get silently short-circuited into a lighter-weight process — which is
exactly the kind of "collapsed layer" M0.1 explicitly rejected.

There's also a real provenance gap that would need its own resolution
before any quant-engine Evidence could sit at the same trust level as
G01/M12's: G01 and M12's Evidence came from **MetaTrader's own Strategy
Tester**, reconstructed from real broker Deals tables. quant-engine's
metrics come from a **custom Python bar-based backtester** — a different
`Evidence.generatedBy` process entirely, one that (per this project's own
session report) needed 8 real bug fixes to keep the Python numbers and
the generated MQL5/MQL4/Pine code from silently diverging from each
other. That's evidence the schema can represent honestly
(`Evidence.generatedBy`, `provenance.dataSource`), but it means a
quant-engine spec's Evidence is not automatically equivalent-quality to
an MT5-Tester-backed report — any Spec that gets promoted still needs
its generated EA independently run through real MetaTrader Strategy
Tester (not just the Python backtest) before Evidence built from it can
carry the weight M12's does. That cross-check is exactly what task 3 of
this sprint (MetaEditor compile) is the first step toward, but compiling
clean is not the same claim as an independently-run Tester report.

### Why not (b), fully standalone either

The walk-forward evaluation in `robustness.py` — fixed params, N
sequential non-overlapping folds, scored on consistency rather than raw
profit factor — is methodologically almost exactly M4's reserved
`WALK_FORWARD` validation layer (M1 schema, §2 Validation.layer enum).
M4's own spec already named that layer but left its thresholds
undecided. quant-engine has a working reference implementation of the
*technique* sitting right here, already proven against a real
data-snooping trap (the XAUUSD 1h example in the session report: naive
best-PF pick scored *lower* robustness than a runner-up). Discarding
that as "never touches the pipeline" throws away real, working
anti-curve-fit logic that M4/M5 doesn't have yet.

### The M1 schema-compatibility question — resolved, not deferred

The sprint brief flagged this as worth its own short sprint. Having now
read `M1_tradingsystem_schema.md` directly, the answer is already there
and doesn't need a new sprint:

**Yes — a Spec-based strategy is a valid `TradingSystemVersion` under M1
as-is, no schema extension needed.** `Version.strategyDefinition` is
explicitly documented as "JSON: entry/exit logic reference, parameter
set, artifact pointer/hash — seller-authored technical description" —
built as an opaque JSON blob precisely so a new authoring format doesn't
require a migration. A quant-engine Spec maps cleanly onto it:

| M1 field | Spec source |
|---|---|
| `Version.strategyDefinition` | the Spec JSON itself (indicators + entry_long/entry_short) |
| `Version.declaredRiskModel` | `spec.risk` |
| `Version.supportedInstruments`/`supportedTimeframes` | `spec.symbol`/`spec.timeframe` |
| `Evidence.metricsSummary` | `summarize()`'s output (profit_factor, win_rate_pct, total_return_pct, max_drawdown_pct, trades_total → tradeCount) |
| `Evidence.generatedBy` | e.g. `"quant-engine-python-runner-v1"` — distinct from `"AT24-MT5-Tester-v1"`, and must stay visibly distinct per the provenance point above |
| `Evidence.provenance.dataSource` | e.g. `"Exness tick feed, 1h resampled"` — must travel with any metric per M0.1 principle 7 |

No schema change. The only real work if/when a specific spec is promoted
is generating its Evidence honestly (through the process gap noted
above), not extending M1.

## What this decision does NOT do

- Does not create a marketplace listing for anything quant-engine has
  produced.
- Does not run any quant-engine spec through Evidence/Validation/
  RiskAnalysis/TrustStatus — no candidate has been selected for
  promotion.
- Does not modify `m2-evidence-engine/`, `m4-validation-engine/`, or any
  other M-series engine internals.
- Does not assign quant-engine or any of its 1,764 library strategies a
  Trust Status or Score of any kind.
- Does not merge `quant-engine/` into `ea-research/`.

## What happens next (not started this sprint)

Two independent, optional next steps — neither is implied by this
decision, both need your explicit go-ahead:

1. If a specific quant-engine-generated strategy looks worth pursuing,
   promoting it means treating it exactly like a new M12-style candidate
   sprint: source/version audit, real MetaTrader Strategy Tester
   cross-check (not just the Python backtest), then the same Evidence →
   Validation → RiskAnalysis → History → TrustStatus chain from zero.
2. Reusing `spec_engine/robustness.py`'s walk-forward-evaluation method
   inside M4's `WALK_FORWARD` layer would be a scoped M4 sub-task, not a
   quant-engine change — M4 would call the technique, quant-engine's own
   pipeline is untouched either way.

---

**STOP.** No candidate promoted. No M-series engine touched. No
marketplace listing created. This classification stands until revised
explicitly, the same way M0.1 requires of itself.
