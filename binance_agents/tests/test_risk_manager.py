import unittest

from binance_agents.agents import RiskManager
from binance_agents.config import Costs, Risk


class RiskRules(unittest.TestCase):
    def setUp(self):
        self.rm = RiskManager(Risk(), Costs())

    def test_loss_at_the_stop_is_about_one_percent(self):
        s = self.rm.size(equity=10_000, cash=10_000, entry=100.0, stop=95.0)
        self.assertGreater(s.qty, 0)
        loss = s.qty * (100.0 - 95.0) + s.qty * 100.0 * 0.001 + s.qty * 95.0 * 0.001 + s.qty * 95.0 * 0.0005
        self.assertLessEqual(loss, 10_000 * 0.01 * 1.0001)

    def test_position_cap(self):
        s = self.rm.size(equity=10_000, cash=10_000, entry=100.0, stop=99.9)
        self.assertLessEqual(s.notional, 2_000.0 + 1e-6)

    def test_cannot_spend_more_than_cash(self):
        s = self.rm.size(equity=10_000, cash=500, entry=100.0, stop=95.0)
        self.assertLessEqual(s.notional * 1.001, 500.0 + 1e-6)

    def test_bad_stop_refused(self):
        self.assertEqual(self.rm.size(10_000, 10_000, 100.0, 101.0).qty, 0)

    def test_daily_loss_limit_blocks_entries(self):
        st = self.rm.new_state(10_000)
        self.rm.on_bar(st, "2025-01-01", 10_000)
        self.rm.on_bar(st, "2025-01-01", 9_400)
        ok, why = self.rm.can_enter(st, 9_400, 0, "BTCUSDT", 5)
        self.assertFalse(ok)
        self.assertIn("daily", why)
        self.rm.on_bar(st, "2025-01-02", 9_400)
        self.assertTrue(self.rm.can_enter(st, 9_400, 0, "BTCUSDT", 30)[0])

    def test_drawdown_halt_is_sticky(self):
        st = self.rm.new_state(10_000)
        self.rm.on_bar(st, "d1", 10_000)
        self.rm.on_bar(st, "d2", 7_900)
        self.assertTrue(st.halted)
        self.rm.on_bar(st, "d3", 10_500)
        self.assertFalse(self.rm.can_enter(st, 10_500, 0, "ETHUSDT", 100)[0])

    def test_max_open_and_cooldown(self):
        st = self.rm.new_state(10_000)
        self.rm.on_bar(st, "d1", 10_000)
        self.assertFalse(self.rm.can_enter(st, 10_000, 5, "BTCUSDT", 1)[0])
        st.last_exit_bar["BTCUSDT"] = 10
        self.assertFalse(self.rm.can_enter(st, 10_000, 0, "BTCUSDT", 12)[0])
        self.assertTrue(self.rm.can_enter(st, 10_000, 0, "BTCUSDT", 16)[0])


if __name__ == "__main__":
    unittest.main()
