"""
Converts one product's real Python-ported backtest trades (see
quantum_gold_ai_backtest.py / nexusmining_oil_backtest.py /
quantumpulse_btc_backtest.py - all faithful ports of the real .mq5 signal
engine against real market.db candles) into a real M2 Evidence record
using the SAME compute_metrics/assemble_evidence_record/
write_immutable_evidence functions the native-MT5-report path uses (not
reimplemented), then runs the real, unmodified M3-M7 chain - same
pattern as m12-gold-product-01/generate_pdhpdl_evidence_chain.py.

SOURCE_ARTIFACT for the M3 hash check is quant_engine/market.db itself
(the real data this backtest was computed from) - sourceAdapter is
honestly labeled "python-quantum-engine-backtest-v1", never disguised as
a native MT5 report.

Usage: python assemble_and_chain.py <trades.json> <symbol> <contract_size>
                                     <trading_system_id> <version_id> <out_json>
"""
import sys
import json
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "m2-evidence-engine"))
sys.path.insert(0, str(HERE.parent / "m3-evidence-verification"))
sys.path.insert(0, str(HERE.parent / "m4-validation-engine"))
sys.path.insert(0, str(HERE.parent / "m5-risk-analysis"))
sys.path.insert(0, str(HERE.parent / "m6-history-engine"))
sys.path.insert(0, str(HERE.parent / "m7-trust-status"))
from evidence_engine import compute_metrics, assemble_evidence_record, write_immutable_evidence  # noqa: E402
from evidence_verifier import verify_evidence_package  # noqa: E402
from validation_engine import run_validation_suite  # noqa: E402
from risk_analysis_engine import run_risk_analysis  # noqa: E402
from history_engine import build_system_lifecycle_chain  # noqa: E402
from trust_status_engine import run_trust_status  # noqa: E402

MARKET_DB = Path(r"E:\algotraders24-ai-platform\quant_engine\market.db")
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"
EVIDENCE_OUT_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
FIXED_LOT = 0.01


def main():
    trades_path, symbol, contract_size_s, trading_system_id, version_id, out_json = sys.argv[1:7]
    contract_size = float(contract_size_s)

    raw_trades = json.loads(Path(trades_path).read_text(encoding="utf-8"))

    trades = []
    for t in raw_trades:
        entry_dt = datetime.fromisoformat(t["entry_time"])
        profit = t["pnl_price"] * FIXED_LOT * contract_size
        trades.append({
            "timestamp": entry_dt.strftime("%Y-%m-%d %H:%M:%S"),
            "symbol": symbol,
            "direction": t["side"].lower(),
            "entryPrice": t["entry"],
            "exitPrice": t["exit"],
            "sl": None,
            "tp": None,
            "profit": round(profit, 2),
            "lots": FIXED_LOT,
            "volume": FIXED_LOT,
            "side": t["side"],
        })

    metrics = compute_metrics(trades, initial_deposit=10000.0)

    provenance = {
        "dataSource": {
            "reportFile": "quant_engine/market.db",
            "reportFileSha256": __import__("hashlib").sha256(MARKET_DB.read_bytes()).hexdigest(),
            "tradeLogKind": "python_backtest_engine",
            "tradeLogFile": Path(trades_path).name,
        },
        "broker": "Exness Technologies Ltd (real historical feed, replayed - not a live/demo account report)",
        "symbol": symbol,
        "timeframe": "H1 signal / H4 trend / M15 confirm (faithful port of the real .mq5 engine's own Main_TF/High_TF/Confirm_TF defaults)",
        "periodStart": None,
        "periodEnd": None,
        "spreadModel": None,
        "commissionModel": None,
        "swapModel": None,
        "tickDataQuality": None,
        "executionAssumptions": {"initialDeposit": 10000.0, "leverage": "1:500", "currency": "USD"},
    }
    report_meta = {}  # no native MT5 report exists - cross-check fields stay honestly None

    record = assemble_evidence_record(
        version_id, trades, metrics, provenance, report_meta,
        source_adapter="python-quantum-engine-backtest-v1",
    )
    evidence_path = write_immutable_evidence(record, trades, EVIDENCE_OUT_DIR)
    print(f"Evidence written: {evidence_path}")

    m3_result = verify_evidence_package(evidence_path, MARKET_DB, version_id, REGISTRY)
    val_result = run_validation_suite(evidence_path, MARKET_DB, version_id, REGISTRY, expected_dataset_hash=None, parameter_configurations=None)
    risk_result = run_risk_analysis(evidence_path, MARKET_DB, version_id, REGISTRY, validation_result=val_result)
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))["evidence"]

    recorded_at = datetime.utcnow().isoformat() + "Z"
    history = build_system_lifecycle_chain(trading_system_id, version_id, evidence, m3_result, val_result, risk_result, recorded_at)
    trust_chain = run_trust_status(evidence_path, MARKET_DB, version_id, REGISTRY, trading_system_id, val_result, risk_result, history, [])
    trust = trust_chain[-1]

    snapshot = {
        "_provenance": {
            "generatedBy": "assemble_and_chain.py (M14 catalog-import real backtest)",
            "generatedAt": recorded_at,
            "note": "Real M3/M4/M5/M7 result computed from a faithful Python port of the real .mq5 signal engine, run against real market.db candles (Exness feed) - not fabricated, not a mock fixture.",
        },
        "tradingSystemId": trading_system_id, "versionId": version_id,
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
    Path(out_json).write_text(json.dumps(snapshot, indent=2, default=str), encoding="utf-8")
    print(f"Chain result written: {out_json}")
    print(f"  M3={m3_result.status} M4={val_result['overallStatus']} M5={risk_result['status']} M7={trust['status']}/{trust['reasonCode']}")
    print(f"  netProfit={metrics['netProfit']} profitFactor={metrics['profitFactor']} winRate={metrics['winRate']} maxDD%={metrics['maxDrawdown']['percent']}")


if __name__ == "__main__":
    main()
