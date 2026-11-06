import hashlib
import hmac
import os
import unittest
from unittest import mock

from binance_agents.agents.execution import BinanceBroker, PaperBroker, SafetyError, floor_to_step, fmt
from binance_agents.config import Costs, Live


class FakeResp:
    def __init__(self, data, code=200):
        self._d, self.status_code, self.text = data, code, str(data)

    def json(self):
        return self._d


class Execution(unittest.TestCase):
    def test_rounding_never_rounds_up(self):
        self.assertEqual(floor_to_step(0.123456, 0.001), 0.123)
        self.assertEqual(floor_to_step(5.0, 0.1), 5.0)
        self.assertEqual(fmt(0.123, 0.001), "0.123")
        self.assertEqual(fmt(12.0, 1.0), "12")

    def test_paper_fills_cost_money(self):
        b = PaperBroker(Costs(), 1000.0)
        f = b.buy("BTCUSDT", 1.0, 100.0)
        self.assertGreater(f.price, 100.0)
        self.assertLess(b.cash, 900.0)
        s = b.sell("BTCUSDT", 1.0, 100.0)
        self.assertLess(s.price, 100.0)
        self.assertLess(b.cash, 1000.0)

    def test_broker_refuses_without_env(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SafetyError):
                BinanceBroker(Live())

    def test_live_needs_confirmation_and_keys(self):
        with mock.patch.dict(os.environ, {"BINANCE_ENV": "live", "BINANCE_API_KEY": "k", "BINANCE_API_SECRET": "s"}, clear=True):
            with self.assertRaises(SafetyError):
                BinanceBroker(Live())

    def test_live_refuses_a_key_that_can_withdraw(self):
        env = {"BINANCE_ENV": "live", "BINANCE_LIVE_CONFIRM": "YES-I-ACCEPT-REAL-LOSSES", "BINANCE_API_KEY": "k", "BINANCE_API_SECRET": "s"}
        sess = mock.Mock()
        sess.headers = {}
        sess.request.return_value = FakeResp({"enableWithdrawals": True, "enableSpotAndMarginTrading": True})
        with mock.patch.dict(os.environ, env, clear=True):
            with self.assertRaises(SafetyError):
                BinanceBroker(Live(), session=sess)

    def test_signature_matches_the_documented_example(self):
        # HMAC-SHA256 example from the public Binance API documentation.
        secret = "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
        query = "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559"
        sig = hmac.new(secret.encode(), query.encode(), hashlib.sha256).hexdigest()
        self.assertEqual(sig, "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71")

    def test_broker_sign_uses_the_same_algorithm(self):
        env = {"BINANCE_ENV": "testnet", "BINANCE_TESTNET_API_KEY": "k", "BINANCE_TESTNET_API_SECRET": "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"}
        sess = mock.Mock()
        sess.headers = {}
        with mock.patch.dict(os.environ, env, clear=True):
            b = BinanceBroker(Live(), session=sess)
            sig = b.sign({"symbol": "LTCBTC", "side": "BUY", "type": "LIMIT", "timeInForce": "GTC", "quantity": 1, "price": 0.1, "recvWindow": 5000, "timestamp": 1499827319559})
            self.assertEqual(sig, "c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71")

    def test_order_cap(self):
        env = {"BINANCE_ENV": "testnet", "BINANCE_TESTNET_API_KEY": "k", "BINANCE_TESTNET_API_SECRET": "s"}
        sess = mock.Mock()
        sess.headers = {}
        with mock.patch.dict(os.environ, env, clear=True):
            b = BinanceBroker(Live(max_order_notional=100.0), session=sess)
            with self.assertRaises(SafetyError):
                b.buy_market("BTCUSDT", 1.0, 80_000.0, {"stepSize": 0.00001, "minQty": 0.00001, "minNotional": 5.0, "tickSize": 0.01})


if __name__ == "__main__":
    unittest.main()
