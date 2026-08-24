"""
M5 -- Risk Analysis Engine (AT24 Marketplace program).

Consumes M3-verified Evidence + an already-computed M4 Validation result and
produces ONE RiskAnalysis record with named, independently-inspectable risk
dimensions (drawdown, loss/win distribution, expectancy, loss streaks/
recovery, tail risk, concentration, temporal risk, regime risk, exposure,
cost). No Score, Trust Status, or risk grade -- see M5_risk_analysis.md.

Platform-agnostic by construction: operates only on the generic M1 Evidence/
Trade shape. See M5_risk_analysis.md section 5.
"""

from __future__ import annotations

import hashlib
import json
import statistics
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent.parent / "m2-evidence-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m3-evidence-verification"))
from evidence_engine import compute_metrics  # noqa: E402
from evidence_verifier import load_evidence_package, verify_evidence_package  # noqa: E402

ENGINE_VERSION = "AT24-M5-Risk-Analysis-Engine-v1.0"
METHODOLOGY_VERSION = "M5-methodology-v1"
CALCULATION_VERSION = "M5-calc-v1"
ACCEPTANCE_RULESET_VERSION = "none-defined"  # deliberate -- see design doc section 4
PERCENTILE_MIN_SAMPLE = 20  # structural floor for a P95/P99 estimate to mean anything -- not a quality bar


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class InvalidInputEvidenceError(Exception):
    pass


class InsufficientValidationInputError(Exception):
    pass


class InputIntegrityFailureError(Exception):
    pass


class RiskProvenanceFailureError(Exception):
    pass


# ---------------------------------------------------------------------------
# Result model (section 19)
# ---------------------------------------------------------------------------


@dataclass
class RiskAnalysis:
    riskAnalysisId: str
    versionId: str
    evidenceId: str
    validationId: str
    rulesetVersion: str
    methodologyVersion: str
    inputEvidenceHash: str
    inputValidationHash: str
    generatedAt: str
    drawdown: dict[str, Any]
    lossDistribution: dict[str, Any]
    winDistribution: dict[str, Any]
    expectancy: dict[str, Any]
    lossStreaks: dict[str, Any]
    recovery: dict[str, Any]
    tailRisk: dict[str, Any]
    concentration: dict[str, Any]
    temporalRisk: dict[str, Any]
    regimeRisk: dict[str, Any]
    exposureRisk: dict[str, Any]
    costRisk: dict[str, Any]
    dataQuality: dict[str, str]
    findings: list[str]
    warnings: list[str]
    limitations: list[str]
    status: str  # COMPLETE | PARTIAL | INCONCLUSIVE | FAILED
    riskAnalysisHash: str = ""
    createdBy: str = ENGINE_VERSION

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_ts(value: str) -> datetime | None:
    for fmt in ("%Y.%m.%d %H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y.%m.%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _percentile(sorted_values: list[float], p: float) -> float | None:
    """Nearest-rank percentile of an already-sorted list. p in [0,100]."""
    if not sorted_values:
        return None
    k = max(0, min(len(sorted_values) - 1, round((p / 100) * (len(sorted_values) - 1))))
    return sorted_values[k]


def validation_result_hash(validation_result: dict[str, Any]) -> str:
    """Hash M5 computes over the SUPPLIED M4 result -- does not require any
    change to M4's own code/output. Excludes volatile per-record
    startedAt/completedAt, same discipline as every prior sprint's
    createdAt-exclusion pattern."""
    stripped_records = []
    for r in validation_result.get("records", []):
        stripped_records.append({k: v for k, v in r.items() if k not in ("startedAt", "completedAt")})
    stable = {k: v for k, v in validation_result.items() if k != "records"}
    stable["records"] = stripped_records
    canonical = json.dumps(stable, sort_keys=True).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


def _risk_analysis_content_hash(record: dict[str, Any]) -> str:
    stable = {k: v for k, v in record.items() if k not in ("generatedAt", "riskAnalysisHash", "riskAnalysisId")}
    canonical = json.dumps(stable, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


# ---------------------------------------------------------------------------
# Gate (section 6 of the design doc)
# ---------------------------------------------------------------------------


def verify_and_gate(
    evidence_path: Path,
    source_artifact_path: Path | None,
    expected_version_id: str,
    registry_path: Path,
    validation_result: dict[str, Any] | None,
    expected_evidence_hash: str | None = None,
    expected_validation_hash: str | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]], str, str]:
    m3_result = verify_evidence_package(evidence_path, source_artifact_path, expected_version_id, registry_path)
    if m3_result.status != "VERIFIED":
        raise InvalidInputEvidenceError(
            f"INVALID_INPUT_EVIDENCE: M3 verification status is '{m3_result.status}', not VERIFIED. Failures: {m3_result.failures}"
        )

    if not validation_result or not validation_result.get("records"):
        raise InsufficientValidationInputError(
            "INSUFFICIENT_VALIDATION_INPUT: no (or empty) M4 validation result was supplied -- "
            "M5 requires an already-computed Validation stage, it does not run M4 itself."
        )

    evidence, trades = load_evidence_package(evidence_path)

    actual_evidence_hash = evidence.get("_contentHash")
    if expected_evidence_hash is not None and actual_evidence_hash != expected_evidence_hash:
        raise InputIntegrityFailureError(
            f"INPUT_INTEGRITY_FAILURE: Evidence hash {actual_evidence_hash} != expected {expected_evidence_hash}"
        )

    actual_validation_hash = validation_result_hash(validation_result)
    if expected_validation_hash is not None and actual_validation_hash != expected_validation_hash:
        raise InputIntegrityFailureError(
            f"INPUT_INTEGRITY_FAILURE: Validation hash {actual_validation_hash} != expected {expected_validation_hash}"
        )

    if not evidence.get("sourceAdapter"):
        raise RiskProvenanceFailureError(
            "RISK_PROVENANCE_FAILURE: Evidence missing 'sourceAdapter' -- M5 cannot record complete provenance without knowing which adapter produced this Evidence"
        )

    return evidence, trades, m3_result.evidenceId, actual_validation_hash


