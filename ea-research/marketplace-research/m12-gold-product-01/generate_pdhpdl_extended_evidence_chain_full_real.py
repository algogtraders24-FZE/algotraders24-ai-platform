"""
Product #1 -- the real, complete M3/M4/M5/M6/M7 chain for PDHPDL-GOLD-v2x,
now with BOTH previously-INCONCLUSIVE validation dimensions genuinely
computed: REGIME_COVERAGE (real regime-tagged evidence file, from
tag_trades_with_regime.py) and PARAMETER_SENSITIVITY (real baseline vs 4
perturbed-parameter Python backtests, from pdhpdl_strategy_backtest.py,
run against real quant_engine/market.db XAUUSD_EXNESS candles). Every
M3-M7 function called here is completely unmodified -- only real inputs
were added, no engine logic changed.

Run: python generate_pdhpdl_extended_evidence_chain_full_real.py
"""

import json
import sys
from dataclasses import replace
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
from pdhpdl_strategy_backtest import load_candles, run_pdhpdl_backtest, Params  # noqa: E402

HERE = Path(__file__).parent
EVIDENCE_PATH = HERE.parent / "m4-validation-engine" / "pdhpdl_gold_v2x_regime_tagged_with_curve.json"
MARKET_DB = HERE.parent.parent.parent / "quant_engine" / "market.db"
SOURCE_ARTIFACT = Path(r"C:\Users\om\OneDrive\Desktop\staergy report\ReportTester-new report xml.xlsx")
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"
EXPECTED_VERSION_ID = "PDHPDL-GOLD-v2x-2025-2026-EXTENDED-RUN"
TRADING_SYSTEM_ID = "PDHPDL-GOLD"
OUTPUT_PATH = HERE / "pdhpdl_gold_extended_evidence_chain_result.json"


def build_parameter_configurations() -> dict[str, list[dict]]:
    candles = load_candles(MARKET_DB, "XAUUSD_EXNESS", "15m")
    baseline_params = Params()
    variants = {
        "baseline": baseline_params,
        "A_sl_atr_mult_plus15pct": replace(baseline_params, sl_atr_mult=baseline_params.sl_atr_mult * 1.15),
        "B_sl_atr_mult_minus15pct": replace(baseline_params, sl_atr_mult=baseline_params.sl_atr_mult * 0.85),
        "C_tp_atr_mult_plus15pct": replace(baseline_params, tp_atr_mult=baseline_params.tp_atr_mult * 1.15),
        "D_pyramid_trigger_r_plus20pct": replace(baseline_params, pyramid_trigger_r=baseline_params.pyramid_trigger_r * 1.2),
    }
    configurations = {}
    for name, params in variants.items():
        trades, summary = run_pdhpdl_backtest(candles, params)
        configurations[name] = trades
        print(f"  {name}: {summary}")
    return configurations


def main() -> None:
    if not EVIDENCE_PATH.exists():
        raise FileNotFoundError(f"Regime-tagged evidence package not found: {EVIDENCE_PATH} -- run tag_trades_with_regime.py first.")

    print("Running real parameter-sensitivity backtests (baseline + 4 variants)...")
    parameter_configurations = build_parameter_configurations()

    m3_result = verify_evidence_package(EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY)
    val_result = run_validation_suite(
        EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY,
        expected_dataset_hash=None, parameter_configurations=parameter_configurations,
    )
    risk_result = run_risk_analysis(EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, validation_result=val_result)
    evidence = json.loads(EVIDENCE_PATH.read_text(encoding="utf-8"))["evidence"]

    recorded_at = datetime.utcnow().isoformat() + "Z"
    history = build_system_lifecycle_chain(TRADING_SYSTEM_ID, EXPECTED_VERSION_ID, evidence, m3_result, val_result, risk_result, recorded_at)
    trust_chain = run_trust_status(EVIDENCE_PATH, SOURCE_ARTIFACT, EXPECTED_VERSION_ID, REGISTRY, TRADING_SYSTEM_ID, val_result, risk_result, history, [])
    trust = trust_chain[-1]

    snapshot = {
        "_provenance": {
            "generatedBy": "generate_pdhpdl_extended_evidence_chain_full_real.py",
            "generatedAt": recorded_at,
            "note": "REGIME_COVERAGE: real, via regime_classifier.py against real quant_engine/market.db candles. "
                    "PARAMETER_SENSITIVITY: real, via pdhpdl_strategy_backtest.py (standalone faithful Python port "
                    "of the EA's real logic, run against the SAME real candle data) - baseline + 4 perturbed "
                    "variants (SL x1.15/x0.85, TP x1.15, pyramid-trigger x1.2), each an independent, apples-to-apples "
                    "backtest through this same engine. This is a SEPARATE engine from the real MT5 Strategy Tester "
                    "run that produced the actual PDHPDL-GOLD-v2x Evidence - see pdhpdl_strategy_backtest.py's own "
                    "docstring for every documented simplification versus the real MT5 execution model.",
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
        "riskAnalysisId": risk_result["riskAnalysisId"],
        "trustStatusId": trust["id"],
        "lastEvidenceAt": evidence.get("provenance", {}).get("periodEnd"),
        "m4_full": val_result,
        "m5_full": risk_result,
        "m6_full": history,
    }

    OUTPUT_PATH.write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"\nResult written: {OUTPUT_PATH}")
    print(f"  M3={m3_result.status} M4={val_result['overallStatus']} M5={risk_result['status']} M7={trust['status']}/{trust['reasonCode']}")
    for r in val_result["records"]:
        print(f"    {r['validationType']}: {r['status']}")


if __name__ == "__main__":
    main()
