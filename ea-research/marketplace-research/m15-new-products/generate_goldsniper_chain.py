"""
Runs the real M3/M4/M5/M7 chain for Gold Sniper on the trade-by-trade evidence package (equity = deposit + cumulative closed
profit; the report's own 539 trades, no invented numbers).

NOTE (2026-10-20): a bar-level equity curve was tried first but market.db has NO XAUUSD_EXNESS M15 candles for 2025-07-16..2026-01-01
(95 trades), 2026-03-27..2026-05-01 (40 trades) and 2026-05-10..2026-05-31 (21 trades), so its drawdown was understated (11.8% vs the
25.84% closed-trade drawdown) and is NOT used.

Run: python generate_goldsniper_chain.py
"""
import json
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "m2-evidence-engine"))
sys.path.insert(0, str(HERE.parent / "m3-evidence-verification"))
sys.path.insert(0, str(HERE.parent / "m4-validation-engine"))
sys.path.insert(0, str(HERE.parent / "m5-risk-analysis"))
sys.path.insert(0, str(HERE.parent / "m6-history-engine"))
sys.path.insert(0, str(HERE.parent / "m7-trust-status"))
from evidence_verifier import verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis  # noqa: E402
from history_engine import build_system_lifecycle_chain  # noqa: E402
from trust_status_engine import run_trust_status  # noqa: E402

EVIDENCE_PATH = HERE.parent / "m2-evidence-engine" / "real_evidence_output" / "evidence_GOLDSNIPER-v1.00-2025-2026-BASELINE_0d2eb16be8ff99ad.json"
SOURCE_ARTIFACT = Path(r"C:\Users\om\OneDrive\Desktop\hedge\ReportTester-279321674 gold sniper.xlsx")
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "GOLDSNIPER-v1.00-2025-2026-BASELINE"
TRADING_SYSTEM_ID = "GOLDSNIPER"
OUTPUT_PATH = HERE / "goldsniper_chain_result.json"


def main() -> None:
    m3_result = verify_evidence_package(EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    val_result = run_validation_suite(
        EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY,
        expected_dataset_hash=None, parameter_configurations=None,
    )
    risk_result = run_risk_analysis(EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, validation_result=val_result)
    evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))["evidence"]

    recorded_at = datetime.utcnow().isoformat() + "Z"
    history = build_system_lifecycle_chain(TRADING_SYSTEM_ID, EXPECTED_VERSION_ID, evidence, m3_result, val_result, risk_result, recorded_at)
    trust_chain = run_trust_status(EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, TRADING_SYSTEM_ID, val_result, risk_result, history, [])
    trust = trust_chain[-1]

    snapshot = {
        "_provenance": {
            "generatedBy": "generate_goldsniper_chain.py (trade-by-trade evidence)",
            "generatedAt": recorded_at,
            "note": "Real, deterministic M3/M4/M5/M7 result on the trade-by-trade equity curve of the report's own 539 trades - not fabricated.",
        },
        "tradingSystemId": TRADING_SYSTEM_ID, "versionId": EXPECTED_VERSION_ID,
        "m3": {"status": m3_result.status, "evidenceId": m3_result.evidenceId, "warnings": m3_result.warnings},
        "m4": {"overallStatus": val_result["overallStatus"], "evidenceId": val_result["evidenceId"],
               "recordStatuses": {r["validationType"]: r["status"] for r in val_result["records"]}},
        "m5": {"status": risk_result["status"], "riskAnalysisId": risk_result["riskAnalysisId"],
               "riskAnalysisHash": risk_result["riskAnalysisHash"], "dataQuality": risk_result["dataQuality"]},
        "m7": {"status": trust["status"], "reasonCode": trust["reasonCode"], "explanation": trust["explanation"],
               "id": trust["id"], "generatedAt": trust["generatedAt"]},
        "evidenceId": evidence["_contentHash"], "evidenceHash": evidence["_contentHash"],
        "validationId": val_result["evidenceId"], "validationHash": val_result["evidenceId"],
        "riskAnalysisId": risk_result["riskAnalysisId"], "riskAnalysisHash": risk_result["riskAnalysisHash"],
        "trustStatusId": trust["id"], "lastEvidenceAt": evidence.get("provenance", {}).get("periodEnd"),
        "m4_full": val_result, "m5_full": risk_result, "m6_full": history,
    }

    OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"Result written: {OUTPUT_PATH}")
    print(f"  M3={m3_result.status} M4={val_result['overallStatus']} M5={risk_result['status']} M7={trust['status']}/{trust['reasonCode']}")
    print(f"  M5 dataQuality: {risk_result['dataQuality']}")


if __name__ == "__main__":
    main()