# ---------------------------------------------------------------------------
# Shared: balance-level equity curve + drawdown-episode extraction
# ---------------------------------------------------------------------------


def _chronological(trades: list[dict[str, Any]]) -> list[tuple[dict[str, Any], datetime]]:
    dated = [(t, _parse_ts(t["timestamp"])) for t in trades]
    dated = [(t, ts) for t, ts in dated if ts is not None]
    dated.sort(key=lambda x: x[1])
    return dated


def build_real_equity_curve(evidence: dict[str, Any]) -> list[tuple[datetime, float]] | None:
    """A real, bar-level mark-to-market equity curve, when the Evidence
    actually carries one in its reserved `curves` field (M5.1 -- see
    reconstruct_equity_curve.py: real M15 candle data used only to fill in
    the path BETWEEN each trade's own already-known real entry/exit, never
    a new number). Returns None (never a guess) when curves is absent or
    malformed -- callers fall back to build_balance_equity_curve."""
    curves = evidence.get("curves")
    if not curves or not isinstance(curves, dict):
        return None
    equity = curves.get("equity")
    if not equity or not isinstance(equity, list):
        return None
    out: list[tuple[datetime, float]] = []
    for point in equity:
        try:
            ts = _parse_ts(point[0])
            val = float(point[1])
        except (TypeError, ValueError, IndexError):
            continue
        if ts is not None:
            out.append((ts, val))
    return out if out else None


def build_balance_equity_curve(trades: list[dict[str, Any]], deposit: float | None) -> list[tuple[datetime, float]]:
    dep = deposit if deposit is not None else 0.0
    running = dep
    curve = [(None, dep)]
    for t, ts in _chronological(trades):
        running += t["profit"]
        curve.append((ts, running))
    return curve


def _extract_drawdown_episodes(curve: list[tuple[Any, float]]) -> list[dict[str, Any]]:
    """Each episode: peak value/time, trough value/time, recovered (bool),
    recovery time (if recovered), depth (abs $), depthPct."""
    episodes = []
    peak_val, peak_time = curve[0][1], curve[0][0]
    in_drawdown = False
    trough_val, trough_time = peak_val, peak_time

    for ts, val in curve[1:]:
        if val >= peak_val:
            if in_drawdown:
                episodes.append({
                    "peakValue": peak_val, "peakTime": peak_time.isoformat() if peak_time else None,
                    "troughValue": trough_val, "troughTime": trough_time.isoformat() if trough_time else None,
                    "recovered": True, "recoveryTime": ts.isoformat() if ts else None,
                    "depth": round(peak_val - trough_val, 2),
                    "depthPct": round((peak_val - trough_val) / peak_val, 4) if peak_val > 0 else None,
                    "durationDays": (ts - peak_time).days if (ts and peak_time) else None,
                })
                in_drawdown = False
            peak_val, peak_time = val, ts
            trough_val, trough_time = val, ts
        else:
            in_drawdown = True
            if val < trough_val:
                trough_val, trough_time = val, ts

    if in_drawdown:
        episodes.append({
            "peakValue": peak_val, "peakTime": peak_time.isoformat() if peak_time else None,
            "troughValue": trough_val, "troughTime": trough_time.isoformat() if trough_time else None,
            "recovered": False, "recoveryTime": None,
            "depth": round(peak_val - trough_val, 2),
            "depthPct": round((peak_val - trough_val) / peak_val, 4) if peak_val > 0 else None,
            "durationDays": (curve[-1][0] - peak_time).days if (curve[-1][0] and peak_time) else None,
        })
    return episodes


