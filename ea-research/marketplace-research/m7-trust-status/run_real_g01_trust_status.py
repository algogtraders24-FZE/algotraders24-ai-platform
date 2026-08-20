"""
Runs M7 against the real G01 M3/M4/M5/M6 outputs and writes
M7_trust_status_report.md. Read-only against all upstream artifacts. Does
NOT rerun the backtest, does NOT modify the strategy, does NOT soften or
force the result.

Run: python run_real_g01_trust_status.py
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
sys.path.insert(0, str(Path(__file__).parent.parent / "m6-history-engine"))
from evidence_verifier import verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis  # noqa: E402
from history_engine import build_system_lifecycle_chain  # noqa: E402

from trust_status_engine import run_trust_status, count_observations

HERE = Path(__file__).parent
REAL_EVIDENCE_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm")
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "G01-v0.1-FROZEN-BASELINE"
TRADING_SYSTEM_ID = "G01"


def render_report(chain, m3, val, risk, history) -> str:
    final = chain[-1]
    lines = [
        "# M7 Trust Status Report — G01",
        "",
        "## Inputs",
        "",
        f"- Evidence: `{val['evidenceId']}` (M3 status: **{m3.status}**)",
        f"- Validation: overallStatus **{val['overallStatus']}** — " + ", ".join(f"{r['validationType']}={r['status']}" for r in val["records"]),
        f"- RiskAnalysis: status **{risk['status']}** — dataQuality: " + ", ".join(f"{k}={v}" for k, v in risk["dataQuality"].items()),
        f"- History: {len(history)} events, {count_observations(history)} recorded observation(s)",
        "",
        "## Current Trust Status",
        "",
        f"# {final['status']}",
        "",
        f"- reasonCode: `{final['reasonCode']}`",
        f"- explanation: {final['explanation']}",
        f"- generatedAt: `{final['generatedAt']}`",
        f"- statusContentHash: `{final['statusContentHash']}`",
        "",
        "## Status Precedence — which condition determined the final state",
        "",
        "Checked in this exact order (see M7_trust_status.md section 2): SUPERSEDED? No (no VERSION_SUPERSEDED event exists). "
        "INVALIDATED? No (no invalidation event exists). UNVERIFIED? No (M3 status is VERIFIED). VALIDATION_PENDING? No (a Validation "
        f"result exists). **The determining condition is: M4 overallStatus = `{val['overallStatus']}`** — this alone routes the status "
        "to INCONCLUSIVE, before RiskAnalysis or History observation-count are even consulted (per the documented precedence, Validation "
        "sufficiency is checked before RiskAnalysis completeness).",
        "",
        "## Evidence State (M3)",
        "",
        f"- Status: **{m3.status}**",
        f"- Warnings: {m3.warnings}",
        "",
        "## Validation State (M4)",
        "",
        f"- overallStatus: **{val['overallStatus']}**",
        "",
        "| Validation Type | Status |",
        "|---|---|",
    ]
    for r in val["records"]:
        lines.append(f"| {r['validationType']} | {r['status']} |")
    lines += [
        "",
        "## Risk State (M5)",
        "",
        f"- status: **{risk['status']}**",
        "",
        "| Dimension | Data Quality |",
        "|---|---|",
    ]
    for k, v in risk["dataQuality"].items():
        lines.append(f"| {k} | {v} |")
    lines += [
        "",
        "## History State (M6)",
        "",
        "| # | Event Type | observedAt | recordedAt |",
        "|---|---|---|---|",
    ]
    for i, ev in enumerate(history, 1):
        lines.append(f"| {i} | {ev['eventType']} | {ev['observedAt']} | {ev['recordedAt']} |")
    lines += [
        "",
        "## Longitudinal Depth",
        "",
        f"- Observation count: **{count_observations(history)}**",
        "- Evidence age: see M6_history_report.md (28 days as of the M6 run)",
        "- History limitation: single verified historical observation — no longitudinal trend, cadence, or version-comparison claim is made anywhere in this report.",
        "",
        "## Status Timeline",
        "",
        "| # | Status | Reason Code | Generated At |",
        "|---|---|---|---|",
    ]
    for i, rec in enumerate(chain, 1):
        lines.append(f"| {i} | {rec['status']} | {rec['reasonCode']} | {rec['generatedAt']} |")
    lines += [
        "",
        "## Limitations",
        "",
        "- This is a single TrustStatus derivation from one historical Evidence observation — not a longitudinal trust claim.",
        "- M4's overallStatus is INCONCLUSIVE specifically because REGIME_COVERAGE (no regime classifier exists yet) and "
        "PARAMETER_SENSITIVITY (no perturbation runs were performed, per the M4 sprint's explicit guardrail) could not be completed "
        "— not because G01's methodology failed a check it was actually subjected to.",
        "- G01's underlying measured facts remain exactly as M4/M5 reported them: PF≈0.888, expectancy≈-$2.18/trade, max drawdown "
        "63.01%, negative net profit across most calendar years — none of this is softened, hidden, or reinterpreted by this report. "
        "**INCONCLUSIVE describes the state of AT24's evidence about G01, not a judgment that G01 is a bad strategy — and it is not, "
        "on this evidence, a good one either. It is simply not yet fully validated.**",
        "",
        "## Final Status",
        "",
        f"# {final['status']}",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    matches = sorted(glob.glob(str(REAL_EVIDENCE_DIR / "evidence_*.json")))
    if not matches:
        raise FileNotFoundError(f"No Evidence package found in {REAL_EVIDENCE_DIR}")
    evidence_path = Path(matches[0])

    m3 = verify_evidence_package(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    val = run_validation_suite(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    risk = run_risk_analysis(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, validation_result=val)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["evidence"]
    recorded_at = datetime.utcnow().isoformat() + "Z"
    history = build_system_lifecycle_chain(TRADING_SYSTEM_ID, EXPECTED_VERSION_ID, evidence, m3, val, risk, recorded_at)

    chain = run_trust_status(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, TRADING_SYSTEM_ID, val, risk, history, [])

    report = render_report(chain, m3, val, risk, history)
    out_path = HERE / "M7_trust_status_report.md"
    out_path.write_text(report, encoding="utf-8")

    print(f"Final status: {chain[-1]['status']} ({chain[-1]['reasonCode']})")
    print(f"Report written: {out_path}")


if __name__ == "__main__":
    main()
