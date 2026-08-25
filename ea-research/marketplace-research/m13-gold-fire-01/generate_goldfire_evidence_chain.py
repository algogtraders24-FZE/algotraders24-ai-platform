"""
Product #2 Evidence Qualification -- generates a real M3/M4/M5/M6/M7 result
for GOLDFIRE v5.00 (the risk-percent-compounding Gold breakout EA candidate
intaken in M13), reusing M3-M7's existing, real, unmodified functions --
same pattern as m12-gold-product-01/generate_pdhpdl_evidence_chain.py. No
new computation, no new logic, no fabricated data. Does not modify M2-M9.

Run: python generate_goldfire_evidence_chain.py
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
sys.path.insert(0, str(Path(__file__).parent.parent / "m7-trust-status"))
from evidence_verifier import verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis  # noqa: E402
from history_engine import build_system_lifecycle_chain  # noqa: E402
from trust_status_engine import run_trust_status  # noqa: E402

HERE = Path(__file__).parent
REAL_EVIDENCE_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(r"C:\Users\om\OneDrive\Desktop\staergy report\ReportTester-gfire2025.html")
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "GOLDFIRE-v5.00-2025-BASELINE"
TRADING_SYSTEM_ID = "GOLDFIRE"
OUTPUT_PATH = HERE / "goldfire_evidence_chain_result.json"


def main() -> None:
    matches = sorted(glob.glob(str(REAL_EVIDENCE_DIR / f"evidence_{EXPECTED_VERSION_ID}_*.json")))
    if not matches:
        raise FileNotFoundError(f"No real GOLDFIRE Evidence package found in {REAL_EVIDENCE_DIR}")
    evidence_path = Path(matches[0])

    m3_result = verify_evidence_package(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    val_result = run_validation_suite(
        evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY,
        expected_dataset_hash=None, parameter_configurations=None,  # M12 hard rule carried over: do not optimize
    )
    risk_result = run_risk_analysis(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, validation_result=val_result)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["evidence"]

    recorded_at = datetime.utcnow().isoformat() + "Z"
    history = build_system_lifecycle_chain(TRADING_SYSTEM_ID, EXPECTED_VERSION_ID, evidence, m3_result, val_result, risk_result, recorded_at)
    trust_chain = run_trust_status(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, TRADING_SYSTEM_ID, val_result, risk_result, history, [])
    trust = trust_chain[-1]

    snapshot = {
        "_provenance": {
            "generatedBy": "generate_goldfire_evidence_chain.py (Product #2 qualification)",
            "generatedAt": recorded_at,
            "note": "Real, deterministic M3/M4/M5/M7 result for GOLDFIRE v5.00 -- not fabricated, not a mock fixture. "
                    "Reproducible by re-running this script against the same real artifacts. Severe real max "
                    "drawdown (65.89% equity-based) is disclosed as-is, not smoothed over - see version_registry.json.",
        },
        "tradingSystemId": TRADING_SYSTEM_ID,
        "versionId": EXPECTED_VERSION_ID,
        "m3": {"status": m3_result.status, "evidenceId": m3_result.evidenceId, "warnings": m3_result.warnings},
        "m4": {"overallStatus": val_result["overallStatus"], "evidenceId": val_result["evidenceId"],
               "recordStatuses": {r["validationType"]: r["status"] for r in val_result["records"]}},
        "m5": {"status": risk_result["status"], "riskAnalysisId": risk_result["riskAnalysisId"],
               "riskAnalysisHash": risk_result["riskAnalysisHash"], "dataQuality": risk_result["dataQuality"]},
        "m7": {"status": trust["status"], "reasonCode": trust["reasonCode"], "explanation": trust["explanation"],
               "id": trust["id"], "generatedAt": trust["generatedAt"]},
        "evidenceId": evidence["_contentHash"],
        "evidenceHash": evidence["_contentHash"],
        "validationId": val_result["evidenceId"],
        "validationHash": val_result["evidenceId"],
        "riskAnalysisId": risk_result["riskAnalysisId"],
        "riskAnalysisHash": risk_result["riskAnalysisHash"],
        "trustStatusId": trust["id"],
        "lastEvidenceAt": evidence.get("provenance", {}).get("periodEnd"),
        "m4_full": val_result,
        "m5_full": risk_result,
        "m6_full": history,
    }

    OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"Result written: {OUTPUT_PATH}")
    print(f"  M3={m3_result.status} M4={val_result['overallStatus']} M5={risk_result['status']} M7={trust['status']}/{trust['reasonCode']}")


if __name__ == "__main__":
    main()
