"""The Claude desk's guardrails, tested with a scripted fake LLM and synthetic data (no network, no API calls)."""
import json
import tempfile
import unittest

import numpy as np
import pandas as pd

from binance_agents.config import Config
from binance_agents.desk.book import PaperBook
from binance_agents.desk.cycle import Desk
from binance_agents.desk.llm import FakeLLM

SYMS = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]


def frames(spike: str | None = "ETHUSDT", n=900, seed=3):
    out = {}
    for j, s in enumerate(SYMS):
        rng = np.random.default_rng(seed + j)
        close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.003, n)))           # gentle uptrend
        open_ = np.r_[close[0], close[:-1]]
        high = np.maximum(open_, close) * 1.001
        low = np.minimum(open_, close) * 0.999
        vol = np.full(n, 40_000.0)
        if s == spike:                                                            # last candle: big volume, closes above the 48-candle high
            hh = high[-49:-1].max()
            open_[-1], close[-1], high[-1], low[-1], vol[-1] = hh * 0.995, hh * 1.02, hh * 1.025, hh * 0.994, 40_000.0 * 6
        out[s] = pd.DataFrame({"open_time": pd.date_range("2025-01-01", periods=n, freq="h", tz="UTC"), "open": open_, "high": high, "low": low, "close": close,
                               "volume": vol, "quote_volume": vol * close, "trades": 100})
    return out


class StubData:
    def __init__(self, fr):
        self.fr = fr

    def klines(self, s, interval="1h", start="2021-01-01", use_cache=True):
        return self.fr[s].copy()

    def book(self, s, limit=100):
        p = float(self.fr[s]["close"].iloc[-1])
        return {"bids": [[str(p * 0.9995), "5000"], [str(p * 0.998), "9000"]], "asks": [[str(p * 1.0005), "5000"], [str(p * 1.002), "9000"]]}


def good_script(**over):
    s = {
        "scout": {"picks": [{"symbol": "ETHUSDT", "why": "volume breakout", "invalidation": "close below the 48h high"}]},
        "risk_checker": {"checks": [{"symbol": "ETHUSDT", "pass": True, "concern": ""}]},
        "sentiment": {"views": [{"symbol": "ETHUSDT", "bias": "bullish", "strength": 0.6, "why": "bid heavy"}], "regime": "risk_on"},
        "strategy": {"decisions": [{"symbol": "ETHUSDT", "action": "BUY", "conviction": 0.7, "stop_atr": 2.0, "thesis": "breakout on volume", "invalidation": "x"}], "positions": []},
        "execution": {"orders": [{"symbol": "ETHUSDT", "type": "MARKET", "limit_offset_bps": 0, "why": "fast"}]},
        "risk_manager": {"approvals": [{"symbol": "ETHUSDT", "approve": True, "size_multiplier": 1.0, "why": "ok"}], "portfolio_note": "fine"},
        "reviewer": {"lesson": "one sample", "cause": "good_setup", "confidence_was_justified": True},
    }
    s.update(over)
    return s


def make_desk(script, fr=None):
    d = tempfile.mkdtemp()
    llm = FakeLLM(script)
    desk = Desk(Config(), llm, state_dir=d, data=StubData(fr or frames()), universe=SYMS, live_books=True, random_prob=0.0)
    return desk, llm


