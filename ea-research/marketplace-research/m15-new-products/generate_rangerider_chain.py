"""
Range Rider v4.2 - real M3/M4/M5/M7 chain from the real native MT5 .htm
Strategy Tester report (Deals table), using M2-M7's own existing, unmodified
functions (same pattern as generate_xxxgold_chain.py). No new computation,
no fabricated data. The result can be anything (VALIDATED / INCONCLUSIVE / ...).

Run: python generate_rangerider_chain.py
"""
import json
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
for d in ("m2-evidence-engine", "m3-evidence-verification", "m4-validation-engine", "m5-risk-analysis", "m6-history-engine", "m7-trust-status"):
    sys.path.insert(0, str(HERE.parent / d))
from evidence_engine import run_pipeline_from_deals_table  # noqa: E402
from evidence_verifier import verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis  # noqa: E402
from history_engine import build_system_lifecycle_chain  # noqa: E402
from trust_status_engine import run_trust_status  # noqa: E402

REAL_EVIDENCE_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(r"E:\rr_bt\mt5\rrfix_exn_ALL.htm")
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "AT24-RANGE-RIDER-v4.2.0"
TRADING_SYSTEM_ID = "AT24-RANGE-RIDER"
OUTPUT_PATH = HERE / "rangerider_chain_result.json"


def main() -> None:
    existing = sorted(REAL_EVIDENCE_DIR.glob(f"evidence_{EXPECTED_VERSION_ID}_*_with_curve.json")) or sorted(REAL_EVIDENCE_DIR.glob(f"evidence_{EXPECTED_VERSION_ID}_*.json"))
    evidence_path = existing[0] if existing else run_pipeline_from_deals_table(SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REAL_EVIDENCE_DIR)
    m3_result = verify_evidence_package(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    val_result = run_validation_suite(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, expected_dataset_hash=None, parameter_configurations=None)
    risk_result = run_risk_analysis(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, validation_result=val_result)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["evidence"]

    recorded_at = datetime.utcnow().isoformat() + "Z"
    history = build_system_lifecycle_chain(TRADING_SYSTEM_ID, EXPECTED_VERSION_ID, evidence, m3_result, val_result, risk_result, recorded_at)
    trust_chain = run_trust_status(evidence_path, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, TRADING_SYSTEM_ID, val_result, risk_result, history, [])
    trust = trust_chain[-1]

    snapshot = {
        "_provenance": {"generatedBy": "generate_rangerider_chain.py", "generatedAt": recorded_at,
                        "note": "Real, deterministic M3/M4/M5/M7 result from a real native MT5 Strategy Tester .htm export (generated ticks) - not fabricated."},
        "tradingSystemId": TRADING_SYSTEM_ID, "versionId": EXPECTED_VERSION_ID,
        "m3": {"status": m3_result.status, "evidenceId": m3_result.evidenceId, "warnings": m3_result.warnings},
        "m4": {"overallStatus": val_result["overallStatus"], "evidenceId": val_result["evidenceId"],
               "recordStatuses": {r["validationType"]: r["status"] for r in val_result["records"]}},
        "m5": {"status": risk_result["status"], "riskAnalysisId": risk_result["riskAnalysisId"], "riskAnalysisHash": risk_result["riskAnalysisHash"], "dataQuality": risk_result["dataQuality"]},
        "m7": {"status": trust["status"], "reasonCode": trust["reasonCode"], "explanation": trust["explanation"], "id": trust["id"], "generatedAt": trust["generatedAt"]},
        "evidenceId": evidence["_contentHash"], "evidenceHash": evidence["_contentHash"],
        "validationId": val_result["evidenceId"], "riskAnalysisId": risk_result["riskAnalysisId"], "trustStatusId": trust["id"],
        "lastEvidenceAt": evidence.get("provenance", {}).get("periodEnd"),
        "m4_full": val_result, "m5_full": risk_result, "m6_full": history,
    }
    OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"Result written: {OUTPUT_PATH}")
    print(f"  M3={m3_result.status} M4={val_result['overallStatus']} M5={risk_result['status']} M7={trust['status']}/{trust['reasonCode']}")
    print("  M4 records:", {r['validationType']: r['status'] for r in val_result['records']})
    print("  M7 explanation:", trust["explanation"])


if __name__ == "__main__":
    main()
