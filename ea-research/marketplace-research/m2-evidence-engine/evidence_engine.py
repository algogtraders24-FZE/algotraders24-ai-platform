"""
M2 -- Backtest Evidence Engine (AT24 Marketplace program).

Pipeline: raw MT5 backtest artifacts -> Data Integrity -> Execution/Cost
Conditions -> Trade Generation -> Performance Calculation -> Evidence Record
-> Immutable Provenance.

Produces exactly one Evidence record (+ Trade records) conforming to the
M1 schema (../M1_schema.prisma). Does NOT judge statistical validity,
robustness, trust status, or score -- those are M4/M5/M6/M7. See
M2_backtest_evidence_engine.md for the full design rationale.

Two source adapters feed the same canonical Trade shape + the same
integrity/metrics/assembly pipeline:
  - "csv"   : G01's Phase-research CSV format (parse_g01_research_csv)
  - "deals" : the native MT5 report's own Deals table (M2.1 -- see
              parse_mt5_deals_table / reconcile_deals_to_trades), used when
              no separate trade-log CSV survives for a given run.

Stdlib-only by design (csv, json, hashlib, statistics, html.parser) --
this is a standalone research tool, not wired into the frontend app.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import statistics
import sys
from dataclasses import dataclass, field
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ENGINE_ID = "AT24-M2-Evidence-Engine-v0.2"


# ---------------------------------------------------------------------------
# Stage 1: parse raw artifacts
# ---------------------------------------------------------------------------


class _MT5ReportTableParser(HTMLParser):
    """Extracts label/value pairs from MT5's native Strategy Tester .htm
    report. MT5 renders the settings + results blocks as simple <tr><td>
    rows, commonly 2 or 4 cells per row (label, value[, label, value]).
    Label/value pairing is heuristic -- verify against a real exported
    report the first time this runs and adjust MT5_LABEL_MAP below if a
    label string differs from what's assumed here."""

    def __init__(self) -> None:
        super().__init__()
        self._in_cell = False
        self._row: list[str] = []
        self._cell_text: list[str] = []
        self.pairs: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if tag == "tr":
            self._row = []
        elif tag == "td":
            self._in_cell = True
            self._cell_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "td":
            self._in_cell = False
            self._row.append("".join(self._cell_text).strip())
        elif tag == "tr":
            self._flush_row()

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_text.append(data)

    def _flush_row(self) -> None:
        cells = [c for c in self._row if c != ""]
        # Pair cells two-at-a-time: (label, value, label, value, ...)
        for i in range(0, len(cells) - 1, 2):
            label, value = cells[i].rstrip(":"), cells[i + 1]
            if label and value:
                self.pairs[label] = value
        self._row = []


# Known MT5 report labels -> our field names. Not exhaustive; unknown
# labels are kept in raw_fields so nothing is silently dropped.
MT5_LABEL_MAP = {
    "Symbol": "symbol",
    "Period": "period",
    "Company": "broker",
    "Currency": "currency",
    "Initial Deposit": "initial_deposit",
    "Leverage": "leverage",
    "Total Net Profit": "report_net_profit",
    "Profit Factor": "report_profit_factor",
    "Expected Payoff": "report_expected_payoff",
    "Recovery Factor": "report_recovery_factor",
    "Sharpe Ratio": "report_sharpe",
    "Total Trades": "report_trade_count",
    "Total Deals": "report_total_deals",
    "Profit Trades (% of total)": "report_profit_trades_raw",   # e.g. "909 (33.52%)"
    "Loss Trades (% of total)": "report_loss_trades_raw",
    "Balance Drawdown Maximal": "report_balance_dd_max_raw",     # e.g. "6 365.64 (63.01%)"
    "Equity Drawdown Maximal": "report_equity_dd_max_raw",
    "Largest profit trade": "report_largest_win_raw",
    "Largest loss trade": "report_largest_loss_raw",
}


