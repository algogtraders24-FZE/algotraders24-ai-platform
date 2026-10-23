"""The direct desk (Claude agents decide, orders go to a Binance account) tested against an in-memory exchange: no network, no key."""
import tempfile
import unittest
from pathlib import Path

from binance_agents.config import Config
from binance_agents.desk.cycle import Desk
from binance_agents.desk.dashboard import build_payload, merge_live
from binance_agents.desk.direct import DirectDesk
from binance_agents.desk.llm import FakeLLM
from binance_agents.tests.fake_exchange import FakeExchange
from binance_agents.tests.test_desk import SYMS, StubData, frames, good_script


def make(script, ex=None, fr=None):
    fr = fr or frames()
    ex = ex or FakeExchange({s: float(fr[s]["close"].iloc[-1]) for s in SYMS})
    llm = FakeLLM(script)
    desk = DirectDesk(Config(), llm, ex, state_dir=tempfile.mkdtemp(), data=StubData(fr), universe=SYMS)
    return desk, llm, ex


def again(desk):
    """Pretend the next candle arrived (re-run the cycle on the same data)."""
    desk.ds["last_bar"] = None
    desk.state["last_bar"] = None
    return desk.run_cycle()


class DirectBuy(unittest.TestCase):
    def test_buy_places_the_order_and_the_exchange_stop(self):
        desk, llm, ex = make(good_script())
        res = desk.run_cycle()
        self.assertEqual(res["status"], "ok")
        p = desk.ds["positions"]["ETHUSDT"]
        self.assertLess(p["stop"], p["entry"])
        self.assertEqual(len(ex.orders), 1)
        self.assertEqual(ex.orders[0]["type"], "STOP_LOSS_LIMIT")
        self.assertEqual(str(ex.orders[0]["orderId"]), p["stop_order_id"])
        self.assertAlmostEqual((p["entry"] - p["stop"]) / p["atr"], 2.0, places=3)

    def test_house_rule_is_not_in_the_direct_prompts(self):
        desk, llm, ex = make(good_script())
        from binance_agents.desk.prompts import DIRECT_SYSTEM
        self.assertNotIn("house rule", DIRECT_SYSTEM["strategy"].lower().replace("there is no house rule", ""))
        self.assertIn("DEMO", DIRECT_SYSTEM["scout"])

    def test_absurd_agent_numbers_are_clipped(self):
        script = good_script(strategy={"decisions": [{"symbol": "ETHUSDT", "action": "BUY", "conviction": 9, "stop_atr": 10, "thesis": "x", "invalidation": ""}], "positions": []},
                             risk_manager={"approvals": [{"symbol": "ETHUSDT", "approve": True, "size_multiplier": 50, "why": "yolo"}]})
        desk, _, ex = make(script)
        desk.run_cycle()
        p = desk.ds["positions"]["ETHUSDT"]
        self.assertLessEqual((p["entry"] - p["stop"]) / p["atr"], 3.0 + 1e-6)
        self.assertLessEqual(p["qty"] * p["entry"], 10_000 * 0.2 * 1.01)

    def test_no_order_when_an_agent_is_silent_or_vetoes(self):
        for silent in ("strategy", "risk_checker", "risk_manager", "execution"):
            desk, _, ex = make(good_script(**{silent: None}))
            desk.run_cycle()
            self.assertEqual(desk.ds["positions"], {}, f"{silent} silent should mean no order")
            self.assertEqual(ex.trades, [])
        desk, _, ex = make(good_script(execution={"orders": [{"symbol": "ETHUSDT", "type": "WAIT", "why": "stretched"}]}))
        desk.run_cycle()
        self.assertEqual(ex.trades, [])

    def test_per_order_cap_blocks_the_buy(self):
        fr = frames()
        ex = FakeExchange({s: float(fr[s]["close"].iloc[-1]) for s in SYMS}, cap=50.0)
        desk, _, ex = make(good_script(), ex=ex, fr=fr)
        desk.run_cycle()
        self.assertEqual(desk.ds["positions"], {})
        self.assertEqual(ex.trades, [])

    def test_a_position_without_a_stop_is_not_allowed(self):
        fr = frames()
        ex = FakeExchange({s: float(fr[s]["close"].iloc[-1]) for s in SYMS})
        ex.fail_stop = True
        desk, _, ex = make(good_script(), ex=ex, fr=fr)
        desk.run_cycle()
        self.assertEqual(desk.ds["positions"], {})
        self.assertEqual(ex.free.get("ETH", 0.0), 0.0)                              # bought and sold straight back

    def test_halted_desk_trades_nothing_and_calls_no_agent(self):
        desk, llm, ex = make(good_script())
        desk.rs = desk.rm.new_state(10_000)
        desk.rs.halted = True
        desk.run_cycle()
        self.assertEqual(llm.calls, [])
        self.assertEqual(ex.trades, [])

    def test_quiet_market_costs_nothing(self):
        desk, llm, ex = make(good_script(), fr=frames(spike=None))
        desk.run_cycle()
        self.assertEqual(llm.calls, [])


