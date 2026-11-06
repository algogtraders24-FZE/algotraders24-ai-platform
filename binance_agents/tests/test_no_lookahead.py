"""The features and the Strategy decision on candle i must not change when candles after i change or disappear."""
import unittest

import numpy as np
import pandas as pd

from binance_agents.agents import Strategy
from binance_agents.config import Params
from binance_agents.features import compute_features


def synth(n=1200, seed=1):
    rng = np.random.default_rng(seed)
    close = 100 * np.exp(np.cumsum(rng.normal(0, 0.004, n)))
    open_ = np.r_[close[0], close[:-1]]
    high = np.maximum(open_, close) * (1 + rng.uniform(0, 0.003, n))
    low = np.minimum(open_, close) * (1 - rng.uniform(0, 0.003, n))
    vol = rng.lognormal(3, 0.6, n)
    return pd.DataFrame({"open_time": pd.date_range("2024-01-01", periods=n, freq="h", tz="UTC"), "open": open_, "high": high, "low": low, "close": close,
                         "volume": vol, "quote_volume": vol * close, "trades": 100})


class NoLookahead(unittest.TestCase):
    def test_features_use_only_the_past(self):
        p, df = Params(), synth()
        full = compute_features(df, p)
        for cut in (400, 700, 1000):
            part = compute_features(df.iloc[:cut].copy(), p)
            a, b = full.iloc[cut - 1], part.iloc[-1]
            for c in ["atr", "prior_high", "rel_volume", "ema_trend", "quote_vol_24h"]:
                self.assertAlmostEqual(a[c], b[c], places=9, msg=f"{c} changed with future data at {cut}")
            for c in ["breakout", "bullish", "trend_ok"]:
                self.assertEqual(bool(a[c]), bool(b[c]))

    def test_changing_the_future_does_not_change_the_signal(self):
        p, df = Params(min_rel_volume=1.2), synth()
        strat = Strategy(p)
        base = compute_features(df, p)
        df2 = df.copy()
        df2.loc[800:, ["open", "high", "low", "close"]] *= 3.0     # wreck everything after candle 799
        alt = compute_features(df2, p)
        for i in range(300, 800):
            r1, r2 = base.iloc[i].to_dict(), alt.iloc[i].to_dict()
            self.assertEqual(strat.evaluate("X", r1) is None, strat.evaluate("X", r2) is None)


if __name__ == "__main__":
    unittest.main()
