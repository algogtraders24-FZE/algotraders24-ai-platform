"""
Gold Hedge -- real Evidence built from the EA's own real DEAL_POSITION_ID
log (v3.18 POSITIONLOG instrumentation), not the FIFO-by-timestamp
heuristic in evidence_engine.py's reconcile_deals_to_trades (which is
documented there as a best-effort reconstruction that can mispair
same-direction concurrent positions -- confirmed happening on Gold
Hedge's real AggressiveMode data). MT5 exposes an authoritative real
per-deal Position ID (HistoryDealGetInteger(deal, DEAL_POSITION_ID)) that
the native .htm/.xlsx report format never surfaces; the v3.18 EA build
logs it directly during the real Strategy Tester run via
OnTradeTransaction, so every real trade here is paired by MT5's own
internal bookkeeping, not inferred.

4 positions were still open at the exact instant the test ended; MT5's
Strategy Tester force-closes these itself (comment "end of test") as
part of its own shutdown sequence, which fires after the EA's own
OnTradeTransaction stops logging -- so those 4 closes are read directly
from the report's own raw Deals table instead (deals #632-635) and
matched to the correct position by exact real profit-math (entry price,
direction, and volume uniquely determine the expected profit at a given
exit price to the cent -- verified against all 4, no guessing).

Cross-check against the report's own stated Results (zero delta):
netProfit 38,001.50, profitFactor 1.41 (1.4095 unrounded), tradeCount
317, win rate 41.01% -- all exact.

Run: python build_goldhedge_poslog_evidence.py
"""
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent / "m2-evidence-engine"))
from evidence_engine import (  # noqa: E402
    parse_mt5_report_html, build_provenance, compute_metrics,
    assemble_evidence_record, write_immutable_evidence,
    run_data_integrity_checks, _clean_number,
)

REPORT_PATH = Path(r"C:\Users\om\OneDrive\Desktop\New folder\ReportTester-gold hedge.html")
POSLOG_CSV = Path(r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\Common\Files\GoldHedge_PositionLog_20260802.csv")
VERSION_ID = "GOLDHEDGE-v3.18-2026-POSITIONLOG"
OUT_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"

# Real end-of-test forced closes (report's own raw Deals table, deals
# #632-635, comment "end of test"), matched to the correct still-open
# position by exact profit math -- see module docstring.
END_OF_TEST_CLOSES = {
    "599": {"DealTicket": "635", "Time": "2026.09.24 23:59:58", "Price": "4274.25", "Profit": "603.15", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
    "619": {"DealTicket": "634", "Time": "2026.09.24 23:59:58", "Price": "4273.84", "Profit": "-118.45", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
    "622": {"DealTicket": "633", "Time": "2026.09.24 23:59:58", "Price": "4273.84", "Profit": "-202.50", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
    "631": {"DealTicket": "632", "Time": "2026.09.24 23:59:58", "Price": "4274.25", "Profit": "173.80", "Commission": "0.00", "Swap": "0.00", "Comment": "end of test"},
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

        t_entry = entry["Time"]
        t_exit = exit_["Time"]
        from datetime import datetime
        dt_entry = datetime.strptime(t_entry, "%Y.%m.%d %H:%M:%S")
        dt_exit = datetime.strptime(t_exit, "%Y.%m.%d %H:%M:%S")

        trades.append({
            "timestamp": t_exit, "symbol": "XAUUSD",
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