class DirectManage(unittest.TestCase):
    def test_exchange_stop_hit_is_booked_and_reviewed(self):
        desk, llm, ex = make(good_script())
        desk.run_cycle()
        ex.trigger_stop("ETHUSDT")
        again(desk)
        self.assertEqual(desk.ds["positions"], {})
        t = desk.ds["trades"][-1]
        self.assertEqual(t["symbol"], "ETHUSDT")
        self.assertLess(t["pnl"], 0)
        self.assertIn("reviewer", [a for a, _ in llm.calls])

    def test_cooldown_stops_an_immediate_rebuy(self):
        desk, llm, ex = make(good_script())
        desk.run_cycle()
        ex.trigger_stop("ETHUSDT")
        again(desk)
        self.assertEqual(desk.ds["positions"], {})                                   # same BUY script, but the cooldown blocks it

    def test_missing_stop_is_placed_again(self):
        desk, _, ex = make(good_script())
        desk.run_cycle()
        oid = ex.orders[0]["orderId"]
        ex.cancel("ETHUSDT", str(oid))                                               # someone cancelled it on the exchange
        again(desk)
        self.assertEqual(len(ex.orders), 1)
        self.assertEqual(str(ex.orders[0]["orderId"]), desk.ds["positions"]["ETHUSDT"]["stop_order_id"])

    def test_agent_exit_sells_and_cancels_the_stop(self):
        calls = {"n": 0}

        def strat(_user):
            calls["n"] += 1
            if calls["n"] == 1:
                return good_script()["strategy"]
            return {"decisions": [], "positions": [{"symbol": "ETHUSDT", "action": "EXIT", "why": "thesis broken"}]}

        desk, llm, ex = make(good_script(strategy=strat))
        desk.run_cycle()
        again(desk)
        self.assertEqual(desk.ds["positions"], {})
        self.assertEqual(ex.orders, [])
        self.assertEqual(ex.free.get("ETH", 0.0), 0.0)
        self.assertEqual(desk.ds["trades"][-1]["reason"], "agent_exit")

    def test_tighten_moves_the_stop_up_only(self):
        calls = {"n": 0}

        def strat(_user):
            calls["n"] += 1
            if calls["n"] == 1:
                return good_script()["strategy"]
            return {"decisions": [], "positions": [{"symbol": "ETHUSDT", "action": "TIGHTEN", "stop_atr": 1.0, "why": "lock in"}]}

        desk, _, ex = make(good_script(strategy=strat))
        desk.run_cycle()
        before = desk.ds["positions"]["ETHUSDT"]["stop"]
        again(desk)
        after = desk.ds["positions"]["ETHUSDT"]["stop"]
        self.assertGreater(after, before)
        self.assertEqual(len(ex.orders), 1)
        self.assertAlmostEqual(float(ex.orders[0]["stopPrice"]), after)
        self.assertFalse(desk._tighten("ETHUSDT", before))                          # lowering is refused

    def test_foreign_holdings_count_as_equity_but_are_not_managed(self):
        desk, _, ex = make(good_script(), fr=frames(spike=None))
        ex.free["SOL"] = 5.0
        desk.run_cycle()
        self.assertEqual(desk.ds["positions"], {})
        snap = desk.ds["account"]
        self.assertTrue(any(p["symbol"] == "SOLUSDT" and not p["managed"] for p in snap["positions"]))
        self.assertGreater(snap["account_equity"], snap["equity"])                  # shown, but never sized against
        self.assertAlmostEqual(snap["equity"], 10_000, delta=1)

    def test_state_survives_a_restart(self):
        desk, _, ex = make(good_script())
        desk.run_cycle()
        d2 = DirectDesk(Config(), FakeLLM(good_script()), ex, state_dir=desk.dir, data=StubData(frames()), universe=SYMS)
        self.assertIn("ETHUSDT", d2.ds["positions"])
        self.assertEqual(d2.ds["start_equity"], desk.ds["start_equity"])

    def test_live_account_reports_equity_and_open_orders(self):
        desk, _, ex = make(good_script())
        desk.run_cycle()
        lv = desk.live_account()
        self.assertEqual(lv["open"], 1)
        self.assertEqual(len(lv["account"]["open_orders"]), 1)
        self.assertGreater(lv["equity"], 9_900)


class PayloadMerge(unittest.TestCase):
    def test_demo_arm_account_and_activity_reach_the_payload(self):
        root = Path(tempfile.mkdtemp())
        fr = frames()
        Desk(Config(), FakeLLM({}), state_dir=root, data=StubData(fr), universe=SYMS, random_prob=0.0).run_cycle()
        ex = FakeExchange({s: float(fr[s]["close"].iloc[-1]) for s in SYMS})
        DirectDesk(Config(), FakeLLM(good_script()), ex, state_dir=root / "direct", data=StubData(fr), universe=SYMS).run_cycle()
        p = build_payload(root)
        self.assertIn("demo", p["arms"])
        self.assertEqual(p["arms"]["demo"]["stats"]["open"], 1)
        self.assertEqual(len(p["account"]["open_orders"]), 1)
        self.assertTrue(any(a.get("arm") == "demo" for a in p["activity"]))
        self.assertEqual(p["demo_trades"], [])

    def test_no_direct_state_means_the_payload_is_unchanged(self):
        root = Path(tempfile.mkdtemp())
        Desk(Config(), FakeLLM({}), state_dir=root, data=StubData(frames()), universe=SYMS, random_prob=0.0).run_cycle()
        p = build_payload(root)
        self.assertNotIn("demo", p["arms"])
        self.assertNotIn("account", p)


if __name__ == "__main__":
    unittest.main()
