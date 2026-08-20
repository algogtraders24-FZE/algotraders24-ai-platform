"""
M2.1 real-data tests -- exercises the engine against the GENUINE archived
G01 v0.1 baseline MT5 report (not a synthetic fixture), plus deliberately
broken variants derived from it, per the M2.1 sprint's required test list:
  1. genuine v0.1 report        -> full pipeline succeeds, cross-check printed
  2. corrupted report           -> truncated real file, clean halt
  3. encoding failure           -> invalid bytes, clean halt
  4. malformed Deals table      -> missing column, clean halt
  5. immutability                -> second run against same real report refuses to overwrite

The real report lives outside this repo (on this research machine's MT5
terminal data folder) and is never modified by these tests -- only read.
If it isn't present (a different machine/session), the real-report tests
print a skip notice rather than failing the whole suite.
"""

import shutil
import sys
from pathlib import Path

from evidence_engine import (
    _read_html_text,
    parse_mt5_deals_table,
    reconcile_deals_to_trades,
    run_pipeline_from_deals_table,
)

REAL_REPORT = Path(
    r"C:\Users\om\AppData\Roaming\MetaQuotes\Terminal\8762A67661860246215827420BCD27F8\G01_Baseline_v0.1_Report.htm"
)

HERE = Path(__file__).parent
SCRATCH = HERE / "test_fixtures" / "_real_data_scratch"

KNOWN_BASELINE = {
    "tradeCount": 2712,
    "winRatePercent": 33.52,
    "profitFactor": 0.89,
    "netProfit": -5909.32,
    "sharpe": -1.69,
    "maxDrawdownPercent": 63.01,
}


def test_genuine_v01_report() -> None:
    if not REAL_REPORT.exists():
        print(f"test_genuine_v01_report: SKIPPED (real report not found at {REAL_REPORT} on this machine)")
        return

    out_dir = SCRATCH / "genuine"
    if out_dir.exists():
        shutil.rmtree(out_dir)

    out_path = run_pipeline_from_deals_table(REAL_REPORT, version_id="G01-v0.1-FROZEN-BASELINE", out_dir=out_dir)

    import json
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    ev = payload["evidence"]
    metrics = ev["metricsSummary"]
    xcheck = ev["reportCrossCheck"]

    assert ev["sourceAdapter"] == "mt5-deals-table-v1"
    assert metrics["tradeCount"] == KNOWN_BASELINE["tradeCount"], metrics["tradeCount"]
    assert abs(metrics["netProfit"] - KNOWN_BASELINE["netProfit"]) < 0.01, metrics["netProfit"]
    assert round(metrics["profitFactor"], 2) == KNOWN_BASELINE["profitFactor"], metrics["profitFactor"]
    assert len(payload["trades"]) == 2712

    print("\n=== M2.1 real-data cross-check: G01 v0.1 frozen baseline ===")
    print(f"{'metric':<20}{'computed':>14}{'MT5 report':>14}{'delta':>10}")
    for key in ("netProfit", "profitFactor", "tradeCount", "winRatePercent", "maxDrawdownPercent", "largestWin", "largestLoss", "sharpe"):
        row = xcheck[key]
        computed = row["computed"]
        report_val = row["reportValue"]
        delta = row.get("delta")
        print(f"{key:<20}{str(computed):>14}{str(report_val):>14}{str(delta):>10}")
    print(f"\nSource artifact: {REAL_REPORT}")
    print(f"Source sha256: {ev['provenance']['dataSource']['reportFileSha256'][:16]}...")
    print(f"Content hash: {ev['_contentHash']}")
    print(f"Evidence written: {out_path}")
    print("test_genuine_v01_report: PASS")