# ---------------------------------------------------------------------------
# 5.1 Drawdown risk
# ---------------------------------------------------------------------------


def analyze_drawdown(evidence: dict[str, Any], trades: list[dict[str, Any]], deposit: float | None) -> dict[str, Any]:
    # M5.1 fix -- previously this only checked WHETHER evidence.curves
    # existed to decide the dataQuality LABEL, but always computed the
    # actual numbers from the balance-only curve regardless, even when a
    # real curve was present. Now genuinely uses the real curve's own
    # values when one exists.
    real_curve = build_real_equity_curve(evidence)
    has_real_curve = real_curve is not None
    curve = real_curve if has_real_curve else build_balance_equity_curve(trades, deposit)
    episodes = _extract_drawdown_episodes(curve)

    if not episodes:
        return {
            "curveType": "balance (trade-close)", "equityDrawdownAvailable": False, "balanceDrawdownAvailable": False,
            "maxDrawdown": None, "maxDrawdownPercent": None, "maxDrawdownDurationDays": None,
            "averageDrawdown": None, "medianDrawdown": None, "drawdownFrequency": 0, "episodeCount": 0,
            "dataQuality": "LIMITED", "note": "DRAWDOWN_ANALYSIS_LIMITED: no drawdown episodes could be extracted (insufficient trade/equity data).",
        }

    depths = [e["depth"] for e in episodes]
    depth_pcts = [e["depthPct"] for e in episodes if e["depthPct"] is not None]
    durations = [e["durationDays"] for e in episodes if e["durationDays"] is not None]
    max_ep = max(episodes, key=lambda e: e["depth"])

    return {
        "curveType": "equity (real M15 mark-to-market, reconstructed from real price bars between each trade's own real entry/exit)" if has_real_curve
                     else "balance (trade-close), NOT intraday equity -- see design doc section 8",
        "equityDrawdownAvailable": has_real_curve,
        "balanceDrawdownAvailable": True,
        "maxDrawdown": max_ep["depth"],
        "maxDrawdownPercent": max_ep["depthPct"],
        "maxDrawdownDurationDays": max_ep["durationDays"],
        "averageDrawdown": round(statistics.mean(depths), 2),
        "medianDrawdown": round(statistics.median(depths), 2),
        "drawdownFrequency": len(episodes),
        "episodeCount": len(episodes),
        "unrecoveredEpisodes": sum(1 for e in episodes if not e["recovered"]),
        "dataQuality": "AVAILABLE" if has_real_curve else "LIMITED",
        "note": None if has_real_curve else "DRAWDOWN_ANALYSIS_LIMITED: no intraday/tick equity series exists in this Evidence (Evidence.curves is empty) -- figures above are BALANCE drawdown (closed trades only), not EQUITY drawdown.",
    }


# ---------------------------------------------------------------------------
# 6/7 -- Loss / win distribution
# ---------------------------------------------------------------------------


def _streak_episodes(flags: list[bool]) -> list[int]:
    """Lengths of every True-streak in a boolean sequence."""
    lengths, cur = [], 0
    for f in flags:
        if f:
            cur += 1
        else:
            if cur:
                lengths.append(cur)
            cur = 0
    if cur:
        lengths.append(cur)
    return lengths


def analyze_loss_distribution(trades: list[dict[str, Any]]) -> dict[str, Any]:
    profits = [t["profit"] for t in trades if t.get("profit") is not None]
    losses = sorted(p for p in profits if p < 0)  # ascending, most negative first
    if not losses:
        return {"dataQuality": "UNAVAILABLE", "note": "no losing trades present"}

    magnitudes = sorted(abs(p) for p in losses)
    loss_streaks = _streak_episodes([p < 0 for p in profits])
    clustered = sum(1 for s in loss_streaks if s >= 2)
    clustered_loss_count = sum(s for s in loss_streaks if s >= 2)

    quality = "AVAILABLE" if len(losses) >= PERCENTILE_MIN_SAMPLE else "LIMITED"
    return {
        "count": len(losses),
        "largestLoss": round(min(losses), 2),
        "averageLoss": round(statistics.mean(losses), 2),
        "medianLoss": round(statistics.median(losses), 2),
        "stdevLoss": round(statistics.pstdev(losses), 2) if len(losses) > 1 else 0.0,
        "percentiles": {
            "P50": round(_percentile(magnitudes, 50), 2), "P75": round(_percentile(magnitudes, 75), 2),
            "P90": round(_percentile(magnitudes, 90), 2), "P95": round(_percentile(magnitudes, 95), 2),
            "P99": round(_percentile(magnitudes, 99), 2),
        },
        "maxConsecutiveLosses": max(loss_streaks) if loss_streaks else 0,
        "averageConsecutiveLossLength": round(statistics.mean(loss_streaks), 2) if loss_streaks else 0,
        "lossStreakEpisodes": len(loss_streaks),
        "clusteredLossShare": round(clustered_loss_count / len(losses), 4) if losses else None,
        "dataQuality": quality,
        "note": None if quality == "AVAILABLE" else f"Percentile sample ({len(losses)} losses) is below the {PERCENTILE_MIN_SAMPLE}-observation floor for a reliable P95/P99 estimate -- figures shown but flagged LIMITED, not withheld.",
    }


