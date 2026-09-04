"""
M4 -- Validation Engine (AT24 Marketplace program).

Consumes M3-VERIFIED Evidence and produces Validation records: measured
facts about sample size, temporal structure (in-sample/OOS, walk-forward),
temporal stability, regime coverage, performance distribution, and
parameter sensitivity. Never produces a quality verdict, Score, or Trust
Status -- see M4_validation_engine.md.

Stdlib-only. Reuses M2's compute_metrics (same reasoning as M3: this
catches DATA disagreement against an already-validated formula, not a
second independent formula implementation) and M3's verify_evidence_package
as the mandatory input gate.
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
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).parent.parent / "m2-evidence-engine"))
sys.path.insert(0, str(Path(__file__).parent.parent / "m3-evidence-verification"))
from evidence_engine import compute_metrics  # noqa: E402
from evidence_verifier import load_evidence_package, verify_evidence_package  # noqa: E402

ENGINE_VERSION = "AT24-M4-Validation-Engine-v1.0"
METHODOLOGY_VERSION = "M4-methodology-v1"
ACCEPTANCE_RULESET_VERSION = "none-defined"  # deliberate -- see design doc section 9

# Sprint M15 (v3 policy, user-directed, 2026-09-04) -- REGIME_COVERAGE and
# PARAMETER_SENSITIVITY are the two validation types AT24 does not yet have
# real infrastructure to compute (no market-regime classifier tagging
# Trade.marketRegime; no multi-parameter-configuration test runner -- see
# each function's own findings text). Every real submission processed so
# far has come back INCONCLUSIVE on exactly these two checks and nothing
# else, which meant overallStatus could never reach PASS for ANY product
# regardless of how strong its actual evidence was -- an unbuilt-capability
# gap masquerading as a per-product quality problem. Explicit, disclosed
# business decision (same style as M7's MIN_OBSERVATIONS_FOR_VALIDATED v2
# policy): an INCONCLUSIVE verdict on ONLY these two types no longer
# single-handedly caps overallStatus. They still run for real every time,
# their real per-check result is still recorded and fully visible in
# `records` (never hidden, never faked as PASS) -- any genuine FAIL or
# WARNING anywhere, including on these two types once real infra exists,
# still gates overallStatus exactly as before. Revisit and re-tighten once
# real regime-classification / parameter-sweep infrastructure exists.
ADVISORY_ONLY_VALIDATION_TYPES = frozenset({"REGIME_COVERAGE", "PARAMETER_SENSITIVITY"})


# ---------------------------------------------------------------------------
# Errors -- each maps 1:1 to a named failure state in the design doc
# ---------------------------------------------------------------------------

class InvalidInputEvidenceError(Exception):
    pass


class DatasetIntegrityFailureError(Exception):
    pass


class TemporalLeakageError(Exception):
    pass


class InvalidValidationWindowError(Exception):
    pass


class ValidationProvenanceFailureError(Exception):
    pass


# ---------------------------------------------------------------------------
# Result model (section 13 of the brief)
# ---------------------------------------------------------------------------


@dataclass
class ValidationRecord:
    validationId: str
    versionId: str
    evidenceId: str
    validationType: str
    rulesetVersion: str
    datasetIdentity: str
    datasetHash: str
    inputEvidenceHash: str
    startedAt: str
    completedAt: str
    methodology: str
    parameters: dict[str, Any]
    metrics: dict[str, Any]
    findings: list[str]
    warnings: list[str]
    status: str  # PASS | FAIL | WARNING | INCONCLUSIVE
    createdBy: str = ENGINE_VERSION

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items()}


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


def dataset_hash(trades: list[dict[str, Any]]) -> str:
    """Hash of the actual data M4 analyzes -- independent of Evidence's own
    _contentHash (which covers the aggregate, not the trade list -- see
    M3's documented note on this same distinction)."""
    canonical = json.dumps(trades, sort_keys=True).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()[:16]


def _now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _record_id(validation_type: str, evidence_id: str) -> str:
    return f"{validation_type}:{evidence_id}"


# ---------------------------------------------------------------------------
# Section 4 -- verified-Evidence prerequisite
# ---------------------------------------------------------------------------


def require_verified_evidence(
    evidence_path: Path,
    source_artifact_path: Path | None,
    expected_version_id: str,
    registry_path: Path,
) -> tuple[dict[str, Any], list[dict[str, Any]], str]:
    m3_result = verify_evidence_package(evidence_path, source_artifact_path, expected_version_id, registry_path)
    if m3_result.status != "VERIFIED":
        raise InvalidInputEvidenceError(
            f"INVALID_INPUT_EVIDENCE: M3 verification status is '{m3_result.status}', not VERIFIED. "
            f"Failures: {m3_result.failures}"
        )
    evidence, trades = load_evidence_package(evidence_path)

    # Note: versionId/_contentHash/periodStart/periodEnd are already hard-gated
    # by M3's own verification (would have raised INVALID_INPUT_EVIDENCE above
    # if missing) -- checked again here would be dead code. sourceAdapter is
    # genuinely M4-specific: M3 never requires it, but M4's provenance chain
    # needs to know which adapter produced this Evidence.
    if not evidence.get("sourceAdapter"):
        raise ValidationProvenanceFailureError("VALIDATION_PROVENANCE_FAILURE: Evidence missing 'sourceAdapter' -- M4 cannot record complete provenance without knowing which adapter produced this Evidence")

    return evidence, trades, m3_result.evidenceId


def _check_dataset_hash(trades: list[dict[str, Any]], expected_dataset_hash: str | None) -> str:
    actual = dataset_hash(trades)
    if expected_dataset_hash is not None and actual != expected_dataset_hash:
        raise DatasetIntegrityFailureError(
            f"DATASET_INTEGRITY_FAILURE: dataset hash {actual} != expected {expected_dataset_hash}"
        )
    return actual


# ---------------------------------------------------------------------------
# 5.1 -- Sample size
# ---------------------------------------------------------------------------


def validate_sample_size(evidence: dict, trades: list[dict], evidence_id: str, ds_hash: str) -> ValidationRecord:
    started = _now()
    profits = [t["profit"] for t in trades if t.get("profit") is not None]
    profit_trades = sum(1 for p in profits if p > 0)
    loss_trades = sum(1 for p in profits if p < 0)
    breakeven_trades = sum(1 for p in profits if p == 0)

    timestamps = sorted(ts for ts in (_parse_ts(t["timestamp"]) for t in trades) if ts)
    duration_days = (timestamps[-1] - timestamps[0]).days if len(timestamps) >= 2 else 0

    by_year: dict[str, int] = defaultdict(int)
    for ts in timestamps:
        by_year[str(ts.year)] += 1

    trades_per_month = (len(trades) / (duration_days / 30.44)) if duration_days > 0 else None

    metrics = {
        "tradeCount": len(trades),
        "profitTradeCount": profit_trades,
        "lossTradeCount": loss_trades,
        "breakEvenTradeCount": breakeven_trades,
        "durationDays": duration_days,
        "tradesPerMonth": round(trades_per_month, 2) if trades_per_month else None,
        "observationsPerYear": dict(sorted(by_year.items())),
    }

    findings = [f"{len(trades)} trades over {duration_days} days ({duration_days/365.25:.1f} years) across {len(by_year)} distinct calendar years."]
    status = "FAIL" if len(trades) == 0 else "PASS"
    if len(trades) == 0:
        findings.append("Zero trades -- no sample-size facts are measurable.")

    return ValidationRecord(
        validationId=_record_id("SAMPLE_SIZE", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
        validationType="SAMPLE_SIZE", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[]",
        datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
        methodology="Direct count/duration measurement, no acceptance threshold applied.",
        parameters={}, metrics=metrics, findings=findings, warnings=[], status=status,
    )


# ---------------------------------------------------------------------------
# 6/7 -- Temporal split + Out-of-sample
# ---------------------------------------------------------------------------


def assert_no_leakage(before_segment: list[dict], after_segment: list[dict], boundary: datetime) -> None:
    """Hard leakage assertion, callable on its own (not just trusted as a
    by-product of correct slicing logic) -- every trade in `before_segment`
    must be strictly before `boundary`; every trade in `after_segment` must
    be at/after it. Raises TemporalLeakageError otherwise."""
    for t in before_segment:
        ts = _parse_ts(t["timestamp"])
        if ts is not None and ts >= boundary:
            raise TemporalLeakageError(f"TEMPORAL_LEAKAGE: trade at {ts} classified before the boundary but falls at/after boundary {boundary}")
    for t in after_segment:
        ts = _parse_ts(t["timestamp"])
        if ts is not None and ts < boundary:
            raise TemporalLeakageError(f"TEMPORAL_LEAKAGE: trade at {ts} classified after the boundary but falls before boundary {boundary}")


def split_in_sample_oos(trades: list[dict], split_ratio: float = 0.8) -> tuple[list[dict], list[dict], datetime]:
    timestamps = sorted(ts for ts in (_parse_ts(t["timestamp"]) for t in trades) if ts)
    if len(timestamps) < 2:
        raise InvalidValidationWindowError("INVALID_VALIDATION_WINDOW: fewer than 2 timestamped trades -- cannot define a temporal split")

    start, end = timestamps[0], timestamps[-1]
    boundary = start + (end - start) * split_ratio

    in_sample = [t for t in trades if (_parse_ts(t["timestamp"]) or start) < boundary]
    oos = [t for t in trades if (_parse_ts(t["timestamp"]) or start) >= boundary]

    assert_no_leakage(in_sample, oos, boundary)
    return in_sample, oos, boundary


def validate_out_of_sample(evidence: dict, trades: list[dict], evidence_id: str, ds_hash: str, split_ratio: float = 0.8) -> ValidationRecord:
    started = _now()
    in_sample, oos, boundary = split_in_sample_oos(trades, split_ratio)
    deposit = evidence.get("provenance", {}).get("executionAssumptions", {}).get("initialDeposit")

    in_sample_metrics = compute_metrics(in_sample, initial_deposit=deposit) if in_sample else None
    oos_metrics = compute_metrics(oos, initial_deposit=deposit) if oos else None

    findings = [
        f"Split boundary (time-based, {split_ratio:.0%} in-sample): {boundary.isoformat()}",
        f"In-sample: {len(in_sample)} trades. Out-of-sample: {len(oos)} trades.",
    ]
    warnings: list[str] = []
    if not in_sample or not oos:
        status = "INCONCLUSIVE"
        findings.append("One segment is empty -- in-sample and out-of-sample metrics cannot both be computed.")
    else:
        status = "PASS"
        findings.append("In-sample and out-of-sample metrics computed independently and are reported separately below -- never combined into one number.")
        if len(oos) < 30:
            warnings.append(f"Out-of-sample segment has only {len(oos)} trades -- thin relative to typical statistical comfort; reported as a fact, no acceptance threshold applied (see design doc section 7/9).")

    return ValidationRecord(
        validationId=_record_id("OUT_OF_SAMPLE", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
        validationType="OUT_OF_SAMPLE", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[]",
        datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
        methodology=f"Time-based split at {split_ratio:.0%} of [first trade, last trade] duration ({METHODOLOGY_VERSION}).",
        parameters={"splitRatio": split_ratio, "boundary": boundary.isoformat()},
        metrics={"inSampleMetrics": in_sample_metrics, "outOfSampleMetrics": oos_metrics,
                 "inSampleTradeCount": len(in_sample), "outOfSampleTradeCount": len(oos)},
        findings=findings, warnings=warnings, status=status,
    )


# ---------------------------------------------------------------------------
# 8 -- Walk-forward (one window per calendar year)
# ---------------------------------------------------------------------------


def validate_walk_forward(evidence: dict, trades: list[dict], evidence_id: str, ds_hash: str) -> ValidationRecord:
    started = _now()
    deposit = evidence.get("provenance", {}).get("executionAssumptions", {}).get("initialDeposit")

    dated = [(t, _parse_ts(t["timestamp"])) for t in trades]
    dated = [(t, ts) for t, ts in dated if ts is not None]
    if not dated:
        raise InvalidValidationWindowError("INVALID_VALIDATION_WINDOW: no timestamped trades to build walk-forward windows from")

    years = sorted({ts.year for _, ts in dated})
    windows = []
    all_measurable = True
    for test_year in years[1:]:  # first year has no prior training data -- it's the initial training window, not a test window
        train = [t for t, ts in dated if ts.year < test_year]
        test = [t for t, ts in dated if ts.year == test_year]

        train_start = min(ts for _, ts in dated if ts.year < test_year) if train else None
        train_end = max(ts for _, ts in dated if ts.year < test_year) if train else None
        test_start, test_end = datetime(test_year, 1, 1), datetime(test_year, 12, 31, 23, 59, 59)

        # Leakage assertion: no train-window trade may fall inside or after the test window.
        assert_no_leakage(train, test, test_start)

        train_metrics = compute_metrics(train, initial_deposit=deposit) if train else None
        test_metrics = compute_metrics(test, initial_deposit=deposit) if test else None
        window_status = "PASS" if test else "INCONCLUSIVE"
        if not test:
            all_measurable = False

        windows.append({
            "testYear": test_year,
            "trainStart": train_start.isoformat() if train_start else None,
            "trainEnd": train_end.isoformat() if train_end else None,
            "testStart": test_start.isoformat(),
            "testEnd": test_end.isoformat(),
            "trainTradeCount": len(train),
            "testTradeCount": len(test),
            "trainMetrics": train_metrics,
            "testMetrics": test_metrics,
            "configurationVersion": evidence["versionId"],  # same strategy config in every window -- no reoptimization
            "status": window_status,
        })

    findings = [f"{len(windows)} walk-forward windows (one per calendar year from {years[1]} to {years[-1]}, "
                f"{years[0]} reserved as the initial training-only period). Same configuration ({evidence['versionId']}) used in every window -- no re-optimization between windows."]
    status = "PASS" if all_measurable else "WARNING"
    if not all_measurable:
        findings.append("At least one window had zero test-period trades -- see per-window status.")

    return ValidationRecord(
        validationId=_record_id("WALK_FORWARD", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
        validationType="WALK_FORWARD", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[]",
        datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
        methodology=f"Expanding-window, one test window per calendar year ({METHODOLOGY_VERSION}). Never collapsed into a single score.",
        parameters={"windowDefinition": "calendar-year", "windowCount": len(windows)},
        metrics={"windows": windows}, findings=findings, warnings=[], status=status,
    )


# ---------------------------------------------------------------------------
# 9 -- Temporal stability
# ---------------------------------------------------------------------------


def validate_temporal_stability(evidence: dict, trades: list[dict], evidence_id: str, ds_hash: str) -> ValidationRecord:
    started = _now()
    dated = [(t, _parse_ts(t["timestamp"])) for t in trades]
    dated = [(t, ts) for t, ts in dated if ts is not None]

    monthly: dict[str, list[float]] = defaultdict(list)
    for t, ts in dated:
        monthly[f"{ts.year:04d}-{ts.month:02d}"].append(t["profit"])

    monthly_summary = {k: {"tradeCount": len(v), "netProfit": round(sum(v), 2)} for k, v in sorted(monthly.items())}

    quarterly: dict[str, list[float]] = defaultdict(list)
    for t, ts in dated:
        quarterly[f"{ts.year:04d}-Q{(ts.month-1)//3+1}"].append(t["profit"])
    quarterly_summary = {k: {"tradeCount": len(v), "netProfit": round(sum(v), 2)} for k, v in sorted(quarterly.items())}

    yearly: dict[str, list[float]] = defaultdict(list)
    for t, ts in dated:
        yearly[str(ts.year)].append(t["profit"])
    yearly_summary = {k: {"tradeCount": len(v), "netProfit": round(sum(v), 2)} for k, v in sorted(yearly.items())}

    # Longest inactive period between consecutive trades.
    sorted_ts = sorted(ts for _, ts in dated)
    longest_gap_days = max(((sorted_ts[i + 1] - sorted_ts[i]).days for i in range(len(sorted_ts) - 1)), default=0)

    # Performance concentration: what fraction of TOTAL POSITIVE monthly profit
    # came from the single best month (a transparent, explainable measure --
    # not a hidden composite score).
    positive_months = [v["netProfit"] for v in monthly_summary.values() if v["netProfit"] > 0]
    concentration = (max(positive_months) / sum(positive_months)) if positive_months else None

    metrics = {
        "monthly": monthly_summary,
        "quarterly": quarterly_summary,
        "yearly": yearly_summary,
        "longestInactiveGapDays": longest_gap_days,
        "bestMonthShareOfPositiveMonths": round(concentration, 4) if concentration is not None else None,
        "winningMonths": sum(1 for v in monthly_summary.values() if v["netProfit"] > 0),
        "losingMonths": sum(1 for v in monthly_summary.values() if v["netProfit"] < 0),
        "flatMonths": sum(1 for v in monthly_summary.values() if v["netProfit"] == 0),
    }

    findings = [f"{len(monthly_summary)} distinct months, {len(yearly_summary)} distinct years represented.",
                f"Longest gap with zero trades: {longest_gap_days} days."]
    if concentration is not None:
        findings.append(f"The single best month accounts for {concentration:.1%} of all positive monthly profit -- reported as a fact, no pass/fail threshold applied.")

    return ValidationRecord(
        validationId=_record_id("TEMPORAL_STABILITY", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
        validationType="TEMPORAL_STABILITY", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[]",
        datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
        methodology="Calendar-period aggregation (month/quarter/year) plus inter-trade gap and best-single-period concentration.",
        parameters={}, metrics=metrics, findings=findings, warnings=[], status="PASS" if dated else "FAIL",
    )


# ---------------------------------------------------------------------------
# 10 -- Regime coverage
# ---------------------------------------------------------------------------


def validate_regime_coverage(evidence: dict, trades: list[dict], evidence_id: str, ds_hash: str) -> ValidationRecord:
    started = _now()
    regimes_present = {t.get("marketRegime") for t in trades}
    tagged = [t for t in trades if t.get("marketRegime") is not None]

    if not tagged:
        return ValidationRecord(
            validationId=_record_id("REGIME_COVERAGE", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
            validationType="REGIME_COVERAGE", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[]",
            datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
            methodology="Per-regime trade grouping using Trade.marketRegime, when present.",
            parameters={}, metrics={"regimesRepresented": [], "tradeCountByRegime": {}},
            findings=["No trades in this Evidence carry a marketRegime tag -- regime coverage cannot be computed for this Evidence. "
                      "No regime classifier exists yet in this research program (see design doc section 11); this is reported honestly, not fabricated."],
            warnings=[], status="INCONCLUSIVE",
        )

    by_regime: dict[str, list[float]] = defaultdict(list)
    for t in tagged:
        by_regime[t["marketRegime"]].append(t["profit"])
    metrics_by_regime = {r: {"tradeCount": len(v), "netProfit": round(sum(v), 2)} for r, v in by_regime.items()}

    return ValidationRecord(
        validationId=_record_id("REGIME_COVERAGE", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
        validationType="REGIME_COVERAGE", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[]",
        datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
        methodology="Per-regime trade grouping using Trade.marketRegime.",
        parameters={}, metrics={"regimesRepresented": sorted(regimes_present - {None}), "tradeCountByRegime": metrics_by_regime},
        findings=[f"{len(regimes_present - {None})} regime(s) represented across {len(tagged)} tagged trades."],
        warnings=[], status="PASS",
    )


# ---------------------------------------------------------------------------
# 11 -- Performance distribution
# ---------------------------------------------------------------------------


def validate_performance_distribution(evidence: dict, trades: list[dict], evidence_id: str, ds_hash: str) -> ValidationRecord:
    started = _now()
    deposit = evidence.get("provenance", {}).get("executionAssumptions", {}).get("initialDeposit")
    base = compute_metrics(trades, initial_deposit=deposit)

    profits = sorted(t["profit"] for t in trades if t.get("profit") is not None)
    median_trade = statistics.median(profits) if profits else None

    wins = [p for p in profits if p > 0]
    losses = [p for p in profits if p < 0]
    win_rate = len(wins) / len(profits) if profits else 0
    loss_rate = len(losses) / len(profits) if profits else 0
    avg_win = statistics.mean(wins) if wins else 0
    avg_loss = statistics.mean(losses) if losses else 0
    expectancy = (win_rate * avg_win) + (loss_rate * avg_loss)  # avg_loss already negative

    # Top-decile profit concentration: share of total GROSS profit contributed
    # by the best 10% of winning trades (transparent, explainable; not a
    # hidden Gini-style composite).
    sorted_wins = sorted(wins, reverse=True)
    decile_n = max(1, round(len(sorted_wins) * 0.10)) if sorted_wins else 0
    top_decile_profit = sum(sorted_wins[:decile_n])
    gross_profit = sum(wins) if wins else 0
    top_decile_share = (top_decile_profit / gross_profit) if gross_profit > 0 else None

    metrics = {
        "profitFactor": base["profitFactor"],
        "winRate": base["winRate"],
        "avgTrade": base["avgTrade"],
        "medianTrade": round(median_trade, 2) if median_trade is not None else None,
        "expectancy": round(expectancy, 4),
        "maxDrawdown": base["maxDrawdown"],
        "largestWin": base["largestWin"],
        "largestLoss": base["largestLoss"],
        "consecutiveWins": base["consecutiveWins"],
        "consecutiveLosses": base["consecutiveLosses"],
        "topDecileWinShareOfGrossProfit": round(top_decile_share, 4) if top_decile_share is not None else None,
    }
    findings = [f"Median trade P&L: {metrics['medianTrade']}. Expectancy per trade: {metrics['expectancy']}."]
    if top_decile_share is not None:
        findings.append(f"Best 10% of winning trades account for {top_decile_share:.1%} of total gross profit -- a concentration fact, not a pass/fail judgment.")

    return ValidationRecord(
        validationId=_record_id("PERFORMANCE_DISTRIBUTION", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
        validationType="PERFORMANCE_DISTRIBUTION", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[]",
        datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
        methodology="Distribution statistics beyond total return: median, expectancy, streaks, top-decile concentration.",
        parameters={}, metrics=metrics, findings=findings, warnings=[], status="PASS" if trades else "FAIL",
    )


# ---------------------------------------------------------------------------
# 12 -- Parameter sensitivity (framework; see design doc section 12)
# ---------------------------------------------------------------------------


def compare_configurations(baseline_metrics: dict, variant_metrics: dict) -> dict[str, Any]:
    keys = ["netProfit", "profitFactor", "winRate", "tradeCount", "maxDrawdown"]
    diff = {}
    for k in keys:
        b = baseline_metrics.get(k)
        v = variant_metrics.get(k)
        if isinstance(b, dict):  # maxDrawdown is a nested dict
            b, v = b.get("absolute"), (v or {}).get("absolute")
        diff[k] = {"baseline": b, "variant": v, "delta": (round(v - b, 4) if (v is not None and b is not None) else None)}
    return diff


def validate_parameter_sensitivity(
    evidence: dict, evidence_id: str, ds_hash: str,
    configurations: dict[str, list[dict]] | None,
) -> ValidationRecord:
    started = _now()
    if not configurations:
        return ValidationRecord(
            validationId=_record_id("PARAMETER_SENSITIVITY", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
            validationType="PARAMETER_SENSITIVITY", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="n/a",
            datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
            methodology="Baseline-vs-perturbed-configuration comparison (framework only -- see design doc section 12).",
            parameters={}, metrics={}, findings=[
                "Not executed for this Evidence: real parameter-sensitivity analysis requires new backtests with "
                "perturbed EA inputs, which this sprint's guardrails explicitly forbid ('Do not optimize G01. Do not "
                "change G01 parameters.'). The framework itself is built and verified against synthetic configurations "
                "(see test_validation_engine.py Test H). Deferred to a future sprint that explicitly authorizes new runs."],
            warnings=[], status="INCONCLUSIVE",
        )

    if "baseline" not in configurations:
        raise ValueError("configurations must include a 'baseline' key")

    deposit = evidence.get("provenance", {}).get("executionAssumptions", {}).get("initialDeposit")
    baseline_metrics = compute_metrics(configurations["baseline"], initial_deposit=deposit)
    results = {"baseline": {"metrics": baseline_metrics, "differenceFromBaseline": None}}
    for name, trades in configurations.items():
        if name == "baseline":
            continue
        variant_metrics = compute_metrics(trades, initial_deposit=deposit)
        results[name] = {"metrics": variant_metrics, "differenceFromBaseline": compare_configurations(baseline_metrics, variant_metrics)}

    return ValidationRecord(
        validationId=_record_id("PARAMETER_SENSITIVITY", evidence_id), versionId=evidence["versionId"], evidenceId=evidence_id,
        validationType="PARAMETER_SENSITIVITY", rulesetVersion=ACCEPTANCE_RULESET_VERSION, datasetIdentity="trades[] per configuration",
        datasetHash=ds_hash, inputEvidenceHash=evidence_id, startedAt=started, completedAt=_now(),
        methodology="Baseline-vs-perturbed-configuration comparison; each configuration recorded independently.",
        parameters={"configurationNames": list(configurations.keys())},
        metrics={"configurations": results}, findings=[f"{len(configurations)} configurations compared against baseline."],
        warnings=[], status="PASS",
    )


# ---------------------------------------------------------------------------
# Suite orchestration
# ---------------------------------------------------------------------------


def run_validation_suite(
    evidence_path: Path,
    source_artifact_path: Path | None,
    expected_version_id: str,
    registry_path: Path,
    expected_dataset_hash: str | None = None,
    parameter_configurations: dict[str, list[dict]] | None = None,
    oos_split_ratio: float = 0.8,
) -> dict[str, Any]:
    evidence, trades, evidence_id = require_verified_evidence(evidence_path, source_artifact_path, expected_version_id, registry_path)
    ds_hash = _check_dataset_hash(trades, expected_dataset_hash)

    records = [
        validate_sample_size(evidence, trades, evidence_id, ds_hash),
        validate_out_of_sample(evidence, trades, evidence_id, ds_hash, oos_split_ratio),
        validate_walk_forward(evidence, trades, evidence_id, ds_hash),
        validate_temporal_stability(evidence, trades, evidence_id, ds_hash),
        validate_regime_coverage(evidence, trades, evidence_id, ds_hash),
        validate_performance_distribution(evidence, trades, evidence_id, ds_hash),
        validate_parameter_sensitivity(evidence, evidence_id, ds_hash, parameter_configurations),
    ]

    statuses = [r.status for r in records]
    blocking_statuses = [r.status for r in records if r.validationType not in ADVISORY_ONLY_VALIDATION_TYPES]
    if "FAIL" in statuses:
        overall = "FAIL"
    elif "WARNING" in statuses:
        overall = "WARNING"
    elif "INCONCLUSIVE" in blocking_statuses:
        overall = "INCONCLUSIVE"
    else:
        overall = "PASS"

    return {
        "evidenceId": evidence_id,
        "versionId": evidence["versionId"],
        "datasetHash": ds_hash,
        "engineVersion": ENGINE_VERSION,
        "methodologyVersion": METHODOLOGY_VERSION,
        "overallStatus": overall,
        "records": [r.to_dict() for r in records],
    }
