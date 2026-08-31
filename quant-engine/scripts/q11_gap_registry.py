"""
Q1.1.1-6, 13-18 - the canonical gap registry. Read-only. Builds a
deterministic, typed, versioned data-quality registry from real
market.db timestamps - never inferred from config, never guessed.

Session model (Q1.1.13): every _EXNESS symbol except BTCUSD closes
weekly (standard FX/CFD convention); BTCUSD trades continuously. The
exact weekly closure window is derived EMPIRICALLY from this specific
provider's own data (not assumed from a textbook calendar) by finding
the modal Friday-start gap duration in a clean symbol's 1h series.
Individual public holidays are NOT modeled as a full exchange calendar
(that is out of scope - documented as a known limitation in
Q1.1_GAP_POLICY.md); a Thu/Fri/Sat-starting gap up to 4 days is treated
as an extended (holiday-adjacent) weekend closure, everything else
non-closure is a real gap.

Q1.2 addition (rule v2, quant-engine/reports/Q1.2_USOIL_COVERAGE_INVESTIGATION.md):
EXPECTED_SESSION_BREAK - a short (1-4h) DAILY gap starting 20:00-23:00
UTC, found empirically to recur on ~74% of eligible weekdays for
USOIL_EXNESS (510 of ~686 trading days) and similarly for
XAUUSD_EXNESS/XAUUSD_ZS_EXNESS, but only 6-8 times total (not a
systematic pattern) for EURUSD/GBPUSD/BTCUSD - a genuine, provider-side
daily rollover specific to these commodity/metal instruments, not a
data-quality defect. Detected by time pattern alone (not a per-symbol
allowlist), so the evidence that commodities show it far more often
than FX pairs emerges from the data, not from an assumption baked into
the rule.

Output: quant-engine/output/q11_gap_registry.json (also mirrored as a
generated frontend/data/quant-lite-gap-registry.ts by
q11_generate_frontend_registry.py).
"""
import hashlib
import json
import os
import sqlite3
from datetime import timedelta

import pandas as pd

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "quant_engine", "market.db")
AUDIT_RULE_VERSION = "q1.2-gap-rules-v2"

