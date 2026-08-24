# Idea-to-Code Engine — Handoff Sprint Brief

**Status:** Ready for handoff to the code session. Written for a session that has no memory of the cloud conversation that built this — everything needed to continue is either in this document or in `idea_to_code_handoff.zip`.

**Where this came from:** built in a separate cloud (Cowork) session as a standalone LuxAlgo-style "idea → strategy code" prototype, BEFORE that session discovered the existing `ea-research/marketplace-research/` (M0–M12) pipeline already in this project. It is **not** built on top of, or aware of, the M-series Evidence/Validation/Trust-Status architecture. Treat it as an outside contribution arriving into this project, not as a continuation of the M-series sprint numbering — do not call this "M13" (that number is already reserved for seller economy/pricing per `M0.1_product_model_freeze.md`).

**What it is, one line:** a spec-driven engine — one JSON Spec (indicators + entry rules + risk config) generates a Python backtest, an MQL5 EA, an MQL4 EA, and a Pine Script v5 strategy, all from the same source of truth, plus a 1,764-strategy pre-computed library with walk-forward robustness scoring.

Full narrative report (what was built, all 8 bugs found/fixed, real library numbers) is in `idea_to_code/reports/session_report_idea_to_code.md` inside the zip — read that first for context, this document is the task list.

---

## Sprint tasks (in order)

### 1. Land the code
Extract `idea_to_code_handoff.zip` into the project as its own top-level folder — suggested: `E:\algotraders24-ai-platform\quant-engine\` — kept **separate** from `ea-research/`, not merged into it, until task 5 below produces an explicit integration decision. Do not overwrite or touch anything under `ea-research/` in this task.

### 2. Environment check
Confirm Python deps import cleanly in this project's own environment (pandas/numpy are the only real dependencies; `anthropic` SDK is needed only for the LLM parser path). Run the existing `demo.py` and confirm it reproduces the same 3-strategy output the cloud session saw (RSI+EMA idea genuinely produces 0 trades on the sample XAUUSD 1h data — that's expected, not a bug, per the report).

### 3. Real compile check (not done in the cloud session — no MetaEditor there)
Open at least 2–3 of the generated `.mq5` and `.mq4` files (in `output/`) in MetaEditor and confirm they compile clean with zero errors/warnings. This was explicitly flagged as unverified in the handoff report — treat it as the first real gate before trusting any of this code, the same way M12 flagged its own compile check as SKIPPED rather than faking a pass.

### 4. LLM parser live test
`spec_engine/llm_parser.py` was designed and schema-validated but never actually called — the cloud sandbox had no `ANTHROPIC_API_KEY`. If this environment has one, run `parse_idea_to_spec()` against a handful of plain-language ideas and confirm the self-correcting retry loop behaves as designed. If it doesn't work as expected, that's a real finding to fix here, not to paper over.

### 5. The integration decision (the actual point of this sprint)
This project already has a mature, disciplined Evidence → Validation → Risk Analysis → History → Trust Status pipeline (M1–M11) and one active candidate (M12, PDH/PDL Gold breakout EA, classification A). This new engine can relate to that pipeline in one of a few ways — decide explicitly, in writing, before building further:

- **(a) Feeder** — the wizard/library/LLM-parser becomes a *candidate generator*: it proposes strategies, and anything promising gets pushed through the existing M-series Evidence/Validation chain like any other Trading System Version, per `M0.1`'s frozen architecture (principle 10: every version starts with zero evidence, earns its own).
- **(b) Standalone tool** — stays a separate rapid-prototyping/backtesting utility, never enters the marketplace pipeline, no Trust Status, no Score.
- **(c) Something narrower** — e.g., only the pre-computed library's robustness-scoring method gets reused as a technique inside M4/M5, but the wizard/codegen stays out entirely.

Whichever is chosen, record it the way `M12_decision_report.md` recorded its own classification — as a short written decision with reasoning, not an implicit default. If it becomes a feeder (a), the very next thing needed is deciding whether a Spec-based strategy counts as a valid `TradingSystem` under the M1 schema as-is, or needs a schema extension — that is itself worth its own short sprint before code changes.

### 6. Data pipeline (parked, not started)
`Exness_XAUUSD_2024.zip` / `Exness_XAUUSD_2025.zip` are downloaded in `C:\Users\om\Downloads` (2024 and 2025 tick data confirmed complete; more may still be downloading). Processing them through `tick_import.py` was intentionally left for after the integration decision (task 5) — importing years of tick data is expensive enough that it should happen once, into whichever schema/location task 5 settles on, not twice.

### 7. `market.db` reconciliation (parked, not started)
The cloud session's `market.db` (candle data) and the project's real Postgres/Prisma schema (28 migrations, already implementing the marketplace/evidence model) have not been reconciled. This is explicitly **not** a blank-slate migration — treat the existing schema as authoritative and figure out where (if anywhere) this engine's data needs to live inside it, only after task 5.

---

## Explicitly out of scope for this sprint

- No marketplace listing work.
- No live/demo trading of any strategy this engine has produced.
- No modification of the M-series engines (`m2-evidence-engine/`, `m4-validation-engine/`, etc.) — this sprint only lands new code alongside them and makes an integration decision, it does not touch their internals.
- No numeric performance thresholds are being asserted here as "good enough for marketplace" — per `M0.1` principle 1, none of these backtest numbers are evidence until they go through the real Validation chain.

## Exit criteria for this sprint

1. Code lands at an agreed path, isolated from `ea-research/`.
2. At least one generated MQL5 and one MQL4 file confirmed to compile in MetaEditor (or confirmed broken, with the specific error recorded).
3. LLM parser either live-tested successfully, or blocked-with-reason recorded (e.g., no API key available here either).
4. The integration decision (task 5) is written down explicitly, with reasoning — this is the actual deliverable of this sprint, everything else is groundwork for it.
