# AT24 Quant Lite — Product Blueprint

**Status:** Planning document only. No code has been written against this
blueprint. It defines a boundary and a set of gates a future sprint must
clear — it does not itself clear any of them. Built on top of
[`QUANT_LITE_LEGACY_AUDIT.md`](QUANT_LITE_LEGACY_AUDIT.md); every
classification and gap referenced below traces back to a specific section
of that audit.

**This is not M13.** Per `M0.1_product_model_freeze.md`, M13 is reserved
for seller economy/pricing on the existing marketplace pipeline. Quant
Lite is a **separate product surface** built from the idea-to-code
legacy engine — it does not touch the M-Series Evidence/Validation/Trust
Status chain, and nothing here proposes that it should.

---

## 1. The pipeline

```
Legacy Engine  -->  Stabilized Core  -->  Quant Lite  -->  Free Users
                                              |
                                              v
                                        Upgrade Path
                                              |
                                              v
                                          Quant Pro
```

Each arrow is a gate, not a formality. A component does not move right
until it clears the gate in front of it.

---

## 2. Legacy Engine (what exists today)

Everything catalogued in the audit. Concretely, three parser paths
(wizard / library / LLM), three non-identical backtest engines, three
code generators that don't implement the risk management the backtest
engines apply, a 1,764-strategy library with stale metrics, and zero
automated tests. This layer is **research-grade**, not product-grade —
it proved the architecture (one spec, many outputs) works, and it found
real bugs along the way. It was never meant to be shipped as-is, and per
the audit, several parts of it (the codegen/backtest mismatch
specifically) actively should not be.

## 3. Stabilized Core (the gate before anything is called "Lite")

This is the actual work of a future sprint — not started, not scoped in
detail here, only bounded. A component is **Stabilized** only when:

1. **One canonical backtest engine, not three.** Per the audit's
   classification, `execution_mtf.py` is the strongest candidate (real
   spread, 1-minute resolution, reasonable cost) but is not yet proven
   against `execution_tick.py` on matching windows. `runner.py`
   (coarse, static-spread) should not survive into the stabilized core
   in its current form. `execution_tick.py` stays research-only until
   its performance profile is solved — it is not a launch blocker for
   Quant Lite, it's a future-hardening path.
2. **Code generation matches the backtest it's paired with, or the
   backtest is downgraded to match the code generation — not left
   silently mismatched.** This is the audit's single highest-priority
   finding (§5.2 of the audit). Two honest ways to close it, either is
   acceptable, silence is not:
   - (a) implement breakeven/trailing/partial-close/session-filter in
     all three code generators so they match what the canonical engine
     reports, or
   - (b) make "no active position management beyond static SL/TP" the
     **product's own honest default** (`use_breakeven=False`,
     `use_trailing=False`, `use_partial=False` at the RiskConfig level
     used for anything Quant Lite reports), so the backtest and the
     generated code agree by construction, even if that means simpler,
     more conservative reported numbers.
3. **Provenance on every stored result.** Any number a free user sees
   needs `engine_version`, `data_source`, and `generated_at` traveling
   with it — the audit found the existing 1,764-strategy library has
   none of this, which is exactly why its numbers can no longer be
   trusted without external memory of when/how they were built. Quant
   Lite does not repeat that mistake.
