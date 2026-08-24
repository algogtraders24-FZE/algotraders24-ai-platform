"""Build (or rebuild) the strategy library for ONE symbol/timeframe. Run
separately per symbol/timeframe so each invocation stays comfortably under
a few minutes. Usage: python3 build_one_library.py SYMBOL TIMEFRAME SPREAD CONTRACT_SIZE"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "quant_engine"))

from spec_engine.library_generator import build_library, iter_grid_specs
from spec_engine.runner import run_spec_backtest
from engine import RiskConfig
from data_import import load_candles


def main():
    symbol, timeframe = sys.argv[1], sys.argv[2]
    spread = float(sys.argv[3])
    contract_size = float(sys.argv[4])

    df = load_candles(symbol, timeframe)
    risk = RiskConfig(risk_pct=1.0, spread_price=spread, contract_size=contract_size, start_balance=10000)

    n_grid = sum(1 for _ in iter_grid_specs(symbol, timeframe))
    print(f"{symbol} {timeframe}: {len(df)} bars, grid size {n_grid}")

    t0 = time.time()
    n = build_library(df, run_spec_backtest, risk, symbol=symbol, timeframe=timeframe, progress_every=100)
    print(f"{symbol} {timeframe}: built {n} strategies (incl. walk-forward) in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