def _parse_count_and_percent(raw: str | None) -> dict[str, float | None]:
    """MT5 renders several results as 'N (P.PP%)' or 'AMOUNT (P.PP%)' in one
    cell -- split into {count_or_amount, percent} rather than discarding
    the structure by treating it as an opaque string."""
    if not raw:
        return {"value": None, "percent": None}
    m = re.match(r"^(-?[\d\s.,]+)\s*\(([-\d.]+)%\)\s*$", raw.strip())
    if not m:
        return {"value": _clean_number(raw), "percent": None}
    return {"value": _clean_number(m.group(1)), "percent": _clean_number(m.group(2))}


def _read_html_text(path: Path) -> str:
    """MT5's native Strategy Tester .htm export is UTF-16 (LE, with BOM) --
    NOT UTF-8. Reading it as UTF-8 doesn't raise, it silently produces
    garbage (every character interleaved with NUL bytes), which is worse
    than a crash because it fails quietly downstream. Detect the actual
    encoding from the byte-order mark and decode explicitly; if neither a
    UTF-16 BOM nor valid UTF-8 is found, halt cleanly rather than guess."""
    raw = path.read_bytes()
    if raw.startswith(b"\xff\xfe") or raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise ValueError(
            f"Cannot determine text encoding of {path}: no UTF-16 BOM found and "
            f"content is not valid UTF-8 ({e}). Refusing to guess -- a native MT5 "
            f"report is UTF-16LE; anything else needs its encoding confirmed by hand."
        ) from e


def parse_mt5_report_html(path: Path) -> dict[str, Any]:
    """Stage 1a: parse the native MT5 Strategy Tester .htm report's
    Settings/Results section into a raw label/value dict. Returns fields
    as None where absent -- never guessed.

    Deliberately bounded to the text BEFORE the Orders/Deals tables begin.
    Those tables' own column-header rows (Time, Deal, Symbol, Type, ...)
    parse as valid two-cell-pair rows under the same generic label/value
    heuristic used for the settings section, and a bare column header like
    "Symbol" / "Type" would silently overwrite the real "Symbol: XAUUSD"
    settings pair with garbage from deep in the trade-by-trade table (found
    by inspecting real output: provenance.symbol came back "Type" instead
    of "XAUUSD" until this bound was added). Same reasoning applies to
    every other settings label that happens to collide with a deals-table
    column name."""
    html_text = _read_html_text(path)
    boundary = min((i for i in (html_text.find("<b>Orders</b>"), html_text.find("<b>Deals</b>")) if i != -1), default=len(html_text))

    parser = _MT5ReportTableParser()
    parser.feed(html_text[:boundary])
    raw = parser.pairs
    mapped: dict[str, Any] = {"raw_fields": raw}
    for label, key in MT5_LABEL_MAP.items():
        mapped[key] = raw.get(label)
    return mapped


# ---------------------------------------------------------------------------
# Stage 1c (M2.1): the Deals table inside the same .htm report, used as a
# trade-log source when no separate CSV survives for a run.
# ---------------------------------------------------------------------------


_TAG_RE = re.compile(r"<[^>]+>")


def _strip_tags(cell_html: str) -> str:
    return _TAG_RE.sub("", cell_html).strip()


def _clean_number(s: str | None) -> float | None:
    """MT5 renders numbers with a space as thousands separator (plain or
    non-breaking) -- e.g. '10 000.00'. Strip separators, not digits."""
    if s is None:
        return None
    s = s.replace("\xa0", "").replace(" ", "").strip()
    if s == "":
        return None
    try:
        return float(s)
    except ValueError:
        return None


DEALS_COLUMNS = [
    "time", "deal", "symbol", "type", "direction", "volume", "price",
    "order", "commission", "swap", "profit", "balance", "comment",
]


