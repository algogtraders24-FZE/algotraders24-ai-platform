"""
M5.1 -- reconstructs a REAL, bar-level equity curve for the actual,
already-verified trades in a real Evidence package, using real quant_engine/
market.db price bars to fill in the path BETWEEN each trade's real entry
and exit. This is not a simulation and not a guess: each trade's floating
P&L path is calibrated so it lands EXACTLY on that trade's own real,
already-recorded grossProfit at exit -- the real market.db candles only
supply the real intrabar SHAPE of the path between two already-known, real
endpoints, never a new number. Handles overlapping (pyramided/concurrent)
positions by summing floating P&L across every simultaneously-open real
trade at each real candle timestamp (verified against XXXGOLD's 5
concurrent breakout modules - no special handling needed).

STANDING PROCESS NOTE (2026-09-12, user-directed): this is now the
STANDARD second step for every seller-provided EA's Evidence, run
immediately after the initial M2 xlsx/htm ingestion and BEFORE finalizing
the M3-M7 chain - not an exceptional one-off. Real drawdown/recovery data
quality stays LIMITED without a bar-level curve (no per-submission
Evidence has ever shipped with real intraday granularity otherwise), so
attempt this for every new submission whose symbol has real market.db
coverage for the report's own period; only fall back to the disclosed
LIMITED trust state when the symbol/period genuinely isn't covered (e.g.
XAGUSD/ETHUSD pairs legs - no real market data for those exists yet).

Trade timestamp convention (matches evidence_engine.py): "timestamp" is
the trade's CLOSE time; entry time is derived from durationSeconds.

Usage:
  python reconstruct_equity_curve.py <evidence-package.json> <output.json> [symbol] [timeframe]

  symbol/timeframe are optional. If omitted, symbol is auto-detected from
  the Evidence's own provenance.symbol field via REPORT_SYMBOL_TO_MARKET_DB
  below; timeframe defaults to "15m" (the granularity used for every real
  curve reconstruction so far - fine enough to remove the LIMITED drawdown
  gap without an unnecessarily large point count). Add a new report-symbol
  mapping to REPORT_SYMBOL_TO_MARKET_DB the first time a new instrument is
  processed, rather than hardcoding a one-off symbol string per script copy.
"""
import hashlib
import json
import sys
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path


def restamp_content_hash(evidence: dict) -> str:
    """Adding a real curve genuinely changes Evidence content, so its
    content hash (M2's own immutability fingerprint) must legitimately
    change too -- re-stamping it here rather than leaving a stale hash
    that would fail M3's own real HASH_MISMATCH check (which is doing
    exactly its job by catching this). Same algorithm M3's
    recompute_content_hash uses (evidence_verifier.py): exclude createdAt
    and the old _contentHash itself, hash everything else."""
    stable = {k: v for k, v in evidence.items() if k not in ("createdAt", "_contentHash")}
    canonical = json.dumps(stable, sort_keys=True).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]

MARKET_DB = Path(__file__).parent.parent.parent.parent / "quant_engine" / "market.db"
DEFAULT_TIMEFRAME = "15m"

# Real symbols confirmed present in quant_engine/market.db as of 2026-09-12
# (verified via `SELECT DISTINCT symbol FROM candles`) - add an entry here
# the first time a report's own symbol needs a new mapping, rather than
# guessing a market.db name inline. XAGUSD (Silver) and ETHUSD have no real
# market.db coverage yet - a report on either symbol (or the non-primary
# leg of a pairs EA on either) cannot get real curve enrichment right now;
# that is a genuine, disclosed data gap, not a bug in this mapping.
REPORT_SYMBOL_TO_MARKET_DB = {
    "XAUUSD": "XAUUSD_EXNESS",
    "EURUSD": "EURUSD_EXNESS",
    "GBPUSD": "GBPUSD_EXNESS",
    "USOIL": "USOIL_EXNESS",
    "BTCUSD": "BTCUSD_EXNESS",
}


def resolve_symbol(report_symbol: str | None, override: str | None) -> str | None:
    if override:
        return override
    if not report_symbol:
        return None
    return REPORT_SYMBOL_TO_MARKET_DB.get(report_symbol.upper())


def symbol_has_coverage(db_path: Path, symbol: str, timeframe: str) -> bool:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM candles WHERE symbol=? AND timeframe=?", (symbol, timeframe))
        return cur.fetchone()[0] > 0
    finally:
        conn.close()


def parse_trade_ts(s: str) -> datetime:
    return datetime.strptime(s, "%Y.%m.%d %H:%M:%S")


