"""Live tick, merge over the hourly snapshot, and the optional website push (no network: stubs and mocks)."""
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock

import requests

from binance_agents.config import Config
from binance_agents.desk.cycle import Desk
from binance_agents.desk.dashboard import merge_live
from binance_agents.desk.live import build_live
from binance_agents.desk.llm import FakeLLM
from binance_agents.desk.push import ArenaPush
from binance_agents.tests.test_desk import SYMS, StubData, frames


class LiveStub(StubData):
    def _get(self, path, params=None):
        if path.endswith("/ticker/24hr"):
            return [{"symbol": s, "lastPrice": "123.5", "priceChangePercent": "-1.25"} for s in SYMS]
        if path.endswith("/ticker"):
            return [{"symbol": s, "quoteVolume": "9000000"} for s in SYMS]
        raise RuntimeError("unexpected " + path)


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def payload():
    return {"ready": True, "arms": {"desk": {"stats": {"equity": 10000, "return_pct": 0, "day_pnl": 0, "open": 0}, "equity": []}},
            "positions": [{"symbol": "ETHUSDT", "entry": 100.0, "price": 100.0, "pnl_pct": 0.0}],
            "radar": [{"symbol": "ETHUSDT", "rel_volume": 1.0, "chg24": 0.5}], "ticker": []}


def live(ts):
    return {"ts": iso(ts), "prices": {"BTCUSDT": 81000.0, "ETHUSDT": 102.0}, "chg24": {"ETHUSDT": 2.0}, "rel_live": {"ETHUSDT": 3.1},
            "arms": {"desk": {"equity": 10100.0, "return_pct": 1.0, "day_pnl": 100.0, "open": 1}}, "positions": [{"symbol": "ETHUSDT", "price": 102.0, "pnl_pct": 2.0}]}


class LiveTick(unittest.TestCase):
    def test_build_live_marks_the_arms(self):
        desk = Desk(Config(), FakeLLM({}), state_dir=tempfile.mkdtemp(), data=LiveStub(frames()), universe=SYMS, random_prob=0.0)
        desk.state["radar"] = [{"symbol": "ETHUSDT", "avg_qv48": 3_000_000.0}]
        lv = build_live(desk)
        self.assertEqual(set(lv["arms"]), {"desk", "rules", "random"})
        self.assertEqual(lv["arms"]["desk"]["equity"], 10000.0)
        self.assertEqual(lv["rel_live"]["ETHUSDT"], 3.0)
        self.assertEqual(lv["prices"]["BTCUSDT"], 123.5)

    def test_build_live_survives_a_network_failure(self):
        class Down(LiveStub):
            def _get(self, path, params=None):
                raise RuntimeError("offline")
        desk = Desk(Config(), FakeLLM({}), state_dir=tempfile.mkdtemp(), data=Down(frames()), universe=SYMS, random_prob=0.0)
        self.assertIsNone(build_live(desk))


class Merge(unittest.TestCase):
    def test_fresh_live_overlays_the_snapshot(self):
        p = merge_live(payload(), live(datetime.now(timezone.utc) - timedelta(seconds=5)))
        self.assertEqual(p["arms"]["desk"]["stats"]["equity"], 10100.0)
        self.assertEqual(p["positions"][0]["pnl_pct"], 2.0)
        self.assertEqual(p["radar"][0]["rel_volume"], 3.1)
        self.assertEqual(p["ticker"][0]["symbol"], "BTCUSDT")
        self.assertLess(p["live_age"], 30)

    def test_stale_live_is_ignored_but_the_age_is_reported(self):
        p = merge_live(payload(), live(datetime.now(timezone.utc) - timedelta(minutes=10)))
        self.assertEqual(p["arms"]["desk"]["stats"]["equity"], 10000)
        self.assertGreater(p["live_age"], 500)


class Push(unittest.TestCase):
    def test_no_token_means_no_push(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(ArenaPush.from_env())

    def test_push_sends_the_bearer_token_and_kind(self):
        sess = mock.Mock()
        sess.post.return_value.status_code = 200
        with mock.patch.dict(os.environ, {"AT24_ARENA_TOKEN": "tok", "AT24_ARENA_URL": "https://example.test/api/arena/ingest"}, clear=True):
            p = ArenaPush.from_env()
        p.s = sess
        self.assertTrue(p.live({"ts": "x", "arms": {}}))
        self.assertTrue(p.full({"ready": True, "arms": {}}))
        calls = sess.post.call_args_list
        self.assertEqual(calls[0].kwargs["headers"]["Authorization"], "Bearer tok")
        self.assertEqual(json.loads(calls[0].kwargs["data"])["kind"], "live")
        self.assertEqual(json.loads(calls[1].kwargs["data"])["kind"], "full")

    def test_push_failure_never_raises(self):
        sess = mock.Mock()
        sess.post.side_effect = requests.ConnectionError("down")
        p = ArenaPush("tok", session=sess)
        self.assertFalse(p.live({"ts": "x", "arms": {}}))
        self.assertTrue(p.last_error.startswith("ConnectionError"))
        sess.post.side_effect = None
        sess.post.return_value.status_code = 401
        sess.post.return_value.text = "unauthorized"
        self.assertFalse(p.full({"ready": True, "arms": {}}))
        self.assertTrue(p.last_error.startswith("HTTP 401"))


class PushStrict(unittest.TestCase):
    def test_nan_and_inf_become_null_not_a_crash(self):
        sess = mock.Mock()
        sess.post.return_value.status_code = 200
        p = ArenaPush("tok", session=sess)
        self.assertTrue(p.full({"ready": True, "arms": {}, "x": float("nan"), "y": [float("inf"), 1.5]}))
        body = json.loads(sess.post.call_args.kwargs["data"])
        self.assertIsNone(body["payload"]["x"])
        self.assertEqual(body["payload"]["y"], [None, 1.5])


class Scheduling(unittest.TestCase):
    def test_cycle_due_waits_for_the_next_candle(self):
        desk = Desk(Config(), FakeLLM({}), state_dir=tempfile.mkdtemp(), data=StubData(frames()), universe=SYMS, random_prob=0.0)
        self.assertTrue(desk.cycle_due())                                             # nothing processed yet
        desk.state["last_bar"] = (datetime.now(timezone.utc) - timedelta(minutes=70)).isoformat()
        self.assertFalse(desk.cycle_due())                                            # the next candle has not closed yet
        desk.state["last_bar"] = (datetime.now(timezone.utc) - timedelta(hours=2, minutes=1)).isoformat()
        self.assertTrue(desk.cycle_due())
        desk.backoff(60)
        self.assertFalse(desk.cycle_due())                                            # backoff after a "no new candle" answer


if __name__ == "__main__":
    unittest.main()
