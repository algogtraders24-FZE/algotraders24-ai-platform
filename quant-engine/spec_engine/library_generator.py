"""
Option B — pre-computed strategy library (the actual LuxAlgo-style base:
their AI Backtesting Assistant is a retrieval system over ~10M pre-backtested
strategies, not a generator — see docs.luxalgo.com/docs/ai-backtesting).
We build our own version of that library on our own server with our own
quant_engine: no external API, no LLM, just batch backtesting a grid of
template_builder spec variations and storing every result.

Difference from LuxAlgo: our library entries carry a full spec, so any
result a user finds can still be turned into real MQL5/Pine code (LuxAlgo's
assistant only shows metrics and does not hand you code).
"""
import json
import os
import sqlite3

from .template_builder import build_spec
from .robustness import spec_walk_forward

DB_PATH = os.path.join(os.path.dirname(__file__), "strategy_library.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS library (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    symbol          TEXT NOT NULL,
    timeframe       TEXT NOT NULL,
    trigger_key     TEXT NOT NULL,
    filter_key      TEXT NOT NULL,
    risk_preset     TEXT NOT NULL,
    trades_total    INTEGER,
    win_rate_pct    REAL,
    profit_factor   REAL,
    total_return_pct REAL,
    max_drawdown_pct REAL,
    final_balance   REAL,
    -- walk-forward robustness (spec_engine.robustness.spec_walk_forward):
    -- same fixed spec re-run across N sequential out-of-sample folds, so a
    -- spec that only looked good over the full period thanks to one lucky
    -- stretch scores low here even if its full-period profit_factor is high.
    wf_valid_folds     INTEGER,
    wf_pct_profitable  REAL,
    wf_avg_fold_pf     REAL,
    wf_min_fold_pf     REAL,
    wf_robustness_score REAL,
    spec_json       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_library_symbol_tf ON library(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_library_pf ON library(profit_factor);
CREATE INDEX IF NOT EXISTS idx_library_dd ON library(max_drawdown_pct);
CREATE INDEX IF NOT EXISTS idx_library_robustness ON library(wf_robustness_score);
"""

# Parameter grids per trigger — kept intentionally moderate (~330 total
# combos with 5 filters x 3 risk presets) so a full rebuild finishes in
# well under a minute; expand freely once this runs as an offline job
# instead of an interactive demo.
TRIGGER_PARAM_GRID = {
    "rsi_extreme": [
        {"period": period, "oversold": ob[0], "overbought": ob[1]}
        for period in (7, 14, 21)
        for ob in ((20, 80), (25, 75), (30, 70))
    ],
    "ema_cross": [
        {"fast": f, "slow": s} for f, s in ((5, 20), (9, 21), (12, 26), (20, 50))
    ],
    "macd_cross": [
        {"fast": f, "slow": s, "signal": sig} for f, s, sig in ((12, 26, 9), (5, 35, 5), (8, 17, 9))
    ],
    "bb_reversion": [
        {"period": p, "mult": m} for p, m in ((20, 2.0), (20, 2.5), (14, 2.0))
    ],
    "bb_breakout": [
        {"period": p, "mult": m} for p, m in ((20, 2.0), (20, 2.5), (14, 2.0))
    ],
    "stoch_cross": [
        {"k_period": k, "d_period": 3, "oversold": 20, "overbought": 80} for k in (14, 21)
    ],
    "donchian_breakout": [
        {"period": p} for p in (20, 55)  # 20 = short-term, 55 = classic Turtle long-term
    ],
    "supertrend_flip": [
        {"period": p, "mult": m} for p, m in ((10, 3.0), (14, 2.0))
    ],
}

FILTER_PARAM_GRID = {
    "none": [{}],
    "ema_trend": [{"period": p} for p in (20, 50, 100)],
    "rsi_midline": [{"period": 14}],
    "adx_strength": [{"period": 14, "threshold": t} for t in (20, 25)],
}

RISK_KEYS = ("conservative", "standard", "aggressive")


def iter_grid_specs(symbol="XAUUSD", timeframe="1h"):
    """Yields (spec, trigger_key, filter_key, risk_key) for the full grid."""
    for trigger_key, param_list in TRIGGER_PARAM_GRID.items():
        for trigger_params in param_list:
            for filter_key, filter_param_list in FILTER_PARAM_GRID.items():
                for filter_params in filter_param_list:
                    for risk_key in RISK_KEYS:
                        pdesc = "_".join(f"{k}{v}" for k, v in trigger_params.items())
                        fdesc = "_".join(f"{k}{v}" for k, v in filter_params.items()) or "none"
                        name = f"{trigger_key}[{pdesc}]+{filter_key}[{fdesc}]+{risk_key}"
                        spec = build_spec(name, symbol=symbol, timeframe=timeframe,
                                           trigger_key=trigger_key, trigger_params=trigger_params,
                                           filter_key=filter_key, filter_params=filter_params,
                                           risk_key=risk_key)
                        yield spec, trigger_key, filter_key, risk_key


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    return conn


def build_library(df, run_spec_backtest, risk_config, symbol="XAUUSD", timeframe="1h",
                   progress_every=50):
    """Backtests the full grid and (re)populates the library table for this
    symbol/timeframe. df is the OHLCV DataFrame, run_spec_backtest/risk_config
    are passed in by the caller (spec_engine.runner.run_spec_backtest,
    engine.RiskConfig) to avoid this module importing quant_engine directly."""
    conn = get_conn()
    conn.execute("DELETE FROM library WHERE symbol=? AND timeframe=?", (symbol, timeframe))

    n = 0
    for spec, trigger_key, filter_key, risk_key in iter_grid_specs(symbol, timeframe):
        _, _, metrics = run_spec_backtest(df, spec, risk_config)
        wf = spec_walk_forward(df, spec, risk_config, run_spec_backtest, n_folds=5)
        conn.execute(
            "INSERT INTO library (name, symbol, timeframe, trigger_key, filter_key, risk_preset, "
            "trades_total, win_rate_pct, profit_factor, total_return_pct, max_drawdown_pct, "
            "final_balance, wf_valid_folds, wf_pct_profitable, wf_avg_fold_pf, wf_min_fold_pf, "
            "wf_robustness_score, spec_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (spec["name"], symbol, timeframe, trigger_key, filter_key, risk_key,
             metrics.get("trades_total"), metrics.get("win_rate_pct"), metrics.get("profit_factor"),
             metrics.get("total_return_pct"), metrics.get("max_drawdown_pct"), metrics.get("final_balance"),
             wf.get("valid_folds"), wf.get("pct_folds_profitable"), wf.get("avg_fold_pf"),
             wf.get("min_fold_pf"), wf.get("robustness_score"),
             json.dumps(spec)),
        )
        n += 1
        if progress_every and n % progress_every == 0:
            print(f"  ...{n} strategies backtested")

    conn.commit()
    conn.close()
    return n
