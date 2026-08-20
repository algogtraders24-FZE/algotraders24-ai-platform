"""
Runs the M4 validation suite against the REAL, M3-verified G01 v0.1 Evidence
and writes M4_validation_report.md. Read-only -- touches neither the
Evidence package, the M2/M3 outputs, nor the original .htm report.
No parameter-sensitivity configurations are supplied (see design doc
section 12/17 -- running real perturbations against G01 is out of scope
and forbidden by this sprint's guardrails).

Run: python run_real_validation.py
"""

import glob
from pathlib import Path

from validation_engine import run_validation_suite

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


def _fmt_metrics(m: dict | None) -> str:
    if m is None:
        return "_(no trades in this segment)_"
    return (f"trades={m['tradeCount']}, netProfit={m['netProfit']}, PF={m['profitFactor']}, "
            f"winRate={m['winRate']:.2%}, maxDD={m['maxDrawdown']['percent']:.2%}")


def render_report(result: dict, evidence_path: Path) -> str:
    by_type = {r["validationType"]: r for r in result["records"]}
    ss = by_type["SAMPLE_SIZE"]
    oos = by_type["OUT_OF_SAMPLE"]
    wf = by_type["WALK_FORWARD"]
    ts = by_type["TEMPORAL_STABILITY"]
    rc = by_type["REGIME_COVERAGE"]
    pd = by_type["PERFORMANCE_DISTRIBUTION"]
    ps = by_type["PARAMETER_SENSITIVITY"]

    lines = [
        "# M4 Validation Report",
        "",
        f"**Evidence package:** `{evidence_path}`  ",
        f"**Engine:** {result['engineVersion']}  ",
        f"**Methodology version:** {result['methodologyVersion']}  ",
        f"**Dataset hash:** `{result['datasetHash']}`",
        "",
        "This report presents measured facts from independent validation procedures. It does not conclude that G01 is profitable, robust, or fit for listing -- see `M4_validation_engine.md` section 13/14 for the exact boundary. The frozen G01 v0.1 baseline is known to be a losing configuration (PF≈0.89, net profit≈-$5,909, max DD 63.01% per the M2.1/M3 record) — this report states that plainly rather than around it.",
        "",
        "## Input Evidence",
        "",
        f"- Evidence ID: `{result['evidenceId']}`",
        f"- Version: `{result['versionId']}`",
        f"- Source artifact: `{SOURCE_ARTIFACT.name}`",
        "",
        "## Sample",
        "",
        f"- Trade count: {ss['metrics']['tradeCount']}",
        f"- Profitable / losing / break-even: {ss['metrics']['profitTradeCount']} / {ss['metrics']['lossTradeCount']} / {ss['metrics']['breakEvenTradeCount']}",
        f"- Duration: {ss['metrics']['durationDays']} days (~{ss['metrics']['durationDays']/365.25:.1f} years)",
        f"- Trades/month: {ss['metrics']['tradesPerMonth']}",
        f"- Years represented: {', '.join(sorted(ss['metrics']['observationsPerYear'].keys()))}",
        f"- Status: **{ss['status']}**",
        "",
        "## Temporal",
        "",
        f"### Out-of-Sample (time-based {oos['parameters']['splitRatio']:.0%} split, boundary {oos['parameters']['boundary']})",
        "",
        f"- In-sample: {_fmt_metrics(oos['metrics']['inSampleMetrics'])}",
        f"- Out-of-sample: {_fmt_metrics(oos['metrics']['outOfSampleMetrics'])}",
        f"- Status: **{oos['status']}**" + (f" — {oos['warnings'][0]}" if oos["warnings"] else ""),
        "",
        "### Walk-Forward (one window per calendar year, same configuration in every window)",
        "",
        "| Test Year | Train Trades | Test Trades | Test Net Profit | Test PF | Window Status |",
        "|---|---|---|---|---|---|",
    ]
    for w in wf["metrics"]["windows"]:
        tm = w["testMetrics"]
        lines.append(f"| {w['testYear']} | {w['trainTradeCount']} | {w['testTradeCount']} | "
                      f"{tm['netProfit'] if tm else '-'} | {tm['profitFactor'] if tm else '-'} | {w['status']} |")
    lines += [
        "",
        f"- Walk-Forward record status: **{wf['status']}**",
        "",
        "## Stability",
        "",
        f"- Longest inactive gap: {ts['metrics']['longestInactiveGapDays']} days",
        f"- Winning / losing / flat months: {ts['metrics']['winningMonths']} / {ts['metrics']['losingMonths']} / {ts['metrics']['flatMonths']}",
        f"- Best single month's share of all positive monthly profit: {ts['metrics']['bestMonthShareOfPositiveMonths']:.1%}" if ts["metrics"]["bestMonthShareOfPositiveMonths"] is not None else "- Best-month concentration: n/a",
        "",
        "**Yearly breakdown:**",
        "",
        "| Year | Trades | Net Profit |",
        "|---|---|---|",
    ]
    for year, v in ts["metrics"]["yearly"].items():
        lines.append(f"| {year} | {v['tradeCount']} | {v['netProfit']} |")
    lines += [
        "",
        f"- Status: **{ts['status']}**",
        "",
        "## Regime",
        "",
        f"- Status: **{rc['status']}**",
        f"- {rc['findings'][0]}",
        "",
        "## Performance Distribution",
        "",
        f"- Profit Factor: {pd['metrics']['profitFactor']}",
        f"- Win Rate: {pd['metrics']['winRate']:.2%}",
        f"- Median trade: {pd['metrics']['medianTrade']}",
        f"- Expectancy per trade: {pd['metrics']['expectancy']}",
        f"- Max Drawdown: {pd['metrics']['maxDrawdown']['percent']:.2%}",
        f"- Largest win / loss: {pd['metrics']['largestWin']} / {pd['metrics']['largestLoss']}",
        f"- Consecutive wins / losses: {pd['metrics']['consecutiveWins']} / {pd['metrics']['consecutiveLosses']}",
        f"- Top-decile winning trades' share of gross profit: {pd['metrics']['topDecileWinShareOfGrossProfit']:.1%}" if pd["metrics"]["topDecileWinShareOfGrossProfit"] is not None else "",
        f"- Status: **{pd['status']}**",
        "",
        "## Parameter Sensitivity",
        "",
        f"- Status: **{ps['status']}**",
        f"- {ps['findings'][0]}",
        "",
        "## Final Validation Status",
        "",
        f"# {result['overallStatus']}",
        "",
        "### Why this status",
        "",
    ]

    if result["overallStatus"] == "INCONCLUSIVE":
        lines += [
            "`INCONCLUSIVE` because two of the seven validation types could not be completed for this specific Evidence, "
            "for reasons that are facts about the input, not defects in the engine:",
            "",
            f"- **Regime Coverage** is `{rc['status']}`: this Evidence's trade records carry no regime classification "
            "(no regime classifier exists yet in this research program).",
            f"- **Parameter Sensitivity** is `{ps['status']}`: real perturbation analysis was not run against G01 in this "
            "sprint per the explicit guardrail against re-parameterizing/optimizing G01.",
            "",
            "The other five validation types (Sample Size, Out-of-Sample, Walk-Forward, Temporal Stability, Performance "
            "Distribution) all completed and are `PASS`/`WARNING`, meaning: the procedures ran correctly and produced "
            "trustworthy facts. Those facts show a losing strategy (negative net profit, PF<1 in-sample and consistent "
            "with that out-of-sample) across the full walk-forward history — `INCONCLUSIVE` does not soften that; it only "
            "reflects that two *additional* validation dimensions have no data to report on yet, not that the ones which "
            "did complete are in question.",
        ]
    elif result["overallStatus"] == "FAIL":
        lines += ["At least one validation type structurally failed -- see the FAIL-status record(s) above for the specific reason."]
    else:
        lines += [f"All validation types reached a conclusive result; aggregate status is {result['overallStatus']}."]

    lines += [
        "",
        "**What this status does not mean:** no AT24 Score, Trust Status, or marketplace-readiness conclusion is implied by any status on this page. Those are M5 (Risk Analysis) / M6+ (Score, Trust Status), not yet run.",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    evidence_path = find_real_evidence_file()
    result = run_validation_suite(
        evidence_path,
        source_artifact_path=SOURCE_ARTIFACT,
        expected_version_id=EXPECTED_VERSION_ID,
        registry_path=REGISTRY,
        expected_dataset_hash=None,
        parameter_configurations=None,  # deliberately not run against real G01 -- see design doc
    )
    report = render_report(result, evidence_path)
    out_path = HERE / "M4_validation_report.md"
    out_path.write_text(report, encoding="utf-8")

    print(f"Overall status: {result['overallStatus']}")
    for r in result["records"]:
        print(f"  {r['validationType']}: {r['status']}")
    print(f"Report written: {out_path}")


if __name__ == "__main__":
    main()
