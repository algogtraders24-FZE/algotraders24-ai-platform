"""In-memory stand-in for BinanceBroker (same method names) so the direct desk can be tested end to end without any network or key."""
from __future__ import annotations

import time

from binance_agents.agents.execution import Fill, SafetyError, floor_to_step


class FakeExchange:
    env = "demo"

    def __init__(self, prices: dict[str, float], usdt: float = 10_000.0, cap: float = 1e9):
        self.prices = dict(prices)
        self.free = {"USDT": usdt}
        self.locked: dict[str, float] = {}
        self.orders: list[dict] = []
        self.trades: list[dict] = []
        self.cap = cap
        self.fail_stop = False
        self._id = 1

    def _nid(self) -> int:
        self._id += 1
        return self._id

    # ---- read
    def account(self) -> dict:
        assets = set(self.free) | set(self.locked)
        return {"balances": [{"asset": a, "free": str(self.free.get(a, 0.0)), "locked": str(self.locked.get(a, 0.0))} for a in assets]}

    def open_orders(self, symbol: str | None = None) -> list[dict]:
        return [o for o in self.orders if not symbol or o["symbol"] == symbol]

    def my_trades(self, symbol: str, limit: int = 50) -> list[dict]:
        return [t for t in self.trades if t["symbol"] == symbol][-limit:]

    def price(self, symbol: str) -> float:
        return self.prices[symbol]

    def book(self, symbol: str, limit: int = 50) -> dict:
        p = self.prices[symbol]
        return {"bids": [[str(p * 0.9995), "5000"], [str(p * 0.998), "9000"]], "asks": [[str(p * 1.0005), "5000"], [str(p * 1.002), "9000"]]}

    def filters(self, symbol: str) -> dict:
        return {"status": "TRADING", "tickSize": 0.01, "stepSize": 0.001, "minQty": 0.001, "minNotional": 5.0}

    # ---- write
    def _trade(self, symbol: str, side: str, qty: float, price: float, fee: float) -> int:
        oid = self._nid()
        self.trades.append({"symbol": symbol, "id": oid, "orderId": oid, "price": str(price), "qty": str(qty), "quoteQty": str(qty * price), "commission": str(fee),
                            "commissionAsset": "USDT", "time": int(time.time() * 1000), "isBuyer": side == "BUY"})
        return oid

    def buy_market(self, symbol: str, qty: float, ref_price: float, filters: dict) -> Fill:
        qty = floor_to_step(qty, filters["stepSize"])
        if qty < filters["minQty"] or qty * ref_price < filters["minNotional"]:
            raise SafetyError("Quantity is under the exchange minimum.")
        if qty * ref_price > self.cap * 1.0001:
            raise SafetyError("Order notional exceeds the per-order cap.")
        price = self.prices[symbol] * 1.0005
        cost, fee = qty * price, qty * price * 0.001
        self.free["USDT"] -= cost + fee
        asset = symbol[:-4]
        self.free[asset] = self.free.get(asset, 0.0) + qty
        oid = self._trade(symbol, "BUY", qty, price, fee)
        return Fill(symbol, "BUY", qty, price, fee, str(oid))

    def place_stop(self, symbol: str, qty: float, stop_price: float, filters: dict) -> str:
        if self.fail_stop:
            raise RuntimeError("stop rejected")
        asset = symbol[:-4]
        qty = floor_to_step(qty, filters["stepSize"])
        self.free[asset] = self.free.get(asset, 0.0) - qty
        self.locked[asset] = self.locked.get(asset, 0.0) + qty
        oid = self._nid()
        self.orders.append({"symbol": symbol, "orderId": oid, "side": "SELL", "type": "STOP_LOSS_LIMIT", "stopPrice": str(stop_price), "price": str(stop_price * 0.997), "origQty": str(qty)})
        return str(oid)

    def cancel(self, symbol: str, order_id: str) -> None:
        for o in list(self.orders):
            if str(o["orderId"]) == str(order_id):
                asset = symbol[:-4]
                q = float(o["origQty"])
                self.locked[asset] = self.locked.get(asset, 0.0) - q
                self.free[asset] = self.free.get(asset, 0.0) + q
                self.orders.remove(o)
                return
        raise RuntimeError("unknown order")

    def sell_market(self, symbol: str, qty: float, filters: dict) -> Fill:
        asset = symbol[:-4]
        qty = floor_to_step(qty, filters["stepSize"])
        price = self.prices[symbol] * 0.9995
        proceeds, fee = qty * price, qty * price * 0.001
        self.free[asset] = self.free.get(asset, 0.0) - qty
        self.free["USDT"] += proceeds - fee
        oid = self._trade(symbol, "SELL", qty, price, fee)
        return Fill(symbol, "SELL", qty, price, fee, str(oid))

    # ---- test helpers
    def trigger_stop(self, symbol: str) -> None:
        """The exchange fills the protective stop (price fell through it)."""
        for o in list(self.orders):
            if o["symbol"] == symbol:
                asset = symbol[:-4]
                q, px = float(o["origQty"]), float(o["stopPrice"]) * 0.999
                self.locked[asset] = self.locked.get(asset, 0.0) - q
                self.free["USDT"] += q * px * 0.999
                self._trade(symbol, "SELL", q, px, q * px * 0.001)
                self.orders.remove(o)
