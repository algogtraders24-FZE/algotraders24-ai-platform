"""
Gold Hedge -- real Evidence built from the EA's own real DEAL_POSITION_ID
log (v3.18 POSITIONLOG instrumentation), full 2025.01.01-2026.09.25 real
period (2 calendar years, resolving the WALK_FORWARD INCONCLUSIVE gap the
shorter 2026-only POSITIONLOG re-run hit). Same real methodology as
build_goldhedge_poslog_evidence.py (see that file's docstring for the
full real reasoning) - just a longer real Strategy Tester run.

4 positions were still open at the exact instant the test ended; matched
to the report's own raw Deals table end-of-test forced closes (deals
#1402-1405) by exact real profit arithmetic, same as the prior run (this
is literally the same 4 real positions - the extra history is earlier
in the period, so the tail is identical).

Run: python build_goldhedge_poslog_evidence_v2.py
"""
import csv
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "m2-evidence-engine"))
from evidence_engine import (  # noqa: E402
    parse_mt5_report_html, build_provenance, compute_metrics,
    assemble_evidence_record, write_immutable_evidence,
    run_data_integrity_checks, _clean_number,
)

REPORT_PATH = Path(r"C:\Users\om\OneDrive\Desktop\New folder\ReportTester-55963011.html")
POSLOG_CSV = Path(r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\Common\Files\GoldHedge_PositionLog_20260802.csv")
VERSION_ID = "GOLDHEDGE-v3.18-2025-2026-POSITIONLOG-FULLPERIOD"
OUT_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"

# Real end-of-test forced closes (report's own raw Deals table, deals
# #1402-1405, comment "end of test"), matched to the correct still-open
# position by exact profit math.
END_OF_TEST_CLOSES = {
    "1369": {"DealTicket": "1405", "Time": "2026.09.24 23:59:58", "Price": "4274.25", "Profit": "603.15", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
    "1389": {"DealTicket": "1404", "Time": "2026.09.24 23:59:58", "Price": "4273.84", "Profit": "-118.45", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
    "1392": {"DealTicket": "1403", "Time": "2026.09.24 23:59:58", "Price": "4273.84", "Profit": "-202.50", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
    "1401": {"DealTicket": "1402", "Time": "2026.09.24 23:59:58", "Price": "4274.25", "Profit": "173.80", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
}


def build_trades() -> list[dict]:
    rows = list(csv.DictReader(POSLOG_CSV.open(encoding="utf-8")))
    by_pos: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_pos[r["PositionID"]].append(r)

    trades = []
    for pid, recs in by_pos.items():
        ins = [r for r in recs if r["Entry"] == "DEAL_ENTRY_IN"]
        outs = [r for r in recs if r["Entry"] == "DEAL_ENTRY_OUT"]
        entry = ins[0]
        exit_ = outs[0] if outs else END_OF_TEST_CLOSES[pid]

        gross = float(exit_["Profit"])
        comm = float(entry["Commission"]) + float(exit_["Commission"])
        swap = float(entry["Swap"]) + float(exit_["Swap"])
        net = round(gross + comm + swap, 2)

        dt_entry = datetime.strptime(entry["Time"], "%Y.%m.%d %H:%M:%S")
        dt_exit = datetime.strptime(exit_["Time"], "%Y.%m.%d %H:%M:%S")

        trades.append({
            "timestamp": exit_["Time"], "symbol": "XAUUSD",
            "direction": "long" if entry["Type"] == "DEAL_TYPE_BUY" else "short",
            "entryPrice": float(entry["Price"]), "exitPrice": float(exit_["Price"]),
            "sl": None, "tp": None, "volume": float(entry["Volume"]),
            "profit": net, "rMultiple": None,
            "durationSeconds": (dt_exit - dt_entry).total_seconds(),
            "marketRegime": None,
            "exitReason": exit_["Comment"].split()[0].upper() if exit_["Comment"] else None,
            "grossProfit": round(gross, 2), "commission": round(comm, 2), "swap": round(swap, 2),
            "entryDealId": entry["DealTicket"], "exitDealId": exit_["DealTicket"],
            "positionId": pid,
        })

    trades.sort(key=lambda t: (t["timestamp"], int(t["exitDealId"])))
    return trades


def main() -> None:
    report_meta = parse_mt5_report_html(REPORT_PATH)
    trades = build_trades()

    integrity = run_data_integrity_checks(trades)
    if not integrity.ok:
        raise ValueError("Data integrity check failed:\n  - " + "\n  - ".join(integrity.issues))

    provenance = build_provenance(report_meta, REPORT_PATH, {"kind": "position_id_log", "file": POSLOG_CSV.name})
    initial_deposit = _clean_number(report_meta.get("initial_deposit"))
    metrics = compute_metrics(trades, initial_deposit=initial_deposit)

    print(f"netProfit={metrics['netProfit']} (report: {report_meta.get('report_net_profit')})")
    print(f"profitFactor={metrics['profitFactor']} (report: {report_meta.get('report_profit_factor')})")
    print(f"tradeCount={metrics['tradeCount']} (report: {report_meta.get('report_trade_count')})")

    record = assemble_evidence_record(
        VERSION_ID, trades, metrics, provenance, report_meta,
        source_adapter="mt5-position-id-log-v1",
    )
    out_path = write_immutable_evidence(record, trades, OUT_DIR)
    print(f"Evidence written: {out_path}")


if __name__ == "__main__":
    main()
