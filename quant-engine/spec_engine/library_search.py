"""
Search/rank the pre-computed strategy library — the LuxAlgo-style
"match my criteria" query. Pure SQL, no AI, no external API.
"""
import json

from .library_generator import get_conn


def find_strategies(symbol="XAUUSD", timeframe="1h", min_trades=30,
                     min_win_rate=None, min_profit_factor=None, max_drawdown_pct=None,
                     trigger_key=None, filter_key=None, min_pct_folds_profitable=None,
                     order_by="profit_factor", top_n=10):
    """Returns a list of dict rows (metrics + robustness + parsed spec), best
    first. Set min_pct_folds_profitable (e.g. 60) to require the spec held up
    in most walk-forward folds, not just the full-period backtest — the
    defense against a result that only looked good thanks to one lucky
    stretch. order_by="robustness" sorts by the walk-forward composite score
    instead of the raw full-period profit factor."""
    conn = get_conn()
    where = ["symbol=?", "timeframe=?", "trades_total>=?"]
    params = [symbol, timeframe, min_trades]

    if min_win_rate is not None:
        where.append("win_rate_pct>=?"); params.append(min_win_rate)
    if min_profit_factor is not None:
        where.append("profit_factor>=?"); params.append(min_profit_factor)
    if max_drawdown_pct is not None:
        # max_drawdown_pct is stored negative (e.g. -18.2); caller passes a
        # positive magnitude cap (e.g. 20 -> keep strategies with dd >= -20)
        where.append("max_drawdown_pct>=?"); params.append(-abs(max_drawdown_pct))
    if trigger_key is not None:
        where.append("trigger_key=?"); params.append(trigger_key)
    if filter_key is not None:
        where.append("filter_key=?"); params.append(filter_key)
    if min_pct_folds_profitable is not None:
        where.append("wf_pct_profitable>=?"); params.append(min_pct_folds_profitable)

    order_col = {"profit_factor": "profit_factor", "win_rate": "win_rate_pct",
                 "return": "total_return_pct", "drawdown": "max_drawdown_pct",
                 "robustness": "wf_robustness_score"}.get(order_by, "profit_factor")
    direction = "DESC"
    if order_by == "drawdown":
        direction = "DESC"  # max_drawdown_pct is negative; DESC = least-negative (smallest) first

    q = (f"SELECT name, trigger_key, filter_key, risk_preset, trades_total, win_rate_pct, "
         f"profit_factor, total_return_pct, max_drawdown_pct, final_balance, "
         f"wf_valid_folds, wf_pct_profitable, wf_avg_fold_pf, wf_min_fold_pf, wf_robustness_score, "
         f"spec_json FROM library WHERE {' AND '.join(where)} "
         f"ORDER BY {order_col} {direction} LIMIT ?")
    params.append(top_n)

    rows = conn.execute(q, params).fetchall()
    conn.close()

    cols = ["name", "trigger_key", "filter_key", "risk_preset", "trades_total", "win_rate_pct",
            "profit_factor", "total_return_pct", "max_drawdown_pct", "final_balance",
            "wf_valid_folds", "wf_pct_profitable", "wf_avg_fold_pf", "wf_min_fold_pf",
            "wf_robustness_score", "spec_json"]
    results = []
    for r in rows:
        d = dict(zip(cols, r))
        d["spec"] = json.loads(d.pop("spec_json"))
        results.append(d)
    return results


def library_stats(symbol="XAUUSD", timeframe="1h"):
    conn = get_conn()
    row = conn.execute(
        "SELECT COUNT(*), SUM(CASE WHEN profit_factor>1 THEN 1 ELSE 0 END), "
        "AVG(profit_factor), MAX(profit_factor) FROM library WHERE symbol=? AND timeframe=? "
        "AND trades_total>=30", (symbol, timeframe)).fetchone()
    conn.close()
    total, profitable, avg_pf, max_pf = row
    return {"total": total, "profitable_pf_gt_1": profitable, "avg_pf": avg_pf, "max_pf": max_pf}