def analyze_win_distribution(trades: list[dict[str, Any]]) -> dict[str, Any]:
    profits = [t["profit"] for t in trades if t.get("profit") is not None]
    wins = sorted((p for p in profits if p > 0), reverse=True)  # descending, largest first
    if not wins:
        return {"dataQuality": "UNAVAILABLE", "note": "no winning trades present"}

    magnitudes = sorted(wins)
    win_streaks = _streak_episodes([p > 0 for p in profits])
    quality = "AVAILABLE" if len(wins) >= PERCENTILE_MIN_SAMPLE else "LIMITED"

    return {
        "count": len(wins),
        "largestWin": round(max(wins), 2),
        "averageWin": round(statistics.mean(wins), 2),
        "medianWin": round(statistics.median(wins), 2),
        "stdevWin": round(statistics.pstdev(wins), 2) if len(wins) > 1 else 0.0,
        "percentiles": {
            "P50": round(_percentile(magnitudes, 50), 2), "P75": round(_percentile(magnitudes, 75), 2),
            "P90": round(_percentile(magnitudes, 90), 2), "P95": round(_percentile(magnitudes, 95), 2),
            "P99": round(_percentile(magnitudes, 99), 2),
        },
        "maxConsecutiveWins": max(win_streaks) if win_streaks else 0,
        "averageConsecutiveWinLength": round(statistics.mean(win_streaks), 2) if win_streaks else 0,
        "winStreakEpisodes": len(win_streaks),
        "dataQuality": quality,
        "note": None if quality == "AVAILABLE" else f"Percentile sample ({len(wins)} wins) is below the {PERCENTILE_MIN_SAMPLE}-observation floor.",
    }


# ---------------------------------------------------------------------------
# 8 -- Expectancy / payoff risk
# ---------------------------------------------------------------------------


def analyze_expectancy(trades: list[dict[str, Any]]) -> dict[str, Any]:
    profits = [t["profit"] for t in trades if t.get("profit") is not None]
    if not profits:
        return {"dataQuality": "UNAVAILABLE"}

    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p < 0]
    win_rate = len(wins) / len(profits)
    loss_rate = len(losses) / len(profits)
    avg_win = statistics.mean(wins) if wins else 0.0
    avg_loss = statistics.mean(losses) if losses else 0.0
    expectancy = (win_rate * avg_win) + (loss_rate * avg_loss)

    gross_profit_net = sum(wins)
    gross_loss_net = sum(losses)
    has_gross_field = all("grossProfit" in t for t in trades)
    gross_profit_raw = sum(t["grossProfit"] for t in trades if t.get("grossProfit", 0) > 0) if has_gross_field else None
    gross_loss_raw = sum(t["grossProfit"] for t in trades if t.get("grossProfit", 0) < 0) if has_gross_field else None

    return {
        "expectancyPerTrade": round(expectancy, 4),
        "averageWin": round(avg_win, 2), "averageLoss": round(avg_loss, 2),
        "winLossRatio": round(avg_win / abs(avg_loss), 4) if avg_loss != 0 else None,
        "profitFactorNet": round(gross_profit_net / abs(gross_loss_net), 4) if gross_loss_net != 0 else None,
        "grossProfitNet": round(gross_profit_net, 2), "grossLossNet": round(gross_loss_net, 2), "netResult": round(sum(profits), 2),
        "grossProfitRaw": round(gross_profit_raw, 2) if gross_profit_raw is not None else "UNKNOWN",
        "grossLossRaw": round(gross_loss_raw, 2) if gross_loss_raw is not None else "UNKNOWN",
        "dataQuality": "AVAILABLE",
        "note": None if has_gross_field else "Per-trade gross (pre-cost) figures are UNKNOWN for this Evidence's adapter -- only net-of-cost figures are available (UNKNOWN, not assumed equal to net).",
    }


# ---------------------------------------------------------------------------
# 9 -- Loss streaks / recovery
# ---------------------------------------------------------------------------


