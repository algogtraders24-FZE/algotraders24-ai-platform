"""
SQLite-backed market-data + backtest-results store for the R&D engine.
One file (market.db) holds: symbol metadata, OHLCV candles across
timeframes, and every strategy run's trades/equity/summary so results
are comparable over time instead of living in scattered CSVs.
"""
import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "market.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS symbols (
    symbol          TEXT PRIMARY KEY,
    description     TEXT,
    contract_size   REAL NOT NULL,   -- units per 1.0 lot (100 oz gold, 100000 FX)
    price_scale     REAL NOT NULL DEFAULT 1.0  -- divide raw source price by this
);

CREATE TABLE IF NOT EXISTS candles (
    symbol     TEXT NOT NULL,
    timeframe  TEXT NOT NULL,   -- '5m','15m','30m','1h','4h','1d'
    ts         TEXT NOT NULL,   -- ISO8601 UTC-naive timestamp
    open       REAL NOT NULL,
    high       REAL NOT NULL,
    low        REAL NOT NULL,
    close      REAL NOT NULL,
    volume     REAL,
    PRIMARY KEY (symbol, timeframe, ts)
);
CREATE INDEX IF NOT EXISTS idx_candles_lookup ON candles(symbol, timeframe, ts);

CREATE TABLE IF NOT EXISTS strategy_runs (
    run_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy     TEXT NOT NULL,
    symbol       TEXT NOT NULL,
    timeframe    TEXT NOT NULL,
    params_json  TEXT NOT NULL,
    start_balance REAL NOT NULL,
    created_at   TEXT NOT NULL,
    -- summary metrics, filled after the run
    trades_total     INTEGER,
    win_rate_pct      REAL,
    profit_factor     REAL,
    total_return_pct  REAL,
    max_drawdown_pct  REAL,
    final_balance     REAL
);

CREATE TABLE IF NOT EXISTS trades (
    run_id      INTEGER NOT NULL REFERENCES strategy_runs(run_id),
    entry_time  TEXT NOT NULL,
    exit_time   TEXT NOT NULL,
    direction   INTEGER NOT NULL,   -- 1 long, -1 short
    entry_price REAL NOT NULL,
    exit_price  REAL NOT NULL,
    volume      REAL NOT NULL,
    pnl         REAL NOT NULL,
    reason      TEXT NOT NULL       -- SL / TP / PARTIAL
);
CREATE INDEX IF NOT EXISTS idx_trades_run ON trades(run_id);

CREATE TABLE IF NOT EXISTS equity_curve (
    run_id  INTEGER NOT NULL REFERENCES strategy_runs(run_id),
    ts      TEXT NOT NULL,
    balance REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_equity_run ON equity_curve(run_id);

CREATE TABLE IF NOT EXISTS spread_stats (
    symbol      TEXT NOT NULL,
    source      TEXT NOT NULL,     -- e.g. 'exness_pro_tick'
    hour        INTEGER,           -- 0-23 server hour, NULL = overall
    avg_spread  REAL NOT NULL,
    median_spread REAL NOT NULL,
    min_spread  REAL NOT NULL,
    max_spread  REAL NOT NULL,
    n_ticks     INTEGER NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (symbol, source, hour)
);
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL;")
    return conn


def init_db():
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()
    print(f"DB ready at {DB_PATH}")


if __name__ == "__main__":
    init_db()
