"""Agent 5 - Execution: turns an approved order into fills. Two brokers behind one interface:

  PaperBroker   - simulated fills (slippage + fees) against real prices. The default everywhere. Used by the backtest and by `paper` mode.
  BinanceBroker - real Binance Spot REST (testnet or live). NEVER the default: it needs BINANCE_ENV, keys in the environment, refuses an API
                  key that can withdraw, caps every order, and live mode additionally needs two explicit confirmations.

BinanceBroker is written against Binance's documented REST API and unit-tested offline (signing, rounding, safety gates). It has NOT been run
against the exchange by the author - run it on the TESTNET first (https://testnet.binance.vision, free test keys) before anything else."""
from __future__ import annotations

import hashlib
import hmac
import math
import os
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import requests

from ..config import Costs, Live

TESTNET_URL = "https://testnet.binance.vision"
DEMO_URL = "https://demo-api.binance.com"      # Binance Spot Demo Mode: live-like prices, virtual funds, keys from the Demo Trading page
LIVE_URL = "https://api.binance.com"


@dataclass
class Fill:
    symbol: str
    side: str
    qty: float
    price: float
    fee: float
    order_id: str = ""


class PaperBroker:
    """Cash account, long-only, no leverage. Fills are modelled, never sent anywhere."""

    def __init__(self, costs: Costs, cash: float):
        self.c = costs
        self.cash = cash
        self.fills: list[Fill] = []

    def buy(self, symbol: str, qty: float, ref_price: float) -> Fill:
        price = ref_price * (1.0 + self.c.slippage)
        notional = qty * price
        fee = notional * self.c.fee
        self.cash -= notional + fee
        f = Fill(symbol, "BUY", qty, price, fee)
        self.fills.append(f)
        return f

    def sell(self, symbol: str, qty: float, ref_price: float) -> Fill:
        price = ref_price * (1.0 - self.c.slippage)
        notional = qty * price
        fee = notional * self.c.fee
        self.cash += notional - fee
        f = Fill(symbol, "SELL", qty, price, fee)
        self.fills.append(f)
        return f


# ----------------------------------------------------------------------------------------------------------------------
def floor_to_step(value: float, step: float) -> float:
    """Round DOWN to the exchange step (never up: rounding up could exceed the intended size / the balance)."""
    if step <= 0:
        return value
    return math.floor(round(value / step, 9)) * step if value > 0 else 0.0


def fmt(value: float, step: float) -> str:
    decimals = max(0, -int(math.floor(math.log10(step)))) if step < 1 else 0
    return f"{value:.{decimals}f}"


class SafetyError(RuntimeError):
    pass