def analyze_loss_streaks_and_recovery(evidence: dict[str, Any], trades: list[dict[str, Any]], deposit: float | None) -> tuple[dict[str, Any], dict[str, Any]]:
    profits = [t["profit"] for t in trades if t.get("profit") is not None]
    loss_streaks = _streak_episodes([p < 0 for p in profits])

    dated = _chronological(trades)
    max_streak_len = max(loss_streaks) if loss_streaks else 0
    # Find the actual max-loss-streak's calendar duration and $ impact by re-walking the sequence.
    streak_duration_days, streak_capital_impact = None, None
    if max_streak_len:
        cur_len, cur_start, cur_sum = 0, None, 0.0
        best_len, best_start, best_end, best_sum = 0, None, None, 0.0
        for t, ts in dated:
            if t["profit"] < 0:
                if cur_len == 0:
                    cur_start = ts
                cur_len += 1
                cur_sum += t["profit"]
                if cur_len > best_len:
                    best_len, best_start, best_end, best_sum = cur_len, cur_start, ts, cur_sum
            else:
                cur_len, cur_sum = 0, 0.0
        streak_duration_days = (best_end - best_start).days if (best_start and best_end) else None
        streak_capital_impact = round(best_sum, 2)

    loss_streaks_summary = {
        "maxConsecutiveLosses": max_streak_len,
        "maxLossStreakDurationDays": streak_duration_days,
        "capitalImpactOfLongestLossStreak": streak_capital_impact,
        "capitalImpactPctOfDeposit": round(abs(streak_capital_impact) / deposit, 4) if (streak_capital_impact and deposit) else None,
        "dataQuality": "AVAILABLE" if loss_streaks else "UNAVAILABLE",
    }

    # M5.1 fix -- see analyze_drawdown's identical comment above.
    real_curve = build_real_equity_curve(evidence)
    has_real_curve = real_curve is not None
    curve = real_curve if has_real_curve else build_balance_equity_curve(trades, deposit)
    episodes = _extract_drawdown_episodes(curve)
    recovered = [e for e in episodes if e["recovered"]]
    unrecovered = [e for e in episodes if not e["recovered"]]
    total_days = (dated[-1][1] - dated[0][1]).days if len(dated) >= 2 else 0
    days_in_drawdown = sum(e["durationDays"] or 0 for e in episodes)

    if not episodes:
        recovery_note = None
    elif has_real_curve:
        recovery_note = "Recovery timing uses the real reconstructed M15 equity curve (see drawdown section's curveType)."
    else:
        recovery_note = "Recovery timing is reconstructed from the same balance-level (trade-close) equity curve as drawdown -- not intraday equity. See drawdown section."

    recovery_summary = {
        "recoveryEpisodes": len(recovered),
        "unrecoveredEpisodesAtEndOfPeriod": len(unrecovered),
        "averageRecoveryDurationDays": round(statistics.mean([e["durationDays"] for e in recovered if e["durationDays"] is not None]), 1) if recovered else None,
        "percentOfPeriodBelowPriorPeak": round(days_in_drawdown / total_days, 4) if total_days > 0 else None,
        "dataQuality": ("AVAILABLE" if has_real_curve else "LIMITED") if episodes else "UNAVAILABLE",
        "note": recovery_note,
    }
    return loss_streaks_summary, recovery_summary


# ---------------------------------------------------------------------------
# 10 -- Tail risk
# ---------------------------------------------------------------------------


def analyze_tail_risk(trades: list[dict[str, Any]], drawdown: dict[str, Any], loss_streaks: dict[str, Any]) -> dict[str, Any]:
    profits = sorted(t["profit"] for t in trades if t.get("profit") is not None)
    losses = [p for p in profits if p < 0]
    if not losses:
        return {"dataQuality": "UNAVAILABLE"}

    gross_loss = abs(sum(losses))
    worst1 = losses[:1]
    worst5 = losses[:5]
    worst10 = losses[:10]
    magnitudes = sorted(abs(p) for p in losses)

    return {
        "worst1Trade": round(sum(worst1), 2),
        "worst5Trades": round(sum(worst5), 2),
        "worst10Trades": round(sum(worst10), 2),
        "worst1SharePctOfGrossLoss": round(abs(sum(worst1)) / gross_loss, 4) if gross_loss else None,
        "worst5SharePctOfGrossLoss": round(abs(sum(worst5)) / gross_loss, 4) if gross_loss else None,
        "worst10SharePctOfGrossLoss": round(abs(sum(worst10)) / gross_loss, 4) if gross_loss else None,
        "P95Loss": round(_percentile(magnitudes, 95), 2) if len(magnitudes) else None,
        "P99Loss": round(_percentile(magnitudes, 99), 2) if len(magnitudes) >= PERCENTILE_MIN_SAMPLE else None,
        "largestDrawdown": drawdown.get("maxDrawdown"),
        "worstLossStreakCapitalImpact": loss_streaks.get("capitalImpactOfLongestLossStreak"),
        "dataQuality": "AVAILABLE" if len(losses) >= PERCENTILE_MIN_SAMPLE else "LIMITED",
        "note": None if len(losses) >= PERCENTILE_MIN_SAMPLE else f"P99Loss withheld (None) -- sample of {len(losses)} losses is below the {PERCENTILE_MIN_SAMPLE}-observation floor.",
    }