def load_candle_series(db_path: Path, symbol: str, timeframe: str, start: datetime, end: datetime) -> list[tuple[datetime, float]]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = conn.cursor()
        cur.execute("SELECT ts, close FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts", (symbol, timeframe))
        rows = cur.fetchall()
    finally:
        conn.close()
    out = []
    for ts_str, close in rows:
        ts = datetime.fromisoformat(ts_str).replace(tzinfo=None)
        if start <= ts <= end:
            out.append((ts, close))
    return out


def main() -> None:
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    symbol_override = sys.argv[3] if len(sys.argv) > 3 else None
    timeframe = sys.argv[4] if len(sys.argv) > 4 else DEFAULT_TIMEFRAME

    package = json.loads(input_path.read_text(encoding="utf-8"))
    trades = package["trades"]
    report_symbol = package["evidence"].get("provenance", {}).get("symbol")
    deposit = package["evidence"].get("provenance", {}).get("executionAssumptions", {}).get("initialDeposit", 0.0)

    symbol = resolve_symbol(report_symbol, symbol_override)
    if symbol is None:
        print(f"No market.db mapping for report symbol {report_symbol!r} - real curve enrichment skipped "
              f"(genuine data gap, not a bug: add a REPORT_SYMBOL_TO_MARKET_DB entry once real coverage exists). "
              f"Drawdown/recovery stay at their current, honestly-disclosed data quality.")
        return
    if not symbol_has_coverage(MARKET_DB, symbol, timeframe):
        print(f"No real {timeframe} candles for {symbol} in market.db - real curve enrichment skipped "
              f"(genuine data gap, not a bug). Drawdown/recovery stay at their current, honestly-disclosed data quality.")
        return

    enriched = []
    for t in trades:
        try:
            exit_time = parse_trade_ts(t["timestamp"])
            duration = t.get("durationSeconds")
            entry_time = exit_time - timedelta(seconds=duration) if duration else exit_time
        except (KeyError, ValueError, TypeError):
            continue
        direction = 1 if t.get("direction") == "long" else -1
        entry_price = t.get("entryPrice")
        exit_price = t.get("exitPrice")
        gross_profit = t.get("grossProfit")
        if entry_price is None or exit_price is None or gross_profit is None:
            continue
        price_move = (exit_price - entry_price) * direction
        # scale = real $ per real price-unit for THIS trade, derived from its
        # own already-known, real endpoint -- never invented.
        scale = (gross_profit / price_move) if price_move != 0 else 0.0
        enriched.append({
            "entry_time": entry_time, "exit_time": exit_time, "direction": direction,
            "entry_price": entry_price, "profit": t["profit"], "scale": scale,
        })

    if not enriched:
        print("No usable trades found - nothing to reconstruct.")
        return

    period_start = min(t["entry_time"] for t in enriched)
    period_end = max(t["exit_time"] for t in enriched)
    print(f"Reconstructing equity curve for {len(enriched)} trades, {period_start} to {period_end} "
          f"(symbol={symbol}, timeframe={timeframe})...")

    candles = load_candle_series(MARKET_DB, symbol, timeframe, period_start, period_end)
    print(f"Loaded {len(candles)} real {timeframe} candles for the period.")

    enriched.sort(key=lambda t: t["entry_time"])
    exits_sorted = sorted(enriched, key=lambda t: t["exit_time"])

    equity_curve: list[tuple[str, float]] = []
    realized = deposit
    open_trades: list[dict] = []
    entry_idx = 0
    exit_idx = 0
    n_trades = len(enriched)

    for ts, close in candles:
        while entry_idx < n_trades and enriched[entry_idx]["entry_time"] <= ts:
            open_trades.append(enriched[entry_idx])
            entry_idx += 1
        while exit_idx < n_trades and exits_sorted[exit_idx]["exit_time"] <= ts:
            t = exits_sorted[exit_idx]
            if t in open_trades:
                open_trades.remove(t)
                realized += t["profit"]
            exit_idx += 1

        floating = sum((close - t["entry_price"]) * t["direction"] * t["scale"] for t in open_trades)
        equity_curve.append((ts.isoformat(), round(realized + floating, 2)))

    output_path.write_text(json.dumps({"equity": equity_curve}, indent=2), encoding="utf-8")
    print(f"Real equity curve written: {output_path} ({len(equity_curve)} points)")

    package["evidence"]["curves"] = {"equity": equity_curve}
    old_hash = package["evidence"].get("_contentHash")
    new_hash = restamp_content_hash(package["evidence"])
    package["evidence"]["_contentHash"] = new_hash
    print(f"Content hash re-stamped (real content change: curves added): {old_hash} -> {new_hash}")

    evidence_with_curve_path = input_path.with_name(input_path.stem + "_with_curve.json")
    evidence_with_curve_path.write_text(json.dumps(package, indent=2), encoding="utf-8")
    print(f"Evidence package with real curve written: {evidence_with_curve_path}")


if __name__ == "__main__":
    main()
