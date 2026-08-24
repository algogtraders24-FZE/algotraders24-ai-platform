"""
M4.2 -- tags a real Evidence package's trades with real marketRegime
values (regime_classifier.py, real ADX/ATR classification against real
quant_engine/market.db candles), writes a NEW evidence file (original
untouched -- Evidence is immutable per M2's own principle), then re-runs
M4's real validate_regime_coverage() against it to get a genuine result.
No new computation invented here beyond the classifier itself -- the
regime-coverage check logic is M4's own, completely unmodified.

Usage: python tag_trades_with_regime.py <evidence-package.json> <output.json>
"""
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "m4-validation-engine"))
from regime_classifier import load_candles, classify_regimes, regime_at_or_before  # noqa: E402
from validation_engine import validate_regime_coverage  # noqa: E402

MARKET_DB = Path(__file__).parent.parent.parent.parent / "quant_engine" / "market.db"
SYMBOL = "XAUUSD_EXNESS"
TIMEFRAME = "15m"


def parse_trade_timestamp(s: str) -> datetime:
    # MT5 report format: "2025.01.02 04:21:28"
    return datetime.strptime(s, "%Y.%m.%d %H:%M:%S")


def main() -> None:
    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])

    package = json.loads(input_path.read_text(encoding="utf-8"))
    trades = package["trades"]

    candles = load_candles(MARKET_DB, SYMBOL, TIMEFRAME)
    regimes = classify_regimes(candles)
    candle_timestamps = [c.ts for c in candles]

    tagged = 0
    untaggable = 0
    for t in trades:
        try:
            ts = parse_trade_timestamp(t["timestamp"])
        except (KeyError, ValueError):
            untaggable += 1
            continue
        regime = regime_at_or_before(regimes, candle_timestamps, ts)
        if regime:
            t["marketRegime"] = regime
            tagged += 1
        else:
            untaggable += 1

    print(f"Tagged {tagged}/{len(trades)} trades with a real regime ({untaggable} outside candle coverage or warm-up).")

    output_path.write_text(json.dumps(package, indent=2), encoding="utf-8")
    print(f"Regime-tagged evidence package written: {output_path}")

    evidence = package["evidence"]
    evidence_id = evidence["_contentHash"]
    ds_hash = evidence_id  # same convention run_validation_suite uses when trades == evidence's own trades
    record = validate_regime_coverage(evidence, trades, evidence_id, ds_hash)
    print(f"\nREGIME_COVERAGE re-run: status={record.status}")
    print(f"  regimesRepresented: {record.metrics.get('regimesRepresented')}")
    print(f"  tradeCountByRegime: {record.metrics.get('tradeCountByRegime')}")
    for f in record.findings:
        print(f"  finding: {f}")

    result_path = output_path.with_suffix(".regime_coverage_result.json")
    result_path.write_text(json.dumps(record.to_dict(), indent=2, default=str), encoding="utf-8")
    print(f"\nResult written: {result_path}")


if __name__ == "__main__":
    main()