# ---------------------------------------------------------------------------
# 11 -- Concentration (reuses M4's TEMPORAL_STABILITY record where possible)
# ---------------------------------------------------------------------------


def analyze_concentration(trades: list[dict[str, Any]], validation_result: dict[str, Any] | None) -> dict[str, Any]:
    wins = sorted((t["profit"] for t in trades if t.get("profit", 0) > 0), reverse=True)
    gross_profit = sum(wins)
    top1_n = max(1, round(len(wins) * 0.01)) if wins else 0
    top5_n = max(1, round(len(wins) * 0.05)) if wins else 0

    result = {
        "top1PctWinnersShareOfGrossProfit": round(sum(wins[:top1_n]) / gross_profit, 4) if gross_profit else None,
        "top5PctWinnersShareOfGrossProfit": round(sum(wins[:top5_n]) / gross_profit, 4) if gross_profit else None,
        "dataQuality": "AVAILABLE" if wins else "UNAVAILABLE",
    }

    ts_record = None
    if validation_result:
        ts_record = next((r for r in validation_result.get("records", []) if r.get("validationType") == "TEMPORAL_STABILITY"), None)
    if ts_record:
        yearly = ts_record["metrics"].get("yearly", {})
        if yearly:
            best_year = max(yearly.items(), key=lambda kv: kv[1]["netProfit"])
            worst_year = min(yearly.items(), key=lambda kv: kv[1]["netProfit"])
            result["bestYear"] = {"year": best_year[0], **best_year[1]}
            result["worstYear"] = {"year": worst_year[0], **worst_year[1]}
        monthly = ts_record["metrics"].get("monthly", {})
        if monthly:
            best_month = max(monthly.items(), key=lambda kv: kv[1]["netProfit"])
            worst_month = min(monthly.items(), key=lambda kv: kv[1]["netProfit"])
            result["bestMonth"] = {"month": best_month[0], **best_month[1]}
            result["worstMonth"] = {"month": worst_month[0], **worst_month[1]}
        result["positivePeriodsCount"] = ts_record["metrics"].get("winningMonths")
        result["negativePeriodsCount"] = ts_record["metrics"].get("losingMonths")
        result["source"] = "reused from M4 TEMPORAL_STABILITY record (not recomputed)"
    else:
        result["note"] = "No M4 TEMPORAL_STABILITY record available to reuse -- best/worst period figures omitted rather than recomputed redundantly."

    return result


# ---------------------------------------------------------------------------
# 12 -- Temporal risk (per-year drawdown/loss-streak -- genuinely new vs. M4)
# ---------------------------------------------------------------------------


def analyze_temporal_risk(trades: list[dict[str, Any]], deposit: float | None) -> dict[str, Any]:
    dated = _chronological(trades)
    by_year: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for t, ts in dated:
        by_year[ts.year].append(t)

    per_year = {}
    for year, year_trades in sorted(by_year.items()):
        year_profits = [t["profit"] for t in year_trades if t.get("profit") is not None]
        curve = build_balance_equity_curve(year_trades, deposit)
        episodes = _extract_drawdown_episodes(curve)
        max_dd = max((e["depth"] for e in episodes), default=0)
        loss_streaks = _streak_episodes([p < 0 for p in year_profits])
        per_year[str(year)] = {
            "tradeCount": len(year_trades),
            "maxDrawdownWithinYear": round(max_dd, 2),
            "maxConsecutiveLossesWithinYear": max(loss_streaks) if loss_streaks else 0,
        }

    worst_year = max(per_year.items(), key=lambda kv: kv[1]["maxDrawdownWithinYear"], default=(None, None))
    return {
        "perYear": per_year,
        "worstDrawdownYear": worst_year[0],
        "dataQuality": "AVAILABLE" if per_year else "UNAVAILABLE",
        "note": "Per-year drawdown/loss-streak computed fresh here (not in M4's TEMPORAL_STABILITY, which only tracked net profit/PF per period).",
    }


# ---------------------------------------------------------------------------
# 13 -- Regime-conditional risk
# ---------------------------------------------------------------------------


def analyze_regime_risk(trades: list[dict[str, Any]]) -> dict[str, Any]:
    tagged = [t for t in trades if t.get("marketRegime") is not None]
    if not tagged:
        return {
            "dataQuality": "UNAVAILABLE",
            "note": "REGIME_DATA_UNAVAILABLE: no trades in this Evidence carry a marketRegime tag. No regime classifier exists yet in this research program -- not inferred.",
            "riskByRegime": {},
        }

    by_regime: dict[str, list[float]] = defaultdict(list)
    for t in tagged:
        by_regime[t["marketRegime"]].append(t["profit"])
    risk_by_regime = {
        r: {"tradeCount": len(v), "netProfit": round(sum(v), 2), "largestLoss": round(min(v), 2) if any(x < 0 for x in v) else 0.0}
        for r, v in by_regime.items()
    }
    return {"dataQuality": "AVAILABLE", "riskByRegime": risk_by_regime}