def parse_mt5_deals_table(html_text: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """M2.1: extract every row of the native report's own 'Deals' table --
    one row per MT5 deal (entry + exit are separate deals), rather than
    relying on a separate trade-log CSV. Returns (trade_deal_rows, meta)
    where meta carries the 'balance' operation row (initial deposit) and
    a raw row count for the integrity stage to cross-check against the
    report's own 'Total Deals' summary figure."""
    start = html_text.find("<b>Deals</b>")
    if start == -1:
        raise ValueError("No 'Deals' table found in this report -- malformed or unsupported report format")
    end = html_text.find("</table>", start)
    if end == -1:
        raise ValueError("'Deals' table found but never closed (no </table>) -- report file may be truncated")
    section = html_text[start:end]

    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", section, re.S)
    trade_rows: list[dict[str, Any]] = []
    balance_row: dict[str, Any] | None = None
    header_seen = False

    for row_html in rows:
        cells = [_strip_tags(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.S)]
        if len(cells) != 13:
            continue
        if cells[0] == "Time" and cells[1] == "Deal":
            header_seen = True
            continue
        record = dict(zip(DEALS_COLUMNS, cells))
        if record["type"] == "balance":
            balance_row = record
            continue
        if record["type"] not in ("buy", "sell"):
            continue  # ignore any other MT5 operation types (credit/correction/etc.) rather than guessing
        trade_rows.append(record)

    if not header_seen:
        raise ValueError("'Deals' table has no recognizable header row (expected 'Time'/'Deal' columns) -- malformed table")
    if not trade_rows:
        raise ValueError("'Deals' table parsed but contains zero buy/sell deal rows -- cannot become Evidence")

    meta = {
        "initial_deposit": _clean_number(balance_row["balance"]) if balance_row else None,
        "raw_deal_row_count": len(trade_rows),
    }
    return trade_rows, meta


def reconcile_deals_to_trades(deal_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """M2.1: pair each 'in' deal with its matching 'out' deal into one
    round-trip Trade. Uses a per-symbol FIFO queue (not naive fixed-offset
    pairing) so it stays correct even if two positions on the same symbol
    were ever open at once; still halts loudly rather than guessing if the
    open/close bookkeeping doesn't balance exactly."""
    open_queues: dict[str, list[dict[str, Any]]] = {}
    trades: list[dict[str, Any]] = []
    issues: list[str] = []

    for i, d in enumerate(deal_rows):
        symbol = d["symbol"]
        if d["direction"] == "in":
            open_queues.setdefault(symbol, []).append(d)
        elif d["direction"] == "out":
            queue = open_queues.get(symbol, [])
            if not queue:
                issues.append(f"deal #{d['deal']} (row {i}) is an 'out' with no matching open 'in' for {symbol}")
                continue
            entry = queue.pop(0)

            vol_in = _clean_number(entry["volume"])
            vol_out = _clean_number(d["volume"])
            if vol_in is None or vol_out is None or abs(vol_in - vol_out) > 1e-9:
                issues.append(f"volume mismatch pairing deal #{entry['deal']} (in, vol={entry['volume']}) with deal #{d['deal']} (out, vol={d['volume']})")
                continue

            commission_total = (_clean_number(entry["commission"]) or 0.0) + (_clean_number(d["commission"]) or 0.0)
            swap_total = (_clean_number(entry["swap"]) or 0.0) + (_clean_number(d["swap"]) or 0.0)
            gross_profit = _clean_number(d["profit"]) or 0.0
            net_profit = gross_profit + commission_total + swap_total

            comment = d.get("comment", "")
            exit_reason = comment.split()[0].upper() if comment else None  # "tp 1251.87" -> "TP", "sl ..." -> "SL"

            t_entry = _parse_timestamp(entry["time"])
            t_exit = _parse_timestamp(d["time"])
            duration = (t_exit - t_entry).total_seconds() if (t_entry and t_exit) else None

            trades.append({
                "timestamp": d["time"],  # trade is recorded at close time, consistent with realized profit
                "symbol": symbol,
                "direction": "long" if entry["type"] == "buy" else "short",
                "entryPrice": _clean_number(entry["price"]),
                "exitPrice": _clean_number(d["price"]),
                "sl": None,   # not exposed by the Deals table; only the realized exit price/reason is
                "tp": None,
                "volume": vol_in,
                "profit": round(net_profit, 2),
                "rMultiple": None,  # not derivable without the SL distance, which the Deals table doesn't carry
                "durationSeconds": duration,
                "marketRegime": None,
                # Extra deal-level metadata beyond the minimal M1 Trade shape --
                # kept (not stripped) because commission/swap/exit-reason are
                # genuine evidence, not internal engine bookkeeping (M0.1
                # principle 7/8: provenance and audit trail matter).
                "exitReason": exit_reason,
                "grossProfit": gross_profit,   # MT5's own Profit column -- excludes commission/swap
                "commission": round(commission_total, 2),
                "swap": round(swap_total, 2),
                "entryDealId": entry["deal"],
                "exitDealId": d["deal"],
            })
        # any other direction value is ignored -- balance/other operation types were already filtered upstream

    for symbol, leftover in open_queues.items():
        if leftover:
            issues.append(f"{len(leftover)} unmatched open 'in' deal(s) for {symbol} with no corresponding 'out' (position never closed in this report)")

    if issues:
        raise ValueError("Deal reconciliation failed:\n  - " + "\n  - ".join(issues))

    return trades


G01_CSV_REQUIRED_COLUMNS = [
    "timestamp", "symbol", "sweep_direction", "entry", "sl", "tp",
    "R_multiple", "exit_reason",
]


def parse_g01_research_csv(path: Path) -> list[dict[str, Any]]:
    """Stage 1b / 2.3: adapter for G01's Phase-research CSV format
    (AT24_G01_ResearchLog.csv) -> canonical Trade dicts. A different
    source format (raw MT5 trade-history export, a future third-party
    seller's log) needs its own adapter producing this same shape --
    parsing is kept separate from metric computation for exactly that
    reason."""
    trades: list[dict[str, Any]] = []
    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = [c for c in G01_CSV_REQUIRED_COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"CSV missing required columns: {missing}")
        for row in reader:
            direction = "long" if row.get("sweep_direction", "").lower() in ("bullish", "buy", "long") else "short"
            r_multiple = _to_float(row.get("R_multiple"))
            risk = _to_float(row.get("risk"))
            profit = r_multiple * risk if (r_multiple is not None and risk is not None) else None
            trades.append({
                "timestamp": row.get("timestamp"),
                "symbol": row.get("symbol"),
                "direction": direction,
                "entryPrice": _to_float(row.get("entry")),
                "exitPrice": None,  # not present in this research CSV format
                "sl": _to_float(row.get("sl")),
                "tp": _to_float(row.get("tp")),
                "volume": None,  # not present in this research CSV format
                "profit": profit,
                "rMultiple": r_multiple,
                "durationSeconds": None,
                "marketRegime": row.get("session") or None,
                "exitReason": row.get("exit_reason"),
            })
    return trades


def _to_float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Stage 2: data integrity (structural, not statistical -- see design doc 2.1)
# ---------------------------------------------------------------------------


@dataclass
class IntegrityReport:
    ok: bool
    issues: list[str] = field(default_factory=list)


def run_data_integrity_checks(trades: list[dict[str, Any]]) -> IntegrityReport:
    issues: list[str] = []

    if len(trades) == 0:
        issues.append("zero trades -- cannot become Evidence")

    seen: set[tuple[Any, Any]] = set()
    timestamps: list[datetime] = []
    for i, t in enumerate(trades):
        key = (t["timestamp"], t["entryPrice"])
        if key in seen:
            issues.append(f"duplicate trade row at index {i} (timestamp={t['timestamp']}, entry={t['entryPrice']})")
        seen.add(key)

        ts = _parse_timestamp(t["timestamp"])
        if ts is None:
            issues.append(f"unparseable timestamp at index {i}: {t['timestamp']!r}")
        else:
            timestamps.append(ts)

        for field_name in ("entryPrice", "sl", "tp"):
            v = t.get(field_name)
            if v is not None and (v < 0):
                issues.append(f"negative {field_name} at index {i}: {v}")

    if timestamps and timestamps != sorted(timestamps):
        issues.append("timestamps are not non-decreasing (out-of-order trade rows)")

    return IntegrityReport(ok=(len(issues) == 0), issues=issues)


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Stage 3: provenance (execution/cost conditions)
# ---------------------------------------------------------------------------


def _file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def build_provenance(report_meta: dict[str, Any], report_path: Path, trade_log: dict[str, Any]) -> dict[str, Any]:
    """`trade_log` describes where the Trade records came from:
    {"kind": "csv", "file": <name>} or {"kind": "deals_table", "file": None}
    (deals_table has no separate file -- the report itself is the source)."""
    return {
        "dataSource": {
            "reportFile": report_path.name,
            "reportFileSha256": _file_sha256(report_path),
            "tradeLogKind": trade_log["kind"],
            "tradeLogFile": trade_log.get("file"),
        },
        "broker": report_meta.get("broker"),
        "symbol": report_meta.get("symbol"),
        "timeframe": report_meta.get("period"),
        "periodStart": None,   # populated from trade timestamps in assemble_evidence_record
        "periodEnd": None,
        "spreadModel": None,   # MT5 report doesn't always surface this explicitly -- never guessed
        "commissionModel": None,
        "swapModel": None,
        "tickDataQuality": None,  # e.g. "Every tick based on real ticks" -- read from report if present
        "executionAssumptions": {
            "initialDeposit": _clean_number(report_meta.get("initial_deposit")) if isinstance(report_meta.get("initial_deposit"), str) else report_meta.get("initial_deposit"),
            "leverage": report_meta.get("leverage"),
            "currency": report_meta.get("currency"),
        },
    }


# ---------------------------------------------------------------------------
# Stage 4: performance calculation (recomputed, not copied from the report)
# ---------------------------------------------------------------------------


def compute_metrics(trades: list[dict[str, Any]], initial_deposit: float | None = None) -> dict[str, Any]:
    profits = [t["profit"] for t in trades if t["profit"] is not None]
    if not profits:
        raise ValueError("no trades with a computable profit -- cannot compute metrics (missing 'risk' column?)")

    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p < 0]

    net_profit = sum(profits)
    gross_profit = sum(wins)
    gross_loss = abs(sum(losses))
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float("inf")
    win_rate = len(wins) / len(profits)
    avg_trade = net_profit / len(profits)

    # Drawdown % must be measured against account EQUITY (deposit + cumulative
    # profit), not against the peak of cumulative profit alone -- the latter
    # wildly overstates % drawdown whenever the profit peak is small relative
    # to the deposit (e.g. a losing strategy whose profit curve never climbs
    # far above zero before a large pullback). Falls back to a deposit-less
    # (profit-only) curve, clearly flagged, only if no deposit is known.
    deposit = initial_deposit if initial_deposit is not None else 0.0
    equity_curve = [deposit + c for c in _cumulative(profits)]
    max_dd_abs, max_dd_pct = _max_drawdown(equity_curve, floor=deposit)
    recovery_factor = (net_profit / max_dd_abs) if max_dd_abs > 0 else float("inf")

    mean_r = statistics.mean(profits)
    stdev_r = statistics.pstdev(profits) if len(profits) > 1 else 0.0
    sharpe = (mean_r / stdev_r) if stdev_r > 0 else None

    downside = [p for p in profits if p < 0]
    downside_dev = statistics.pstdev(downside) if len(downside) > 1 else 0.0
    sortino = (mean_r / downside_dev) if downside_dev > 0 else None

    return {
        "netProfit": round(net_profit, 2),
        "profitFactor": round(profit_factor, 4) if profit_factor != float("inf") else None,
        "winRate": round(win_rate, 4),
        "avgTrade": round(avg_trade, 2),
        "expectedPayoff": round(avg_trade, 2),
        "maxDrawdown": {"absolute": round(max_dd_abs, 2), "percent": round(max_dd_pct, 4)},
        "recoveryFactor": round(recovery_factor, 4) if recovery_factor != float("inf") else None,
        "sharpe": round(sharpe, 4) if sharpe is not None else None,
        "sortino": round(sortino, 4) if sortino is not None else None,
        "largestWin": round(max(wins), 2) if wins else 0.0,
        "largestLoss": round(min(losses), 2) if losses else 0.0,
        "consecutiveWins": _max_streak(profits, lambda p: p > 0),
        "consecutiveLosses": _max_streak(profits, lambda p: p < 0),
        "tradeCount": len(profits),
        "_annualized": False,
        "_depositUsedForDrawdown": deposit,
        "_note": "Sharpe/Sortino are per-trade, not annualized -- annualization needs a trading-frequency assumption not made here (see design doc 2.4). maxDrawdown.percent is relative to account equity (deposit + cumulative profit)"
                 + ("." if initial_deposit is not None else "; WARNING: no initial deposit was available, so this run used a deposit of 0 -- the percent figure is not meaningful and should not be trusted (absolute figure is still valid)."),
    }


def _cumulative(values: list[float]) -> list[float]:
    out, running = [], 0.0
    for v in values:
        running += v
        out.append(running)
    return out


def _max_drawdown(equity_curve: list[float], floor: float = 0.0) -> tuple[float, float]:
    peak = floor  # starting equity, not 0 -- see compute_metrics for why
    max_dd_abs = 0.0
    max_dd_pct = 0.0
    for e in equity_curve:
        peak = max(peak, e)
        dd = peak - e
        max_dd_abs = max(max_dd_abs, dd)
        if peak > 0:
            max_dd_pct = max(max_dd_pct, dd / peak)
    return max_dd_abs, max_dd_pct


def _max_streak(values: list[float], predicate) -> int:
    best = cur = 0
    for v in values:
        if predicate(v):
            cur += 1
            best = max(best, cur)
        else:
            cur = 0
    return best


# ---------------------------------------------------------------------------
# Stage 5 + 6: assemble Evidence record + write immutably
# ---------------------------------------------------------------------------


def _cross_check(label: str, computed: float | None, report_value: float | None, tolerance: float | None, note: str = "") -> dict[str, Any]:
    """tolerance=None means 'not expected to match exactly' (e.g. a known
    methodology difference) -- delta is still computed and shown, but no
    pass/fail verdict is asserted."""
    delta = (computed - report_value) if (computed is not None and report_value is not None) else None
    return {
        "label": label,
        "computed": computed,
        "reportValue": report_value,
        "delta": round(delta, 4) if delta is not None else None,
        "withinTolerance": (abs(delta) <= tolerance) if (delta is not None and tolerance is not None) else None,
        "note": note,
    }


def build_report_cross_check(metrics: dict[str, Any], report_meta: dict[str, Any]) -> dict[str, Any]:
    """Compares independently recomputed metrics against the report's own
    summary. Differences are reported, never hidden or forced to match --
    some are expected (e.g. gross vs. net-of-cost figures) and the note
    field says why, rather than silently rounding them away."""
    profit_trades = _parse_count_and_percent(report_meta.get("report_profit_trades_raw"))
    dd_max = _parse_count_and_percent(report_meta.get("report_balance_dd_max_raw"))

    return {
        "netProfit": _cross_check("netProfit", metrics["netProfit"], _clean_number(report_meta.get("report_net_profit")), tolerance=0.01),
        "profitFactor": _cross_check("profitFactor", metrics["profitFactor"], _clean_number(report_meta.get("report_profit_factor")), tolerance=0.01),
        "tradeCount": _cross_check("tradeCount", metrics["tradeCount"], _clean_number(report_meta.get("report_trade_count")), tolerance=0),
        "winRatePercent": _cross_check(
            "winRatePercent", round(metrics["winRate"] * 100, 2), profit_trades["percent"], tolerance=None,
            note="Computed win-rate classifies by NET profit (post commission/swap); MT5's 'Profit Trades %' classifies by raw deal Profit only -- a trade can be gross-positive but net-negative, so small deltas here are expected and methodologically explained, not an error.",
        ),
        "maxDrawdownPercent": _cross_check(
            "maxDrawdownPercent", round(metrics["maxDrawdown"]["percent"] * 100, 2), dd_max["percent"], tolerance=None,
            note="Computed drawdown walks the reconstructed trade-by-trade equity curve, measured against equity = deposit + cumulative profit; MT5's Balance Drawdown Maximal also reflects intraperiod balance timing. Small deltas are expected.",
        ),
        "largestWin": _cross_check(
            "largestWin", metrics["largestWin"], _clean_number(report_meta.get("report_largest_win_raw")), tolerance=None,
            note="Computed figure is NET of commission/swap; MT5's 'Largest profit trade' is the GROSS deal Profit field. This is an intentional methodology difference (AT24 principle: risk-adjusted, cost-adjusted reporting), not a bug -- see M0.1 principle 7 and the M0 research gap on inconsistent fee-adjusted disclosure.",
        ),
        "largestLoss": _cross_check(
            "largestLoss", metrics["largestLoss"], _clean_number(report_meta.get("report_largest_loss_raw")), tolerance=None,
            note="Same gross-vs-net distinction as largestWin.",
        ),
        "sharpe": _cross_check(
            "sharpe", metrics["sharpe"], _clean_number(report_meta.get("report_sharpe")), tolerance=None,
            note="Computed Sharpe is per-trade and not annualized (see metricsSummary._note); MT5's Sharpe Ratio uses its own (undisclosed-in-report) return-interval convention. Not expected to match numerically -- shown for reference only.",
        ),
    }


def assemble_evidence_record(
    version_id: str,
    trades: list[dict[str, Any]],
    metrics: dict[str, Any],
    provenance: dict[str, Any],
    report_meta: dict[str, Any],
    source_adapter: str,
) -> dict[str, Any]:
    parsed_ts = [t for t in (_parse_timestamp(tr["timestamp"]) for tr in trades) if t]
    if parsed_ts:
        provenance["periodStart"] = min(parsed_ts).isoformat()
        provenance["periodEnd"] = max(parsed_ts).isoformat()

    record = {
        "versionId": version_id,
        "evidenceClass": "HISTORICAL",
        "source": "BACKTEST",
        "sourceAdapter": source_adapter,  # "g01-research-csv-v1" | "mt5-deals-table-v1"
        "provenance": provenance,
        "generatedBy": ENGINE_ID,
        "metricsSummary": metrics,
        "curves": {},  # equity/balance/drawdown curve series -- reserved, not populated by this stub
        "reportCrossCheck": build_report_cross_check(metrics, report_meta),
        "createdAt": datetime.utcnow().isoformat() + "Z",
    }
    return record


def _content_hash(record: dict[str, Any]) -> str:
    # Hash the deterministic content only -- excludes createdAt (wall-clock
    # run metadata, not content) so re-running against identical input
    # yields the identical hash, which is what "immutable evidence" means.
    stable = {k: v for k, v in record.items() if k != "createdAt"}
    canonical = json.dumps(stable, sort_keys=True).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


def write_immutable_evidence(record: dict[str, Any], trades: list[dict[str, Any]], out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    content_hash = _content_hash(record)
    record["_contentHash"] = content_hash

    out_path = out_dir / f"evidence_{record['versionId']}_{content_hash}.json"
    if out_path.exists():
        raise FileExistsError(
            f"Evidence file {out_path} already exists -- refusing to overwrite (immutability). "
            "A new run against different input would produce a different hash."
        )

    payload = {"evidence": record, "trades": [{k: v for k, v in t.items() if not k.startswith("_")} for t in trades]}
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def run_pipeline(report_path: Path, csv_path: Path, version_id: str, out_dir: Path) -> Path:
    """Original M2 adapter: report .htm (for provenance/cross-check) + a
    separate G01 research-format trade-log CSV."""
    report_meta = parse_mt5_report_html(report_path)
    trades = parse_g01_research_csv(csv_path)

    integrity = run_data_integrity_checks(trades)
    if not integrity.ok:
        raise ValueError("Data integrity check failed:\n  - " + "\n  - ".join(integrity.issues))

    provenance = build_provenance(report_meta, report_path, {"kind": "csv", "file": csv_path.name})
    metrics = compute_metrics(trades, initial_deposit=_clean_number(report_meta.get("initial_deposit")))
    record = assemble_evidence_record(version_id, trades, metrics, provenance, report_meta, source_adapter="g01-research-csv-v1")
    return write_immutable_evidence(record, trades, out_dir)


def run_pipeline_from_deals_table(report_path: Path, version_id: str, out_dir: Path) -> Path:
    """M2.1 adapter: no separate trade-log file -- Trade records are
    reconstructed entirely from the report's own Deals table. Used when a
    run's CSV trade-log didn't survive (overwritten by a later run) but
    the native .htm report itself did."""
    html_text = _read_html_text(report_path)
    report_meta = parse_mt5_report_html(report_path)

    deal_rows, deals_meta = parse_mt5_deals_table(html_text)
    trades = reconcile_deals_to_trades(deal_rows)

    # Cross-check the reconciliation itself against the report's own deal count
    # before trusting anything downstream -- belt-and-suspenders on top of the
    # in/out pairing validation already done inside reconcile_deals_to_trades.
    report_total_deals = _clean_number(report_meta.get("report_total_deals"))
    if report_total_deals is not None and int(report_total_deals) != deals_meta["raw_deal_row_count"]:
        raise ValueError(
            f"Deal count mismatch: report states Total Deals={int(report_total_deals)}, "
            f"but {deals_meta['raw_deal_row_count']} buy/sell deal rows were parsed from the Deals table."
        )
    # report_meta['initial_deposit'] is the raw settings-table string (e.g.
    # "10 000.00") if present; the Deals table's own balance row is a clean
    # float and is used as a fallback/cross-check when the settings table
    # doesn't expose it.
    deposit_from_settings = _clean_number(report_meta.get("initial_deposit"))
    initial_deposit = deposit_from_settings if deposit_from_settings is not None else deals_meta.get("initial_deposit")
    if deposit_from_settings is None:
        report_meta["initial_deposit"] = deals_meta.get("initial_deposit")

    integrity = run_data_integrity_checks(trades)
    if not integrity.ok:
        raise ValueError("Data integrity check failed:\n  - " + "\n  - ".join(integrity.issues))

    provenance = build_provenance(report_meta, report_path, {"kind": "deals_table", "file": None})
    metrics = compute_metrics(trades, initial_deposit=initial_deposit)
    record = assemble_evidence_record(version_id, trades, metrics, provenance, report_meta, source_adapter="mt5-deals-table-v1")
    return write_immutable_evidence(record, trades, out_dir)


def main() -> None:
    p = argparse.ArgumentParser(description="M2 Backtest Evidence Engine")
    p.add_argument("--report", required=True, type=Path, help="Path to native MT5 Strategy Tester .htm report")
    p.add_argument("--tradelog", type=Path, help="Path to AT24_G01_ResearchLog.csv (or compatible). Omit to use --source deals instead.")
    p.add_argument("--source", choices=["csv", "deals"], default="csv", help="Trade-log source: separate CSV (default) or the report's own Deals table (M2.1)")
    p.add_argument("--version-id", required=True, help="M1 Version.id this Evidence belongs to")
    p.add_argument("--out-dir", required=True, type=Path, help="Output directory for the Evidence JSON")
    args = p.parse_args()

    if args.source == "deals":
        out_path = run_pipeline_from_deals_table(args.report, args.version_id, args.out_dir)
    else:
        if not args.tradelog:
            p.error("--tradelog is required when --source csv (the default)")
        out_path = run_pipeline(args.report, args.tradelog, args.version_id, args.out_dir)
    print(f"Evidence written: {out_path}")


if __name__ == "__main__":
    main()