class DeskGuards(unittest.TestCase):
    def test_happy_path_buys_with_a_code_set_stop(self):
        desk, llm = make_desk(good_script())
        res = desk.run_cycle()
        self.assertEqual(res["status"], "ok")
        book = desk.arms["desk"]
        self.assertIn("ETHUSDT", book.pos)
        p = book.pos["ETHUSDT"]
        self.assertLess(p.stop, p.entry)
        self.assertAlmostEqual((p.entry - p.stop) / p.atr, 2.0, places=3)
        self.assertEqual([a for a, _ in llm.calls][:3], ["scout", "risk_checker", "sentiment"])

    def test_absurd_numbers_are_clipped(self):
        script = good_script(strategy={"decisions": [{"symbol": "ETHUSDT", "action": "BUY", "conviction": 9, "stop_atr": 10, "thesis": "x", "invalidation": ""}], "positions": []},
                             risk_manager={"approvals": [{"symbol": "ETHUSDT", "approve": True, "size_multiplier": 50, "why": "yolo"}]})
        desk, _ = make_desk(script)
        desk.run_cycle()
        p = desk.arms["desk"].pos["ETHUSDT"]
        self.assertLessEqual((p.entry - p.stop) / p.atr, 3.0 + 1e-6)                 # stop distance clipped to 3 ATR
        self.assertLessEqual(p.qty * p.entry, 10_000 * 0.2 + 1e-6)                    # position cap (20% of the equity before the trade) cannot be exceeded
        self.assertLessEqual(p.conviction, 1.0)

    def test_risk_manager_veto_blocks_the_trade(self):
        desk, _ = make_desk(good_script(risk_manager={"approvals": [{"symbol": "ETHUSDT", "approve": False, "size_multiplier": 1.0, "why": "no"}]}))
        desk.run_cycle()
        self.assertEqual(desk.arms["desk"].pos, {})

    def test_silent_or_garbage_agents_mean_no_trade(self):
        for silent in ("strategy", "risk_checker", "risk_manager"):
            desk, _ = make_desk(good_script(**{silent: None}))
            desk.run_cycle()
            self.assertEqual(desk.arms["desk"].pos, {}, f"{silent} silent should mean no trade")
        desk, _ = make_desk(good_script(strategy={"decisions": "lol", "positions": 5}))
        desk.run_cycle()
        self.assertEqual(desk.arms["desk"].pos, {})

    def test_agent_cannot_name_a_symbol_it_was_not_given(self):
        desk, _ = make_desk(good_script(strategy={"decisions": [{"symbol": "DOGEUSDT", "action": "BUY", "conviction": 1, "stop_atr": 2}], "positions": []}))
        desk.run_cycle()
        self.assertNotIn("DOGEUSDT", desk.arms["desk"].pos)

    def test_halted_desk_makes_no_llm_calls(self):
        desk, llm = make_desk(good_script())
        desk.arms["desk"].rs.halted = True
        desk.run_cycle()
        self.assertEqual(llm.calls, [])
        self.assertEqual(desk.arms["desk"].pos, {})

    def test_budget_exhausted_means_no_calls(self):
        desk, llm = make_desk(good_script())
        llm.over_budget = lambda: True
        desk.run_cycle()
        self.assertEqual(llm.calls, [])

    def test_quiet_market_costs_nothing(self):
        desk, llm = make_desk(good_script(), fr=frames(spike=None))
        desk.run_cycle()
        self.assertEqual(llm.calls, [])

    def test_same_candle_is_not_processed_twice(self):
        desk, llm = make_desk(good_script())
        desk.run_cycle()
        n = len(llm.calls)
        self.assertEqual(desk.run_cycle()["status"], "no new closed candle")
        self.assertEqual(len(llm.calls), n)

    def test_state_survives_a_restart(self):
        desk, _ = make_desk(good_script())
        desk.run_cycle()
        again = Desk(Config(), FakeLLM(good_script()), state_dir=desk.dir, data=StubData(frames()), universe=SYMS, random_prob=0.0)
        self.assertIn("ETHUSDT", again.arms["desk"].pos)
        self.assertEqual(again.arms["desk"].cash, desk.arms["desk"].cash)


class BookRules(unittest.TestCase):
    def setUp(self):
        self.b = PaperBook("desk", Config())

    def test_tighten_only_moves_up(self):
        p = self.b.buy_market("ETHUSDT", 100.0, 2.0, 2.0, "t", {"ETHUSDT": 100.0})
        self.assertIsNotNone(p)
        before = p.stop
        self.assertFalse(self.b.tighten("ETHUSDT", 100.0, 3.0))                       # would lower the stop -> refused
        self.assertEqual(p.stop, before)
        self.assertTrue(self.b.tighten("ETHUSDT", 100.0, 1.0))
        self.assertGreater(p.stop, before)

    def test_stop_gap_fills_at_the_open_not_the_stop(self):
        p = self.b.buy_market("ETHUSDT", 100.0, 2.0, 2.0, "t", {"ETHUSDT": 100.0})
        closed = self.b.process_candle({"ETHUSDT": {"open": 90.0, "high": 91.0, "low": 88.0, "close": 89.0}}, "t2")
        self.assertEqual(len(closed), 1)
        self.assertLess(closed[0]["exit"], p.stop)

    def test_limit_order_fills_only_if_price_dips(self):
        self.assertTrue(self.b.place_limit("ETHUSDT", 99.0, 2.0, 2.0, "t", {"ETHUSDT": 100.0}))
        self.b.process_candle({"ETHUSDT": {"open": 100.0, "high": 101.0, "low": 99.5, "close": 100.5}}, "t2")
        self.assertEqual(self.b.pos, {})
        self.b.place_limit("ETHUSDT", 99.0, 2.0, 2.0, "t", {"ETHUSDT": 100.0})
        self.b.process_candle({"ETHUSDT": {"open": 100.0, "high": 101.0, "low": 98.5, "close": 100.0}}, "t3")
        self.assertIn("ETHUSDT", self.b.pos)
        self.assertEqual(self.b.pending, [])

    def test_roundtrip_serialisation(self):
        self.b.buy_market("ETHUSDT", 100.0, 2.0, 2.0, "t", {"ETHUSDT": 100.0})
        again = PaperBook.from_dict(json.loads(json.dumps(self.b.to_dict())), Config())
        self.assertEqual(again.pos.keys(), self.b.pos.keys())
        self.assertAlmostEqual(again.cash, self.b.cash)


if __name__ == "__main__":
    unittest.main()