# ---------------------------------------------------------------------------
# 14 -- Exposure / position risk
# ---------------------------------------------------------------------------


def analyze_exposure_risk(trades: list[dict[str, Any]]) -> dict[str, Any]:
    volumes = [t["volume"] for t in trades if t.get("volume") is not None]
    directions = [t.get("direction") for t in trades]
    long_count = sum(1 for d in directions if d in ("long", "buy"))
    short_count = sum(1 for d in directions if d in ("short", "sell"))

    position_result: dict[str, Any] = {}
    if volumes:
        sorted_vols = sorted(volumes, reverse=True)
        top_decile_n = max(1, round(len(sorted_vols) * 0.10))
        position_result = {
            "maxPositionSize": max(volumes), "averagePositionSize": round(statistics.mean(volumes), 4),
            "positionSizeStdev": round(statistics.pstdev(volumes), 4) if len(volumes) > 1 else 0.0,
            "topDecilePositionShareOfTotalVolume": round(sum(sorted_vols[:top_decile_n]) / sum(volumes), 4) if sum(volumes) else None,
        }

    has_duration = all(t.get("durationSeconds") is not None for t in trades)
    overlap_result: dict[str, Any] = {}
    if has_duration:
        intervals = []
        for t in trades:
            ts_exit = _parse_ts(t["timestamp"])
            if ts_exit is None:
                continue
            entry = ts_exit.timestamp() - t["durationSeconds"]
            intervals.append((entry, ts_exit.timestamp()))
        intervals.sort()
        max_concurrent, cur_open, events = 0, 0, []
        for s, e in intervals:
            events.append((s, 1))
            events.append((e, -1))
        events.sort()
        running = 0
        overlapping_seconds = 0.0
        prev_t = None
        for t_, delta in events:
            if prev_t is not None and running >= 2:
                overlapping_seconds += (t_ - prev_t)
            running += delta
            max_concurrent = max(max_concurrent, running)
            prev_t = t_
        overlap_result = {
            "maxSimultaneousPositions": max_concurrent,
            "hadOverlappingPositions": max_concurrent >= 2,
            "totalOverlapDurationHours": round(overlapping_seconds / 3600, 2),
        }

    quality = "AVAILABLE" if (volumes and has_duration) else ("LIMITED" if volumes else "UNAVAILABLE")
    return {
        "positionSize": position_result or None,
        "directionalConcentration": {"long": long_count, "short": short_count,
                                      "longSharePct": round(long_count / len(directions), 4) if directions else None},
        "simultaneousExposure": overlap_result or None,
        "dataQuality": quality,
        "note": None if has_duration else "EXPOSURE_ANALYSIS_LIMITED: durationSeconds is not populated for every trade in this Evidence -- simultaneous-position reconstruction skipped rather than guessed.",
    }


# ---------------------------------------------------------------------------
# 15 -- Cost risk
# ---------------------------------------------------------------------------