class BinanceBroker:
    ENVS = {
        "testnet": ("BINANCE_TESTNET_API_KEY", "BINANCE_TESTNET_API_SECRET", TESTNET_URL),
        "demo": ("BINANCE_DEMO_API_KEY", "BINANCE_DEMO_API_SECRET", DEMO_URL),
        "live": ("BINANCE_API_KEY", "BINANCE_API_SECRET", LIVE_URL),
    }

    def __init__(self, live: Live, env: str | None = None, session: requests.Session | None = None):
        self.cfg = live
        self.env = (env or os.environ.get("BINANCE_ENV", "")).lower()
        if self.env not in self.ENVS:
            raise SafetyError("BINANCE_ENV must be 'demo', 'testnet' or 'live' to use the real broker (paper mode needs no broker).")
        if self.env == "live" and (os.environ.get("BINANCE_LIVE_CONFIRM") != "YES-I-ACCEPT-REAL-LOSSES"):
            raise SafetyError("Live trading needs BINANCE_LIVE_CONFIRM=YES-I-ACCEPT-REAL-LOSSES in the environment.")
        key_var, sec_var, self.base = self.ENVS[self.env]
        self.key, self.secret = os.environ.get(key_var, ""), os.environ.get(sec_var, "")
        if not self.key or not self.secret:
            raise SafetyError(f"{key_var} / {sec_var} are not set in the environment.")
        self.s = session or requests.Session()
        self.s.headers["X-MBX-APIKEY"] = self.key
        if self.env == "live":
            self._refuse_withdraw_permission()

    # ---- signing / transport -----------------------------------------------------------
    def sign(self, params: dict) -> str:
        q = urlencode(params)
        return hmac.new(self.secret.encode(), q.encode(), hashlib.sha256).hexdigest()

    def _request(self, method: str, path: str, params: dict | None = None, signed: bool = True):
        p = dict(params or {})
        if signed:
            p["timestamp"] = int(time.time() * 1000)
            p["recvWindow"] = 5000
            p["signature"] = self.sign({k: v for k, v in p.items() if k != "signature"})
        r = self.s.request(method, self.base + path, params=p, timeout=15)
        if r.status_code != 200:
            raise RuntimeError(f"Binance {method} {path} -> {r.status_code} {r.text[:200]}")
        return r.json()

    def _refuse_withdraw_permission(self) -> None:
        if not self.cfg.require_no_withdraw_permission:
            return
        info = self._request("GET", "/sapi/v1/account/apiRestrictions")
        if info.get("enableWithdrawals"):
            raise SafetyError("This API key can WITHDRAW funds. Create a trade-only key (withdrawals disabled, IP-restricted) and try again.")
        if not info.get("enableSpotAndMarginTrading"):
            raise SafetyError("This API key is not enabled for spot trading.")

    # ---- orders ------------------------------------------------------------------------
    def _check_notional(self, qty: float, price: float) -> None:
        if qty * price > self.cfg.max_order_notional * 1.0001:
            raise SafetyError(f"Order notional {qty * price:.2f} USDT exceeds the per-order cap {self.cfg.max_order_notional:.2f} USDT.")

    def buy_market(self, symbol: str, qty: float, ref_price: float, filters: dict) -> Fill:
        qty = floor_to_step(qty, filters["stepSize"])
        if qty < filters["minQty"] or qty * ref_price < filters["minNotional"]:
            raise SafetyError("Quantity is under the exchange minimum.")
        self._check_notional(qty, ref_price)
        o = self._request("POST", "/api/v3/order", {"symbol": symbol, "side": "BUY", "type": "MARKET", "quantity": fmt(qty, filters["stepSize"]), "newOrderRespType": "FULL"})
        executed = float(o["executedQty"])
        quote = float(o["cummulativeQuoteQty"])
        fee_usdt = sum(float(f["commission"]) for f in o.get("fills", []) if f.get("commissionAsset") == "USDT")
        return Fill(symbol, "BUY", executed, quote / executed if executed else 0.0, fee_usdt, str(o["orderId"]))

    def place_stop(self, symbol: str, qty: float, stop_price: float, filters: dict) -> str:
        """Protective STOP_LOSS_LIMIT sell (limit 0.3% below the trigger so it is likely to fill in a fast move)."""
        qty = floor_to_step(qty, filters["stepSize"])
        stop = floor_to_step(stop_price, filters["tickSize"])
        limit = floor_to_step(stop_price * 0.997, filters["tickSize"])
        o = self._request("POST", "/api/v3/order", {"symbol": symbol, "side": "SELL", "type": "STOP_LOSS_LIMIT", "timeInForce": "GTC",
                                                    "quantity": fmt(qty, filters["stepSize"]), "stopPrice": fmt(stop, filters["tickSize"]), "price": fmt(limit, filters["tickSize"])})
        return str(o["orderId"])

    def cancel(self, symbol: str, order_id: str) -> None:
        self._request("DELETE", "/api/v3/order", {"symbol": symbol, "orderId": order_id})

    def sell_market(self, symbol: str, qty: float, filters: dict) -> Fill:
        qty = floor_to_step(qty, filters["stepSize"])
        o = self._request("POST", "/api/v3/order", {"symbol": symbol, "side": "SELL", "type": "MARKET", "quantity": fmt(qty, filters["stepSize"]), "newOrderRespType": "FULL"})
        executed = float(o["executedQty"])
        quote = float(o["cummulativeQuoteQty"])
        fee_usdt = sum(float(f["commission"]) for f in o.get("fills", []) if f.get("commissionAsset") == "USDT")
        return Fill(symbol, "SELL", executed, quote / executed if executed else 0.0, fee_usdt, str(o["orderId"]))

    # ---- account (read-only) ------------------------------------------------------------
    def account(self) -> dict:
        return self._request("GET", "/api/v3/account")

    def open_orders(self, symbol: str | None = None) -> list[dict]:
        return self._request("GET", "/api/v3/openOrders", {"symbol": symbol} if symbol else {})

    def my_trades(self, symbol: str, limit: int = 50) -> list[dict]:
        return self._request("GET", "/api/v3/myTrades", {"symbol": symbol, "limit": limit})

    def order(self, symbol: str, order_id: str) -> dict:
        return self._request("GET", "/api/v3/order", {"symbol": symbol, "orderId": order_id})

    def price(self, symbol: str) -> float:
        return float(self._request("GET", "/api/v3/ticker/price", {"symbol": symbol}, signed=False)["price"])

    def book(self, symbol: str, limit: int = 50) -> dict:
        return self._request("GET", "/api/v3/depth", {"symbol": symbol, "limit": limit}, signed=False)

    def filters(self, symbol: str) -> dict:
        info = self._request("GET", "/api/v3/exchangeInfo", {"symbol": symbol}, signed=False)["symbols"][0]
        out = {"status": info["status"], "tickSize": 0.0, "stepSize": 0.0, "minNotional": 0.0, "minQty": 0.0}
        for f in info["filters"]:
            if f["filterType"] == "PRICE_FILTER":
                out["tickSize"] = float(f["tickSize"])
            elif f["filterType"] == "LOT_SIZE":
                out["stepSize"], out["minQty"] = float(f["stepSize"]), float(f["minQty"])
            elif f["filterType"] in ("NOTIONAL", "MIN_NOTIONAL"):
                out["minNotional"] = float(f.get("minNotional", 0.0))
        return out

    def usdt_balance(self) -> float:
        acct = self._request("GET", "/api/v3/account")
        for b in acct["balances"]:
            if b["asset"] == "USDT":
                return float(b["free"])
        return 0.0
