"""
Runs M5 against the REAL, M3-verified + M4-validated G01 v0.1 Evidence and
writes M5_risk_analysis_report.md. Read-only -- touches neither the Evidence
package, the M4 validation code, nor the original .htm report. Does NOT
rerun the 398M-tick backtest, modify the strategy, or optimize parameters.

Run: python run_real_risk_analysis.py
"""

import glob
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "m4-validation-engine"))
from validation_engine import run_validation_suite  # noqa: E402

from risk_analysis_engine import run_risk_analysis

HERE = Path(__file__).parent
REAL_EVIDENCE_DIR = HERE.parent / "m2-evidence-engine" / "real_evidence_output"
SOURCE_ARTIFACT = Path(
    r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm"
)
EXPECTED_VERSION_ID = "G01-v0.1-FROZEN-BASELINE"
REGISTRY = HERE.parent / "m3-evidence-verification" / "version_registry.json"


def find_real_evidence_file() -> Path:
    matches = sorted(glob.glob(str(REAL_EVIDENCE_DIR / "evidence_*.json")))
    if not matches:
        raise FileNotFoundError(f"No Evidence package found in {REAL_EVIDENCE_DIR}")
    return Path(matches[0])


def render_report(result: dict, val_result: dict, evidence_path: Path) -> str:
    dd, ld, wd, ex, ls, rc, tr, cn, tp, rg, ep, cr = (
        result["drawdown"], result["lossDistribution"], result["winDistribution"], result["expectancy"],
        result["lossStreaks"], result["recovery"], result["tailRisk"], result["concentration"],
        result["temporalRisk"], result["regimeRisk"], result["exposureRisk"], result["costRisk"],
    )

    lines = [
        "# M5 Risk Analysis Report",
        "",
        "## Input",
        "",
        f"- Evidence ID: `{result['evidenceId']}`",
        f"- Evidence hash: `{result['inputEvidenceHash']}`",
        f"- Validation ID / hash: `{result['validationId']}` (validation overallStatus was `{val_result['overallStatus']}`)",
        f"- Version: `{result['versionId']}`",
        f"- Risk Analysis ID / content hash: `{result['riskAnalysisId']}`",
        "",
        "This report presents measured risk facts only. No AT24 Score, Trust Status, risk grade, or marketplace-readiness conclusion is implied by anything below. G01's v0.1 baseline is a known losing configuration (PF≈0.888, expectancy≈-$2.18/trade, max drawdown 63.01%, 2,712 trades) — the analysis below is not softened to suggest otherwise.",
        "",
        "## Risk Profile",
        "",
        "### Drawdown",
        "",
        f"- Curve type: {dd['curveType']}",
        f"- Max drawdown: {dd['maxDrawdown']} ({dd['maxDrawdownPercent']:.2%})" if dd.get('maxDrawdownPercent') is not None else f"- Max drawdown: {dd.get('maxDrawdown')}",
        f"- Max drawdown duration: {dd['maxDrawdownDurationDays']} days",
        f"- Average / median drawdown: {dd['averageDrawdown']} / {dd['medianDrawdown']}",
        f"- Drawdown episodes: {dd['episodeCount']} ({dd['unrecoveredEpisodes']} unrecovered at end of period)",
        f"- Data quality: **{dd['dataQuality']}**" + (f" — {dd['note']}" if dd.get("note") else ""),
        "",
        "### Loss Distribution",
        "",
        f"- Count: {ld['count']}, largest: {ld['largestLoss']}, average: {ld['averageLoss']}, median: {ld['medianLoss']}, stdev: {ld['stdevLoss']}",
        f"- Percentiles: P50={ld['percentiles']['P50']}, P75={ld['percentiles']['P75']}, P90={ld['percentiles']['P90']}, P95={ld['percentiles']['P95']}, P99={ld['percentiles']['P99']}",
        f"- Max consecutive losses: {ld['maxConsecutiveLosses']} (avg streak length {ld['averageConsecutiveLossLength']}, {ld['lossStreakEpisodes']} loss-streak episodes)",
        f"- Share of losses that are clustered (streak ≥2): {ld['clusteredLossShare']:.1%}" if ld.get('clusteredLossShare') is not None else "",
        f"- Data quality: **{ld['dataQuality']}**",
        "",
        "### Win Distribution",
        "",
        f"- Count: {wd['count']}, largest: {wd['largestWin']}, average: {wd['averageWin']}, median: {wd['medianWin']}, stdev: {wd['stdevWin']}",
        f"- Percentiles: P50={wd['percentiles']['P50']}, P75={wd['percentiles']['P75']}, P90={wd['percentiles']['P90']}, P95={wd['percentiles']['P95']}, P99={wd['percentiles']['P99']}",
        f"- Max consecutive wins: {wd['maxConsecutiveWins']} (avg streak length {wd['averageConsecutiveWinLength']})",
        f"- Data quality: **{wd['dataQuality']}**",
        "",
        "### Expectancy / Payoff",
        "",
        f"- Expectancy per trade: {ex['expectancyPerTrade']}",
        f"- Average win / loss: {ex['averageWin']} / {ex['averageLoss']} (win/loss ratio {ex['winLossRatio']})",
        f"- Profit Factor (net): {ex['profitFactorNet']}",
        f"- Gross profit / loss (net-of-cost basis): {ex['grossProfitNet']} / {ex['grossLossNet']}",
        f"- Gross profit / loss (pre-cost basis): {ex['grossProfitRaw']} / {ex['grossLossRaw']}",
        f"- Net result: {ex['netResult']}",
        f"- Data quality: **{ex['dataQuality']}**",
        "",
        "### Loss Streaks",
        "",
        f"- Max consecutive losses: {ls['maxConsecutiveLosses']} over {ls['maxLossStreakDurationDays']} days",
        f"- Capital impact of longest loss streak: {ls['capitalImpactOfLongestLossStreak']} ({ls['capitalImpactPctOfDeposit']:.2%} of deposit)" if ls.get('capitalImpactPctOfDeposit') is not None else f"- Capital impact of longest loss streak: {ls['capitalImpactOfLongestLossStreak']}",
        f"- Data quality: **{ls['dataQuality']}**",
        "",
        "### Recovery",
        "",
        f"- Recovery episodes: {rc['recoveryEpisodes']} (unrecovered at end of period: {rc['unrecoveredEpisodesAtEndOfPeriod']})",
        f"- Average recovery duration: {rc['averageRecoveryDurationDays']} days",
        f"- % of tested period spent below prior equity peak: {rc['percentOfPeriodBelowPriorPeak']:.1%}" if rc.get('percentOfPeriodBelowPriorPeak') is not None else "",
        f"- Data quality: **{rc['dataQuality']}**" + (f" — {rc['note']}" if rc.get("note") else ""),
        "",
        "### Tail Risk",
        "",
        f"- Worst 1 / 5 / 10 trades: {tr['worst1Trade']} / {tr['worst5Trades']} / {tr['worst10Trades']}",
        f"- Share of gross loss from worst 1 / 5 / 10 trades: {tr['worst1SharePctOfGrossLoss']:.1%} / {tr['worst5SharePctOfGrossLoss']:.1%} / {tr['worst10SharePctOfGrossLoss']:.1%}",
        f"- P95 loss: {tr['P95Loss']}, P99 loss: {tr['P99Loss']}",
        f"- Data quality: **{tr['dataQuality']}**",
        "",
        "### Concentration",
        "",
        f"- Top 1% / 5% winning trades' share of gross profit: {cn.get('top1PctWinnersShareOfGrossProfit'):.1%} / {cn.get('top5PctWinnersShareOfGrossProfit'):.1%}" if cn.get('top1PctWinnersShareOfGrossProfit') is not None else "",
        f"- Best year: {cn.get('bestYear')}",
        f"- Worst year: {cn.get('worstYear')}",
        f"- Best month: {cn.get('bestMonth')}",
        f"- Worst month: {cn.get('worstMonth')}",
        f"- Positive / negative months: {cn.get('positivePeriodsCount')} / {cn.get('negativePeriodsCount')}",
        f"- Data quality: **{cn['dataQuality']}**",
        "",
        "### Temporal Risk",
        "",
        f"- Worst drawdown year: {tp.get('worstDrawdownYear')}",
        "",
        "| Year | Trades | Max DD within year | Max consecutive losses within year |",
        "|---|---|---|---|",
    ]
    for year, v in tp.get("perYear", {}).items():
        lines.append(f"| {year} | {v['tradeCount']} | {v['maxDrawdownWithinYear']} | {v['maxConsecutiveLossesWithinYear']} |")
    lines += [
        "",
        f"- Data quality: **{tp['dataQuality']}**",
        "",
        "### Regime Risk",
        "",
        f"- Data quality: **{rg['dataQuality']}**",
        f"- {rg.get('note', '')}",
        "",
        "### Exposure Risk",
        "",
        f"- Position size: max={ep['positionSize']['maxPositionSize']}, avg={ep['positionSize']['averagePositionSize']}" if ep.get('positionSize') else "- Position size: n/a",
        f"- Directional split: {ep['directionalConcentration']}",
        f"- Simultaneous exposure: {ep.get('simultaneousExposure')}",
        f"- Data quality: **{ep['dataQuality']}**" + (f" — {ep['note']}" if ep.get("note") else ""),
        "",
        "### Cost Risk",
        "",
        f"- Total commission: {cr.get('totalCommission')}, total swap: {cr.get('totalSwap')}, total cost: {cr.get('totalCost')}",
        f"- Cost per trade: {cr.get('costPerTrade')}",
        f"- Cost as % of gross profit / loss: {cr.get('costAsPctOfGrossProfit')} / {cr.get('costAsPctOfGrossLoss')}",
        f"- Spread model: {cr.get('spreadModel')}",
        f"- Data quality: **{cr['dataQuality']}**" + (f" — {cr['note']}" if cr.get("note") else ""),
        "",
        "## Data Quality Summary",
        "",
        "| Dimension | Quality |",
        "|---|---|",
    ]
    for k, v in result["dataQuality"].items():
        lines.append(f"| {k} | {v} |")

    lines += [
        "",
        "## Findings",
        "",
    ]
    lines += [f"- {f}" for f in result["findings"]]
    lines += [
        "",
        "## Warnings",
        "",
    ]
    lines += [f"- {w}" for w in result["warnings"]] if result["warnings"] else ["None."]
    lines += [
        "",
        "## Limitations",
        "",
    ]
    lines += [f"- {lm}" for lm in result["limitations"]] if result["limitations"] else ["None."]
    lines += [
        "",
        "## Final Status",
        "",
        f"# {result['status']}",
        "",
        "**What this status means:** how much of the risk picture above could be measured from this Evidence (12 dimensions; see Data Quality Summary). It is not a judgment of whether the risk level is acceptable — G01's actual measured risk profile (63.01% max drawdown, negative expectancy, 7 of 9 walk-forward years losing, 16 max consecutive losses) is stated in full above, unsoftened.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    evidence_path = find_real_evidence_file()
    val_result = run_validation_suite(evidence_path, source_artifact_path=SOURCE_ARTIFACT,
                                       expected_version_id=EXPECTED_VERSION_ID, registry_path=REGISTRY)
    result = run_risk_analysis(evidence_path, source_artifact_path=SOURCE_ARTIFACT, expected_version_id=EXPECTED_VERSION_ID,
                                registry_path=REGISTRY, validation_result=val_result)

    report = render_report(result, val_result, evidence_path)
    out_path = HERE / "M5_risk_analysis_report.md"
    out_path.write_text(report, encoding="utf-8")

    print(f"Status: {result['status']}")
    print(f"Data quality: {result['dataQuality']}")
    print(f"Report written: {out_path}")


if __name__ == "__main__":
    main()
