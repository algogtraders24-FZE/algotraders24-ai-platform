"""
Builds the real G01 History chain from the genuine M2/M3/M4/M5 artifacts and
writes M6_history_report.md. Read-only against all upstream artifacts.
Does NOT rerun the backtest, does NOT modify the strategy, does NOT
manufacture a second observation -- there is exactly one genuine G01
baseline observation, and the report says so explicitly (section 28).

Run: python run_real_g01_history.py
"""

import glob
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "m2-evidence-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m3-evidence-verification"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m4-validation-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m5-risk-analysis"))
from evidence_verifier import verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis  # noqa: E402

from history_engine import build_system_lifecycle_chain, compute_evidence_age, verify_chain

HERE = Path(__file__).parent
REAL_EVIDENCE_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm")
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "G01-v0.1-FROZEN-BASELINE"
TRADING_SYSTEM_ID = "G01"


def render_report(chain, chain_ok, chain_issues, evidence, age) -> str:
    registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
    system_name = registry.get(EXPECTED_VERSION_ID, {}).get("tradingSystemName", "?")

    lines = [
        "# M6 History Report — G01",
        "",
        "## System",
        "",
        f"- TradingSystem: `{TRADING_SYSTEM_ID}` — {system_name}",
        f"- Version: `{EXPECTED_VERSION_ID}`",
        "",
        "## History Chain",
        "",
        f"Chain integrity: **{'VERIFIED' if chain_ok else 'FAILED — ' + '; '.join(chain_issues)}**",
        "",
    ]
    for i, ev in enumerate(chain, 1):
        lines += [
            f"### Event {i}: {ev['eventType']}",
            "",
            f"- observedAt: `{ev['observedAt']}`",
            f"- recordedAt: `{ev['recordedAt']}`",
            f"- source: `{ev['source']}`",
            f"- artifact IDs: evidenceId=`{ev['evidenceId']}`, validationId=`{ev['validationId']}`, riskAnalysisId=`{ev['riskAnalysisId']}`",
            f"- sourceHash: `{ev['sourceHash']}`",
            f"- eventHash: `{ev['historyEventId']}`",
            f"- previousEventId: `{ev['previousEventId']}`",
            f"- payload: `{json.dumps(ev['payload'])}`",
            "",
        ]

    lines += [
        "## Longitudinal State",
        "",
        "- Evidence records: **1**",
        "- Validation records: **1** (containing 7 validation-type sub-records — see M4_validation_report.md)",
        "- RiskAnalysis records: **1**",
        f"- Evidence age: **{age['ageDays']} days** (reference time {age['referenceTime']}, evidence period end {age['observedAt']})",
        "- History gaps: not computable — fewer than 2 observations exist.",
        "- Cadence: not computable — fewer than 2 observations exist.",
        "",
        "## Version History",
        "",
        f"- Versions on record: **1** (`{EXPECTED_VERSION_ID}`)",
        "- Supersession events: none recorded — no second version has been independently verified through this pipeline yet. "
        "(Note: an execution-integrity-patched build referred to elsewhere in this research program as \"v0.2\" exists as source code, "
        "but per section 25 of this sprint's brief, it is not assumed to be a separate validated Version here merely because a report "
        "file exists for it — it would need its own independent M2→M5 run through this exact pipeline to earn a VERSION_CREATED event.)",
        "",
        "## Comparability",
        "",
        "- Comparable observation pairs: **0** — only one observation exists; there is nothing to compare it against.",
        "- Non-comparable observation pairs: **0**",
        "",
        "## Limitations",
        "",
        "**Single verified historical observation; longitudinal performance history not yet established.** "
        "Everything in this report (evidence age, the single-event chain, the absence of gaps/cadence/change-detection output) reflects "
        "exactly one genuine G01 v0.1 backtest run through M2→M5. No monthly, live, or forward-test observations exist. No performance "
        "trend, recovery pattern, or version transition is asserted anywhere in this report — per this sprint's explicit rule (section 28), "
        "none has been manufactured to fill the gap. The gap-detection, cadence-analysis, and change-detection *engine functions* are proven "
        "correct against synthetic multi-observation fixtures in `test_history_engine.py` (Tests M, O, P, Q) — they are simply not yet "
        "exercised against a second real G01 observation, because one does not exist.",
        "",
        "## Final Status",
        "",
        f"# {'PARTIAL' if chain_ok else 'FAILED'}",
        "",
        "**Why PARTIAL, not COMPLETE:** the chain itself is fully verified and every event is properly hashed, sourced, and provenance-complete "
        "— but a *longitudinal* history engine's fullest value (gap detection, cadence, change tracking) requires more than one observation, "
        "which doesn't exist yet for G01. `COMPLETE` is reserved for a case where the available observation depth actually supports every "
        "longitudinal feature this engine has, not just the chain-integrity portion of it.",
        "",
        "**What this status does not mean:** no Trust Status, Score, or marketplace-readiness conclusion is implied. G01's underlying measured "
        "facts (PF≈0.888, expectancy≈-$2.18/trade, max drawdown 63.01%) remain exactly as reported in M4/M5 — this report adds *when AT24 came "
        "to know them*, not a new judgment about them.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    matches = sorted(glob.glob(str(REAL_EVIDENCE_DIR / "evidence_*.json")))
    if not matches:
        raise FileNotFoundError(f"No Evidence package found in {REAL_EVIDENCE_DIR}")
    evidence_path = Path(matches[0])

    m3_result = verify_evidence_package(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    val_result = run_validation_suite(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    risk_result = run_risk_analysis(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, validation_result=val_result)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["evidence"]

    recorded_at = datetime.utcnow().isoformat() + "Z"
    chain = build_system_lifecycle_chain(TRADING_SYSTEM_ID, EXPECTED_VERSION_ID, evidence, m3_result, val_result, risk_result, recorded_at)
    chain_ok, chain_issues = verify_chain(chain)
    age = compute_evidence_age(datetime.utcnow(), evidence)

    report = render_report(chain, chain_ok, chain_issues, evidence, age)
    out_path = HERE / "M6_history_report.md"
    out_path.write_text(report, encoding="utf-8")

    print(f"Chain integrity: {'VERIFIED' if chain_ok else 'FAILED: ' + str(chain_issues)}")
    print(f"Events: {len(chain)}")
    print(f"Report written: {out_path}")


if __name__ == "__main__":
    main()