def analyze_cost_risk(trades: list[dict[str, Any]], evidence: dict[str, Any]) -> dict[str, Any]:
    has_commission = all("commission" in t for t in trades)
    has_swap = all("swap" in t for t in trades)
    spread_model = evidence.get("provenance", {}).get("spreadModel")

    if not (has_commission and has_swap):
        return {
            "dataQuality": "UNKNOWN",
            "totalCommission": "UNKNOWN", "totalSwap": "UNKNOWN",
            "spreadModel": spread_model if spread_model is not None else "UNKNOWN",
            "note": "Per-trade commission/swap are not populated for every trade in this Evidence's adapter -- reported UNKNOWN, not assumed zero (M0.1: UNKNOWN != ZERO).",
        }

    total_commission = sum(t["commission"] for t in trades)
    total_swap = sum(t["swap"] for t in trades)
    total_cost = total_commission + total_swap
    gross_profit = sum(t.get("grossProfit", 0) for t in trades if t.get("grossProfit", 0) > 0)
    gross_loss = abs(sum(t.get("grossProfit", 0) for t in trades if t.get("grossProfit", 0) < 0))

    return {
        "totalCommission": round(total_commission, 2), "totalSwap": round(total_swap, 2), "totalCost": round(total_cost, 2),
        "costPerTrade": round(total_cost / len(trades), 4) if trades else None,
        "costAsPctOfGrossProfit": round(abs(total_cost) / gross_profit, 4) if gross_profit else None,
        "costAsPctOfGrossLoss": round(abs(total_cost) / gross_loss, 4) if gross_loss else None,
        "spreadModel": spread_model if spread_model is not None else "UNKNOWN",
        "dataQuality": "AVAILABLE",
        "note": None if spread_model is not None else "spreadModel is UNKNOWN (not zero) -- the source report doesn't expose it; commission/swap above are real measured values, independent of this gap.",
    }


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_risk_analysis(
    evidence_path: Path,
    source_artifact_path: Path | None,
    expected_version_id: str,
    registry_path: Path,
    validation_result: dict[str, Any] | None,
    expected_evidence_hash: str | None = None,
    expected_validation_hash: str | None = None,
) -> dict[str, Any]:
    evidence, trades, evidence_id, val_hash = verify_and_gate(
        evidence_path, source_artifact_path, expected_version_id, registry_path,
        validation_result, expected_evidence_hash, expected_validation_hash,
    )
    deposit = evidence.get("provenance", {}).get("executionAssumptions", {}).get("initialDeposit")

    drawdown = analyze_drawdown(evidence, trades, deposit)
    loss_dist = analyze_loss_distribution(trades)
    win_dist = analyze_win_distribution(trades)
    expectancy = analyze_expectancy(trades)
    loss_streaks, recovery = analyze_loss_streaks_and_recovery(evidence, trades, deposit)
    tail_risk = analyze_tail_risk(trades, drawdown, loss_streaks)
    concentration = analyze_concentration(trades, validation_result)
    temporal_risk = analyze_temporal_risk(trades, deposit)
    regime_risk = analyze_regime_risk(trades)
    exposure_risk = analyze_exposure_risk(trades)
    cost_risk = analyze_cost_risk(trades, evidence)

    data_quality = {
        "drawdown": drawdown["dataQuality"], "lossDistribution": loss_dist["dataQuality"], "winDistribution": win_dist["dataQuality"],
        "expectancy": expectancy["dataQuality"], "lossStreaks": loss_streaks["dataQuality"], "recovery": recovery["dataQuality"],
        "tailRisk": tail_risk["dataQuality"], "concentration": concentration["dataQuality"], "temporalRisk": temporal_risk["dataQuality"],
        "regimeRisk": regime_risk["dataQuality"], "exposureRisk": exposure_risk["dataQuality"], "costRisk": cost_risk["dataQuality"],
    }

    findings, warnings, limitations = [], [], []
    if drawdown.get("note"):
        limitations.append(drawdown["note"])
    if recovery.get("note"):
        limitations.append(recovery["note"])
    if regime_risk.get("note"):
        limitations.append(regime_risk["note"])
    if exposure_risk.get("note"):
        limitations.append(exposure_risk["note"])
    if cost_risk.get("note"):
        limitations.append(cost_risk["note"])
    for dim_name, dim in (("lossDistribution", loss_dist), ("winDistribution", win_dist), ("tailRisk", tail_risk)):
        if dim.get("note"):
            warnings.append(f"{dim_name}: {dim['note']}")

    findings.append(f"Max drawdown (balance): {drawdown.get('maxDrawdown')} ({drawdown.get('maxDrawdownPercent')}), "
                     f"{drawdown.get('episodeCount', 0)} drawdown episodes, {drawdown.get('unrecoveredEpisodes', 0)} unrecovered at end of period.")
    findings.append(f"Expectancy per trade: {expectancy.get('expectancyPerTrade')}. Max consecutive losses: {loss_streaks.get('maxConsecutiveLosses')}.")

    available_count = sum(1 for v in data_quality.values() if v == "AVAILABLE")
    total_dims = len(data_quality)
    if not trades:
        status = "FAILED"
    elif available_count == total_dims:
        status = "COMPLETE"
    elif available_count == 0:
        status = "INCONCLUSIVE"
    else:
        status = "PARTIAL"

    record = RiskAnalysis(
        riskAnalysisId="", versionId=evidence["versionId"], evidenceId=evidence_id, validationId=val_hash,
        rulesetVersion=ACCEPTANCE_RULESET_VERSION, methodologyVersion=METHODOLOGY_VERSION,
        inputEvidenceHash=evidence_id, inputValidationHash=val_hash, generatedAt=_now(),
        drawdown=drawdown, lossDistribution=loss_dist, winDistribution=win_dist, expectancy=expectancy,
        lossStreaks=loss_streaks, recovery=recovery, tailRisk=tail_risk, concentration=concentration,
        temporalRisk=temporal_risk, regimeRisk=regime_risk, exposureRisk=exposure_risk, costRisk=cost_risk,
        dataQuality=data_quality, findings=findings, warnings=warnings, limitations=limitations, status=status,
    )
    record_dict = record.to_dict()
    content_hash = _risk_analysis_content_hash(record_dict)
    record_dict["riskAnalysisId"] = content_hash
    record_dict["riskAnalysisHash"] = content_hash
    return record_dict