CONTINUOUS_SYMBOLS = {"BTCUSD_EXNESS"}  # trades 24/7 - no expected weekly closure
EXPECTED_MIN = {"1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440}

# Weekly-closure detection window, in hours - a gap starting Thu/Fri/Sat
# whose duration falls in this band is treated as an EXPECTED weekly (or
# holiday-extended) market closure. Upper bound (96h = 4 days) covers a
# 3-day-weekend-plus-holiday-Monday case without swallowing a genuine
# multi-week provider outage.
CLOSURE_MIN_HOURS = 20.0
CLOSURE_MAX_HOURS = 96.0
CLOSURE_START_WEEKDAYS = {3, 4, 5}  # Mon=0 ... Thu=3, Fri=4, Sat=5

# Q1.2 - daily rollover/session-break window, evidenced empirically (see
# module docstring): 1-4h gap starting 20:00-23:00 UTC, any weekday.
# Checked before the generic PARTIAL_DATA/TEMPORAL_GAP fallback since it
# is otherwise indistinguishable in duration from an ordinary short gap.
SESSION_BREAK_MIN_HOURS = 1.0
SESSION_BREAK_MAX_HOURS = 4.0
SESSION_BREAK_START_HOURS = {20, 21, 22}

# Thresholds (documented, fixed before inspecting per-symbol outcomes -
# see Q1.1_GAP_POLICY.md "Threshold Rationale"):
TEMPORAL_GAP_MAX_DAYS = 14.0       # isolated non-closure gap up to this = TEMPORAL_GAP
LOW_FREQ_RUN_MIN_COUNT = 3          # 3+ consecutive near-weekly gaps = a LOW_FREQUENCY_SEGMENT
LOW_FREQ_GAP_HOURS = (150.0, 190.0)  # ~168h (7 days) +/- tolerance
NO_DATA_HIGH_DAYS = 90.0            # NO_DATA gap > this = CRITICAL, else HIGH


def load_ts(conn, symbol, timeframe):
    rows = conn.execute("SELECT ts FROM candles WHERE symbol=? AND timeframe=? ORDER BY ts", (symbol, timeframe)).fetchall()
    return pd.to_datetime(pd.Series([r[0] for r in rows]), utc=True, format="mixed")


def classify_gap(prev_ts, next_ts, symbol, timeframe):
    """Returns (gapType, severity) for a single gap between two consecutive
    rows, or (None, None) if this is just the normal expected single-bar
    interval - NOT a gap at all. Tolerance is 1.5x the expected interval
    so ordinary jitter (e.g. a bar landing a few seconds early/late)
    never gets misclassified as a real gap."""
    duration = next_ts - prev_ts
    expected = timedelta(minutes=EXPECTED_MIN[timeframe])
    if duration <= expected * 1.5:
        return None, None

    hours = duration.total_seconds() / 3600.0
    days = hours / 24.0

    if symbol not in CONTINUOUS_SYMBOLS:
        weekday = prev_ts.weekday()
        if CLOSURE_MIN_HOURS <= hours <= CLOSURE_MAX_HOURS and weekday in CLOSURE_START_WEEKDAYS:
            return "EXPECTED_MARKET_CLOSURE", "NONE"
        if SESSION_BREAK_MIN_HOURS <= hours <= SESSION_BREAK_MAX_HOURS and prev_ts.hour in SESSION_BREAK_START_HOURS:
            return "EXPECTED_SESSION_BREAK", "NONE"

    if LOW_FREQ_GAP_HOURS[0] <= hours <= LOW_FREQ_GAP_HOURS[1]:
        # candidate weekly-only-bar gap - severity assigned when runs are merged (see below)
        return "_WEEKLY_CANDIDATE", None

    if days > TEMPORAL_GAP_MAX_DAYS:
        severity = "CRITICAL" if days > NO_DATA_HIGH_DAYS else "HIGH"
        return "NO_DATA", severity

    if days >= 3.0:
        return "TEMPORAL_GAP", "MEDIUM"

    return "PARTIAL_DATA", "LOW"


def merge_weekly_runs(gaps):
    """Collapses runs of >= LOW_FREQ_RUN_MIN_COUNT consecutive _WEEKLY_CANDIDATE
    gaps into one LOW_FREQUENCY_SEGMENT interval; a lone 1-2 candidate gap is
    just a normal (slightly long) EXPECTED_MARKET_CLOSURE-adjacent TEMPORAL_GAP."""
    out = []
    i = 0
    while i < len(gaps):
        g = gaps[i]
        if g["gapType"] != "_WEEKLY_CANDIDATE":
            out.append(g)
            i += 1
            continue
        run = [g]
        j = i + 1
        while j < len(gaps) and gaps[j]["gapType"] == "_WEEKLY_CANDIDATE":
            run.append(gaps[j])
            j += 1
        if len(run) >= LOW_FREQ_RUN_MIN_COUNT:
            seg_start = run[0]["start"]
            seg_end = run[-1]["end"]
            seg_days = (pd.Timestamp(seg_end) - pd.Timestamp(seg_start)).total_seconds() / 86400.0
            severity = "HIGH" if seg_days > 30 else "MEDIUM"
            out.append({"start": seg_start, "end": seg_end, "gapType": "LOW_FREQUENCY_SEGMENT", "severity": severity})
        else:
            for r in run:
                r2 = dict(r)
                days = (pd.Timestamp(r2["end"]) - pd.Timestamp(r2["start"])).total_seconds() / 86400.0
                r2["gapType"] = "TEMPORAL_GAP"
                r2["severity"] = "MEDIUM" if days >= 3 else "LOW"
                out.append(r2)
        i = j
    return out


def audit_pair(conn, symbol, timeframe):
    ts = load_ts(conn, symbol, timeframe)
    if len(ts) < 2:
        return None

    raw_gaps = []
    closure_s = 0.0
    session_break_s = 0.0
    session_break_count = 0
    ts_vals = ts.values  # numpy datetime64[ns] - avoids per-row pandas Timestamp overhead in the hot loop
    ts_list = ts.tolist()  # list of pandas Timestamps, aligned with ts_vals, for the (rarer) classify_gap calls
    prev_dt = ts_vals[0]
    prev_ts_obj = ts_list[0]
    expected_ns = EXPECTED_MIN[timeframe] * 60 * 1_000_000_000 * 1.5
    for k in range(1, len(ts_vals)):
        next_dt = ts_vals[k]
        diff_ns = (next_dt - prev_dt).astype("int64")
        if diff_ns <= expected_ns:
            prev_dt, prev_ts_obj = next_dt, ts_list[k]
            continue
        next_ts_obj = ts_list[k]
        gtype, sev = classify_gap(prev_ts_obj, next_ts_obj, symbol, timeframe)
        if gtype == "EXPECTED_MARKET_CLOSURE":
            closure_s += diff_ns / 1e9
        elif gtype == "EXPECTED_SESSION_BREAK":
            session_break_s += diff_ns / 1e9
            session_break_count += 1
        elif gtype is not None:
            raw_gaps.append({"start": prev_ts_obj.isoformat(), "end": next_ts_obj.isoformat(), "gapType": gtype, "severity": sev})
        prev_dt, prev_ts_obj = next_dt, next_ts_obj

    gaps = merge_weekly_runs(raw_gaps)

    total_range_s = (ts.iloc[-1] - ts.iloc[0]).total_seconds()
    is_continuous = symbol in CONTINUOUS_SYMBOLS
    expected_trading_s = total_range_s if is_continuous else (total_range_s - closure_s - session_break_s)

    missing_s = sum((pd.Timestamp(g["end"]) - pd.Timestamp(g["start"])).total_seconds() for g in gaps)
    covered_s = max(expected_trading_s - missing_s, 0.0)
    coverage_pct = round((covered_s / expected_trading_s) * 100, 2) if expected_trading_s > 0 else 0.0

    largest_gap_days = round(max([(pd.Timestamp(g["end"]) - pd.Timestamp(g["start"])).total_seconds() / 86400.0 for g in gaps], default=0.0), 2)

    return {
        "symbol": symbol, "timeframe": timeframe,
        "minTs": ts.iloc[0].isoformat(), "maxTs": ts.iloc[-1].isoformat(),
        "rows": int(len(ts)),
        "sessionModel": "CONTINUOUS" if is_continuous else "WEEKLY_CLOSURE",
        "coveragePct": coverage_pct,
        "gapCount": len(gaps),
        "largestGapDays": largest_gap_days,
        "sessionBreakCount": session_break_count,
        "sessionBreakDays": round(session_break_s / 86400.0, 2),
        "gaps": gaps,
    }


def main():
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    pairs = conn.execute("SELECT DISTINCT symbol, timeframe FROM candles ORDER BY symbol, timeframe").fetchall()

    entries = []
    for symbol, timeframe in pairs:
        entry = audit_pair(conn, symbol, timeframe)
        if entry:
            entries.append(entry)
            print(f"{symbol:20s} {timeframe:5s} coverage={entry['coveragePct']:6.2f}%  gaps={entry['gapCount']:3d}  largest={entry['largestGapDays']:7.1f}d")
    conn.close()

    with open(DB_PATH, "rb") as f:
        db_hash = hashlib.sha256()
        while chunk := f.read(1024 * 1024):
            db_hash.update(chunk)

    registry_version_input = db_hash.hexdigest() + AUDIT_RULE_VERSION
    registry_version = hashlib.sha256(registry_version_input.encode()).hexdigest()[:16]

    out = {
        "registryVersion": registry_version,
        "auditRuleVersion": AUDIT_RULE_VERSION,
        "marketDbSha256": db_hash.hexdigest(),
        "entries": entries,
    }
    out_path = os.path.join(os.path.dirname(__file__), "..", "output", "q11_gap_registry.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nregistryVersion={registry_version}")
    print(f"Written: {out_path}")


if __name__ == "__main__":
    main()
