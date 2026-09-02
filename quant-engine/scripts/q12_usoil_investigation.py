"""
Q1.2 Part 1 - USOIL_EXNESS cross-timeframe coverage investigation.
Read-only. Tests a specific hypothesis: finer timeframes (1h) reveal
short outages that get "absorbed" once resampled to a coarser timeframe
(4h/1d), because a coarser bar only needs ONE real tick anywhere in its
window to exist, even if the finer series has a real hole inside that
same window. This would be legitimate aggregation behavior, not a bug -
the task is to find hard evidence for or against it, not to assume it.
"""
import json
import os
import sqlite3
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine", "market.db")
SYMBOL = os.environ.get("Q12_SYMBOL", "USOIL_EXNESS")


def load_ts(conn, symbol, timeframe):
    rows = conn.execute("SELECT ts FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts", (symbol, timeframe)).fetchall()
    return pd.to_datetime(pd.Series([r[0] for r in rows]), utc=True, format="mixed")


def main():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)

    with open(os.path.join(os.path.dirname(__file__), "..", "output", "q11_gap_registry.json")) as f:
        registry = json.load(f)

    entries = {e["timeframe"]: e for e in registry["entries"] if e["symbol"] == SYMBOL}

    ts_1h = load_ts(conn, SYMBOL, "1h")
    ts_4h = load_ts(conn, SYMBOL, "4h")
    ts_1d = load_ts(conn, SYMBOL, "1d")
    ts_1m = load_ts(conn, SYMBOL, "1m")

    print(f"1h rows: {len(ts_1h)}  range: {ts_1h.iloc[0]} -> {ts_1h.iloc[-1]}")
    print(f"4h rows: {len(ts_4h)}  range: {ts_4h.iloc[0]} -> {ts_4h.iloc[-1]}")
    print(f"1d rows: {len(ts_1d)}  range: {ts_1d.iloc[0]} -> {ts_1d.iloc[-1]}")
    print(f"1m rows: {len(ts_1m)}  range: {ts_1m.iloc[0]} -> {ts_1m.iloc[-1]}")
    print()

    # non-closure gaps recorded for 1h (from the real registry, unchanged)
    gaps_1h = [g for g in entries["1h"]["gaps"]]
    print(f"1h non-closure gaps: {len(gaps_1h)}  total missing days: {sum((pd.Timestamp(g['end'])-pd.Timestamp(g['start'])).total_seconds() for g in gaps_1h)/86400:.2f}")

    ts_4h_set = set(ts_4h.tolist())
    ts_1d_set = set(ts_1d.tolist())

    absorbed_by_4h = 0
    absorbed_by_1d = 0
    absorbed_days_4h = 0.0
    absorbed_days_1d = 0.0
    not_absorbed = []

    for g in gaps_1h:
        gs, ge = pd.Timestamp(g["start"]), pd.Timestamp(g["end"])
        dur_days = (ge - gs).total_seconds() / 86400.0

        # does ANY 4h bar start inside [gs, ge)? if so, and 1m ticks actually
        # exist somewhere in that 4h bar's own window, the 4h series "papers
        # over" this 1h-visible hole.
        covering_4h = [t for t in ts_4h_set if gs <= t < ge]
        covering_1d = [t for t in ts_1d_set if gs <= t < ge]

        if covering_4h:
            absorbed_by_4h += 1
            absorbed_days_4h += dur_days
        else:
            not_absorbed.append(g)
        if covering_1d:
            absorbed_by_1d += 1
            absorbed_days_1d += dur_days

    print(f"\n1h gaps that a 4h bar exists inside of (absorbed): {absorbed_by_4h}/{len(gaps_1h)}  ({absorbed_days_4h:.2f} of {sum((pd.Timestamp(g['end'])-pd.Timestamp(g['start'])).total_seconds() for g in gaps_1h)/86400:.2f} missing-days)")
    print(f"1h gaps that a 1d bar exists inside of (absorbed): {absorbed_by_1d}/{len(gaps_1h)}  ({absorbed_days_1d:.2f} days)")

    print(f"\n1h gaps NOT absorbed by 4h (real hole at every timeframe): {len(not_absorbed)}")
    for g in sorted(not_absorbed, key=lambda x: -(pd.Timestamp(x["end"])-pd.Timestamp(x["start"])).total_seconds())[:10]:
        dur = (pd.Timestamp(g["end"]) - pd.Timestamp(g["start"])).total_seconds() / 86400
        print(f"  {g['gapType']:15s} {g['severity']:8s} {dur:6.2f}d  {g['start'][:16]} -> {g['end'][:16]}")

    # cross-check: for the biggest few absorbed gaps, confirm real 1m ticks
    # actually exist inside the covering 4h bar's own window (not just that
    # a 4h *label* exists - could still be a resampling artifact if the row
    # exists but is empty/carried-forward).
    print("\n--- spot-check: do covering 4h bars have real distinct OHLC (not a flat carried-forward candle)? ---")
    sample_gaps = sorted([g for g in gaps_1h if [t for t in ts_4h_set if pd.Timestamp(g["start"]) <= t < pd.Timestamp(g["end"])]],
                          key=lambda x: -(pd.Timestamp(x["end"])-pd.Timestamp(x["start"])).total_seconds())[:5]
    for g in sample_gaps:
        gs, ge = pd.Timestamp(g["start"]), pd.Timestamp(g["end"])
        covering = [t for t in ts_4h_set if gs <= t < ge]
        for t in covering[:1]:
            row = conn.execute("SELECT ts,open,high,low,close FROM candles WHERE symbol=? AND timeframe='4h' AND ts=?", (SYMBOL, t.isoformat())).fetchone()
            flat = row and row[1] == row[2] == row[3] == row[4]
            print(f"  gap {g['start'][:16]}->{g['end'][:16]} ({(ge-gs).total_seconds()/86400:.1f}d) covered by 4h bar {t} row={row} flat={flat}")

    conn.close()


if __name__ == "__main__":
    main()
