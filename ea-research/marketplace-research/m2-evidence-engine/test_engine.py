"""
Self-test for evidence_engine.py against SYNTHETIC fixtures only
(test_fixtures/ -- see that folder's README). Proves the pipeline's code
is correct; produces no claim about real G01 performance.

Run: python test_engine.py
"""

import shutil
import sys
from pathlib import Path

from evidence_engine import run_pipeline

HERE = Path(__file__).parent
FIXTURES = HERE / "test_fixtures"
OUT_DIR = HERE / "test_fixtures" / "_test_output"


def test_happy_path() -> None:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)

    out_path = run_pipeline(
        report_path=FIXTURES / "sample_report.htm",
        csv_path=FIXTURES / "sample_tradelog.csv",
        version_id="TEST-VERSION-SYNTHETIC",
        out_dir=OUT_DIR,
    )
    assert out_path.exists(), "Evidence file was not written"

    import json
    payload = json.loads(out_path.read_text(encoding="utf-8"))
    ev = payload["evidence"]
    metrics = ev["metricsSummary"]

    assert ev["evidenceClass"] == "HISTORICAL"
    assert ev["source"] == "BACKTEST"
    assert ev["generatedBy"] == "AT24-M2-Evidence-Engine-v0.2"
    assert metrics["tradeCount"] == 6
    # Fixture: profits (risk=100) = 200,-100,120,-100,180,-100 -> net 200
    assert abs(metrics["netProfit"] - 200.0) < 0.01, metrics["netProfit"]
    assert metrics["winRate"] == 0.5
    assert len(payload["trades"]) == 6
    assert "_contentHash" in ev
    print("test_happy_path: PASS")

    # Immutability: re-running against identical input must refuse to overwrite.
    try:
        run_pipeline(
            report_path=FIXTURES / "sample_report.htm",
            csv_path=FIXTURES / "sample_tradelog.csv",
            version_id="TEST-VERSION-SYNTHETIC",
            out_dir=OUT_DIR,
        )
        raise AssertionError("expected FileExistsError on duplicate run, got none")
    except FileExistsError:
        print("test_immutability_refuses_overwrite: PASS")


def test_integrity_check_halts_on_bad_data() -> None:
    try:
        run_pipeline(
            report_path=FIXTURES / "sample_report.htm",
            csv_path=FIXTURES / "bad_tradelog.csv",
            version_id="TEST-VERSION-BAD",
            out_dir=OUT_DIR,
        )
        raise AssertionError("expected ValueError from data integrity check, got none")
    except ValueError as e:
        assert "Data integrity check failed" in str(e)
        assert "duplicate trade row" in str(e)
        assert "negative entryPrice" in str(e)
        print("test_integrity_check_halts_on_bad_data: PASS")


if __name__ == "__main__":
    test_happy_path()
    test_integrity_check_halts_on_bad_data()
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    print("\nAll M2 evidence engine self-tests PASSED (synthetic fixtures only).")