def test_immutability_on_real_report() -> None:
    if not REAL_REPORT.exists():
        print("test_immutability_on_real_report: SKIPPED (real report not present)")
        return
    out_dir = SCRATCH / "genuine"  # reuse the same dir/version-id as the previous test on purpose
    try:
        run_pipeline_from_deals_table(REAL_REPORT, version_id="G01-v0.1-FROZEN-BASELINE", out_dir=out_dir)
        raise AssertionError("expected FileExistsError re-running against the same real report, got none")
    except FileExistsError:
        print("test_immutability_on_real_report: PASS")


def test_corrupted_report() -> None:
    if not REAL_REPORT.exists():
        print("test_corrupted_report: SKIPPED (real report not present)")
        return
    raw = REAL_REPORT.read_bytes()
    truncated = SCRATCH / "truncated_report.htm"
    SCRATCH.mkdir(parents=True, exist_ok=True)
    truncated.write_bytes(raw[: len(raw) // 2])  # cut the Deals table off mid-stream

    try:
        run_pipeline_from_deals_table(truncated, version_id="SHOULD-NOT-BE-WRITTEN", out_dir=SCRATCH / "corrupted_out")
        raise AssertionError("expected a clean ValueError on a truncated report, got none")
    except ValueError as e:
        assert "Deals" in str(e) or "</table>" in str(e) or "reconciliation" in str(e).lower(), str(e)
        print(f"test_corrupted_report: PASS (halted cleanly: {e})")


def test_encoding_failure() -> None:
    SCRATCH.mkdir(parents=True, exist_ok=True)
    bad = SCRATCH / "bad_encoding.htm"
    # Neither a UTF-16 BOM nor valid UTF-8 -- an invalid continuation byte sequence.
    bad.write_bytes(b"<html>\xff\x22\xfa\x00\x01not valid utf-8 or utf-16</html>")

    try:
        _read_html_text(bad)
        raise AssertionError("expected a clean ValueError on undecodable bytes, got none")
    except ValueError as e:
        assert "encoding" in str(e).lower(), str(e)
        print(f"test_encoding_failure: PASS (halted cleanly: {e})")


def test_malformed_deals_table() -> None:
    # UTF-16LE-encoded, valid HTML, but the Deals table is missing the
    # 'Direction' column (12 cells instead of 13) -- must not silently
    # misalign columns and produce wrong profit/price data.
    html = """<html><body><table>
<tr align="center"><th colspan="12"><b>Deals</b></th></tr>
<tr><td>Time</td><td>Deal</td><td>Symbol</td><td>Type</td><td>Volume</td><td>Price</td><td>Order</td><td>Commission</td><td>Swap</td><td>Profit</td><td>Balance</td><td>Comment</td></tr>
<tr><td>2025.01.01 00:00:00</td><td>2</td><td>XAUUSD</td><td>buy</td><td>0.1</td><td>2000.00</td><td>2</td><td>0.00</td><td>0.00</td><td>0.00</td><td>10000.00</td><td>AT24_G01</td></tr>
</table></body></html>"""
    encoded = html.encode("utf-16")  # includes BOM automatically

    malformed = SCRATCH / "malformed_deals.htm"
    SCRATCH.mkdir(parents=True, exist_ok=True)
    malformed.write_bytes(encoded)

    try:
        text = _read_html_text(malformed)
        deal_rows, meta = parse_mt5_deals_table(text)
        raise AssertionError(f"expected a clean ValueError for a 12-column Deals table, got {len(deal_rows)} rows instead")
    except ValueError as e:
        print(f"test_malformed_deals_table: PASS (halted cleanly: {e})")


if __name__ == "__main__":
    test_genuine_v01_report()
    test_immutability_on_real_report()
    test_corrupted_report()
    test_encoding_failure()
    test_malformed_deals_table()

    if SCRATCH.exists():
        # Keep the genuine Evidence output (copy it out first), discard scratch junk.
        genuine_out = SCRATCH / "genuine"
        if genuine_out.exists():
            dest = HERE / "real_evidence_output"
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(genuine_out, dest)
            print(f"\nGenuine Evidence output preserved at: {dest}")
        shutil.rmtree(SCRATCH)

    print("\nAll M2.1 real-data tests complete.")