4. **A real, repeatable test suite**, not manual scripts. At minimum:
   every indicator formula checked against an independent reference
   (the audit flagged that nothing currently does this — all existing
   verification is cross-engine self-consistency, which cannot catch a
   formula that's consistently wrong in all three languages), plus a
   locked reference-output regression test (the spiritual successor to
   `demo.py`'s manual comparison, but asserted, not eyeballed).
5. **A pinned dependency manifest.** No `requirements.txt` exists today;
   Stabilized Core needs one before it ships to anyone.

**Nothing in `quant_engine/` (the vendored sibling module) gets touched
during stabilization without first checking M4/M12 impact** — the audit
found `market.db` and its schema are now a live, shared dependency of
the M-Series regime-classification and equity-curve work. `db.py`'s
schema and `market.db`'s symbol keys are effectively a shared contract
now, not private to this product.

## 4. Quant Lite (the actual free product)

Built **only** from components the audit classified `KEEP` or
`KEEP / FUTURE QUANT LITE`, after they clear Stabilized Core:

**In scope:**
- Option A, the template wizard (`template_builder.py`) — deterministic,
  self-tested, zero external API dependency, the strongest and lowest-risk
  candidate per the audit. This is the free user's actual entry point:
  pick a trigger, an optional filter, a risk preset.
- The stabilized canonical backtest engine (see §3.1–3.2) — one honest
  execution model, spread and SL/TP handling clearly documented for what
  it is, not oversold as tick-perfect.
- Code generation for whichever platform the user wants (MQL5/MQL4/Pine),
  **matching** the backtest per §3.2.
- Walk-forward robustness scoring (`robustness.py`) surfaced directly to
  the user — this is a genuine differentiator already built and already
  proven to catch a real curve-fitting trap (the XAUUSD 1h example in the
  original session report). Free users see a robustness score alongside
  every backtest, not just a raw profit factor.

**Explicitly out of scope for v1 of Quant Lite:**
- The pre-computed 1,764-strategy library (Option B), **until rebuilt**
  against the stabilized core and real data with provenance — shipping
  the current stale library to free users would mean shipping numbers
  this audit already established are not trustworthy.
- The LLM parser (Option C), until it has been live-tested against a
  real model, its stale model ID and restricted-indicator prompt fixed,
  and its self-correcting retry loop verified end-to-end. A free-tier
  feature that silently fails or times out on a missing API key is worse
  than not offering it yet.
- `execution_tick.py`-level tick-perfect backtesting — reserved as a
  **Quant Pro** differentiator (§6), not free-tier, both because of its
  current performance cost and because it's a legitimate premium feature.
- Any promotion path into the M-Series marketplace pipeline. Per
  `INTEGRATION_DECISION.md`, that stays a manual, one-candidate-at-a-time
  process independent of whatever Quant Lite ships to free users.

## 5. Hard requirements (non-negotiable, not aspirational)

- **Technical honesty.** Every backtest result a free user sees carries
  its own execution assumptions in plain language next to the numbers —
  what spread was used, what SL/TP resolution granularity, whether
  position management beyond static SL/TP was modeled. No number is
  shown without the audit-equivalent of `provenance` traveling with it,
  the same principle the M-Series' own `Evidence.provenance` field
  already enforces one layer over — Quant Lite does not get a lower bar
  just because it's a separate, simpler product.
- **Deterministic results.** Same spec + same data + same engine version
  = same numbers, every time, for every user. No randomness anywhere in
  the reported path (already true of the current engines — this
  requirement is about *keeping* it true, not fixing something broken).
  If Monte Carlo/perturbation analysis is ever added as a Quant Pro
  feature, it is explicitly labeled as a distribution, never blended
  into the single headline number a free user sees.

## 6. Upgrade path -> Quant Pro

Quant Pro is not scoped in detail here — that's a future sprint's job —
but the boundary is: anything the audit flagged as *real, working, but
too expensive or too unproven for a free tier* is the natural upgrade
surface, not a new invention:
- Tick-level backtesting (`execution_tick.py`), once its performance
  profile is solved.
- The pre-computed strategy library, once rebuilt — searchable at scale
  is a premium research tool, not a free-tier default.
- A tested, live LLM parser (Option C) — natural-language strategy
  authoring as a premium convenience layer over the same underlying
  wizard/engine free users already have.
- Real MetaTrader Strategy Tester cross-verification for any strategy a
  Pro user wants independently confirmed — the same gold-standard check
  `INTEGRATION_DECISION.md` already reserves for M-Series candidate
  promotion, offered here as a paid verification service instead.

## 7. What this document does not do

- Does not approve any code change. Stabilized Core (§3) is a gate
  definition, not a sprint plan with dates or an implementation.
- Does not create a Quant Lite listing, page, or user-facing surface of
  any kind.
- Does not modify `quant_engine/`, `market.db`, or any M-Series file.
- Does not assign a launch date. The gate in §3 is cleared when it's
  cleared, not on a calendar.

---

**Next action, if you choose to authorize it:** scope the actual
Stabilized Core sprint — pick the canonical engine decision explicitly
(§3.1), pick the codegen/backtest reconciliation direction explicitly
(§3.2's option (a) vs (b)), and only then start writing code.
