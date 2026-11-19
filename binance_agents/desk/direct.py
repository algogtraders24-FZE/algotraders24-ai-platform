"""Direct desk: the six Claude agents DECIDE (no house rule), the orders go to a real Binance account through BinanceBroker - Binance Spot DEMO account
(virtual funds) by default; live is intentionally not enabled in this version.

Per closed 1h candle: reconcile with the exchange -> time stops -> Scout -> Risk Checker -> Sentiment -> Strategy (BUY/SKIP, HOLD/TIGHTEN/EXIT) -> the rules
engine sizes the order -> Execution (MARKET or WAIT) -> Risk Manager (reduce or veto) -> MARKET buy, then a protective STOP_LOSS_LIMIT sell placed ON THE
EXCHANGE straight away (it keeps protecting the position even if this bot stops).
Hard limits that no agent can change: 1% risk per trade, 20% max position, 5 open positions, 5% daily loss, 20% drawdown halt, cooldown, a per-order notional
cap in the broker, stops only ever move UP, 72 h time stop. Silence or garbage from an agent means no order."""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import pandas as pd

from ..agents import Sentiment
from ..agents.risk_manager import RiskManager, RiskState
from ..config import Config
from . import schemas
from .cycle import STATE_DIR, Desk, iso, r4
from .prompts import DIRECT_SYSTEM

MAX_HOLD_HOURS = 72


class DirectDesk(Desk):
    def __init__(self, cfg: Config, llm, broker, state_dir: Path | None = None, data=None, universe: list[str] | None = None):
        super().__init__(cfg, llm, state_dir=state_dir or (STATE_DIR / "direct"), data=data, universe=universe, random_prob=0.0)
        self.broker = broker
        self.rm = RiskManager(cfg.risk, cfg.costs)
        f = self.dir / "direct_state.json"
        self.ds = json.loads(f.read_text(encoding="utf-8")) if f.exists() else {"positions": {}, "trades": [], "equity": [], "start_equity": None, "last_bar": None, "cycle": 0, "account": None, "risk": None}
        r = self.ds.get("risk")
        self.rs: RiskState | None = RiskState(r["peak_equity"], r["day"], r["day_start_equity"], r["halted"], r["last_exit_bar"]) if r else None
        if self.ds.get("last_bar"):
            self.state["last_bar"] = self.ds["last_bar"]

    # ------------------------------------------------------------------ persistence / plumbing
    def save_direct(self) -> None:
        if self.rs:
            self.ds["risk"] = {"peak_equity": self.rs.peak_equity, "day": self.rs.day, "day_start_equity": self.rs.day_start_equity, "halted": self.rs.halted, "last_exit_bar": self.rs.last_exit_bar}
        tmp = self.dir / "direct_state.json.tmp"
        tmp.write_text(json.dumps(self.ds, default=str), encoding="utf-8")
        tmp.replace(self.dir / "direct_state.json")
        self.save()

    def ask(self, agent: str, user: str) -> dict | None:
        out = self.llm.ask(agent, DIRECT_SYSTEM[agent], user)
        self.log_llm(agent, user, out)
        if out is None:
            err = self.llm.log[-1].error if self.llm.log else "no answer"
            self.event(agent, f"no usable answer ({err}) - safe default applied", arm="demo", level="warn")
        return out

    def ev(self, agent: str, text: str, level: str = "info") -> None:
        self.event(agent, text, arm="demo", level=level)

    def _live(self, symbol: str, last_close: float) -> dict:
        try:
            b = self.broker.book(symbol, 100)
            bid, ask = float(b["bids"][0][0]), float(b["asks"][0][0])
            return {"bid": bid, "ask": ask, "spread_bps": r4((ask - bid) / ((ask + bid) / 2) * 1e4, 2), "imbalance": r4(Sentiment.imbalance(b), 3), "book": b}
        except Exception:
            return {"bid": last_close, "ask": last_close, "spread_bps": None, "imbalance": None, "book": None}

    def _price(self, sym: str, prices: dict) -> float:
        px = prices.get(sym)
        if px:
            return px
        try:
            return self.broker.price(sym)
        except Exception:
            p = self.ds["positions"].get(sym)
            return p["entry"] if p else 0.0

    # ------------------------------------------------------------------ account
    def account_view(self, prices: dict) -> dict:
        acct = self.broker.account()
        free = locked = 0.0
        held: dict[str, dict] = {}
        for b in acct["balances"]:
            f, l = float(b["free"]), float(b["locked"])
            if f + l <= 0:
                continue
            if b["asset"] == "USDT":
                free, locked = f, l
            elif (b["asset"] + "USDT") in self.universe:
                held[b["asset"] + "USDT"] = {"free": f, "locked": l, "total": f + l}
        value = sum(h["total"] * self._price(s, prices) for s, h in held.items())
        # sizing equity = USDT + coins the desk bought itself; pre-funded coins (the testnet starts with 1 BTC, 1 ETH ...) are shown but never sized against
        own = sum(h["total"] * self._price(s, prices) for s, h in held.items() if s in self.ds["positions"])
        return {"usdt_free": free, "usdt_locked": locked, "held": held, "equity": free + locked + own, "account_equity": free + locked + value}

    def snapshot(self, view: dict, prices: dict) -> dict:
        try:
            oo = self.broker.open_orders()
        except Exception:
            oo = []
        pos = []
        for s, h in view["held"].items():
            p = self.ds["positions"].get(s)
            px = self._price(s, prices)
            pos.append({"symbol": s, "qty": h["total"], "price": r4(px, 6), "value": r4(h["total"] * px, 2), "entry": r4(p["entry"], 6) if p else None,
                        "pnl_pct": r4((px / p["entry"] - 1) * 100, 2) if p else None, "stop": r4(p["stop"], 6) if p else None, "managed": bool(p)})
        return {"ts": iso(pd.Timestamp.now(tz="UTC")), "env": getattr(self.broker, "env", "?"), "usdt_free": r4(view["usdt_free"], 2), "equity": r4(view["equity"], 2), "account_equity": r4(view.get("account_equity", view["equity"]), 2), "positions": pos,
                "open_orders": [{"symbol": o.get("symbol"), "side": o.get("side"), "type": o.get("type"), "stop_price": o.get("stopPrice"), "price": o.get("price"), "qty": o.get("origQty")} for o in oo]}

    # ------------------------------------------------------------------ reconcile with the exchange
    def _close_from_fills(self, sym: str, p: dict, now: str, reason: str = "stop") -> dict:
        try:
            fills = self.broker.my_trades(sym, 50)
        except Exception:
            fills = []
        sells = [f for f in fills if not f.get("isBuyer") and int(f["time"]) >= int(p["opened_ms"]) - 60_000]
        qty = sum(float(f["qty"]) for f in sells)
        quote = sum(float(f["quoteQty"]) for f in sells)
        fee = sum(float(f["commission"]) if f.get("commissionAsset") == "USDT" else float(f["commission"]) * float(f["price"]) for f in sells)
        if qty <= 0:                                           # no fills found: estimate at the stop and say so
            exit_px, proceeds, fee, reason = p["stop"], p["qty"] * p["stop"], p["qty"] * p["stop"] * self.cfg.costs.fee, reason + " (estimated)"
        else:
            exit_px, proceeds = quote / qty, quote
        pnl = proceeds - fee - p["cost"]
        tr = {"arm": "demo", "symbol": sym, "opened": p["opened"], "closed": now, "entry": p["entry"], "exit": exit_px, "qty": p["qty"], "pnl": pnl, "pnl_pct": pnl / p["cost"] if p["cost"] else 0.0,
              "r": pnl / p["risk_amount"] if p["risk_amount"] else 0.0, "bars": round((time.time() * 1000 - p["opened_ms"]) / 3_600_000, 1), "reason": reason, "conviction": p["conviction"], "thesis": p["thesis"]}
        self.ds["trades"].append(tr)
        if self.rs:
            self.rs.last_exit_bar[sym] = self.ds["cycle"]
        return tr

    def reconcile(self, view: dict, now: str) -> list[dict]:
        closed: list[dict] = []
        try:
            stops = {o["symbol"]: o for o in self.broker.open_orders() if o.get("side") == "SELL" and "STOP" in str(o.get("type", ""))}
        except Exception:
            stops = {}
        for sym, p in list(self.ds["positions"].items()):
            have = view["held"].get(sym, {}).get("total", 0.0)
            if have < p["qty"] * 0.1:                          # the position is gone: the exchange stop (or something else) sold it
                tr = self._close_from_fills(sym, p, now)
                del self.ds["positions"][sym]
                if sym in stops:
                    try:
                        self.broker.cancel(sym, str(stops[sym]["orderId"]))
                    except Exception:
                        pass
                self.ev("execution", f"{sym} closed by {tr['reason']}  P&L {tr['pnl']:+.2f} ({tr['r']:+.2f}R)", "good" if tr["pnl"] > 0 else "bad")
                closed.append(tr)
            elif sym not in stops:                              # protective stop missing -> put it back
                try:
                    p["stop_order_id"] = str(self.broker.place_stop(sym, have, p["stop"], self.broker.filters(sym)))
                    self.ev("risk_manager", f"{sym}: protective stop was missing - placed again at {p['stop']:.6g}", "warn")
                except Exception as e:
                    self.ev("risk_manager", f"{sym}: protective stop is MISSING and could not be placed ({type(e).__name__})", "bad")
        return closed

    # ------------------------------------------------------------------ orders
    def _free_qty(self, sym: str) -> float:
        asset = sym[:-4]
        for b in self.broker.account()["balances"]:
            if b["asset"] == asset:
                return float(b["free"])
        return 0.0

    def _sell(self, sym: str, reason: str, now: str) -> dict | None:
        p = self.ds["positions"].get(sym)
        if not p:
            return None
        f = self.broker.filters(sym)
        if p.get("stop_order_id"):
            try:
                self.broker.cancel(sym, p["stop_order_id"])
            except Exception:
                pass
        qty = self._free_qty(sym)
        if qty <= 0:
            return None
        fill = self.broker.sell_market(sym, qty, f)
        proceeds = fill.qty * fill.price
        fee = fill.fee or proceeds * self.cfg.costs.fee
        pnl = proceeds - fee - p["cost"]
        tr = {"arm": "demo", "symbol": sym, "opened": p["opened"], "closed": now, "entry": p["entry"], "exit": fill.price, "qty": fill.qty, "pnl": pnl, "pnl_pct": pnl / p["cost"] if p["cost"] else 0.0,
              "r": pnl / p["risk_amount"] if p["risk_amount"] else 0.0, "bars": round((time.time() * 1000 - p["opened_ms"]) / 3_600_000, 1), "reason": reason, "conviction": p["conviction"], "thesis": p["thesis"]}
        self.ds["trades"].append(tr)
        del self.ds["positions"][sym]
        if self.rs:
            self.rs.last_exit_bar[sym] = self.ds["cycle"]
        return tr

    def _tighten(self, sym: str, new_stop: float) -> bool:
        p = self.ds["positions"].get(sym)
        if not p or new_stop <= p["stop"]:
            return False                                       # stops only ever move UP
        f = self.broker.filters(sym)
        have = self._free_qty(sym) + 0.0
        try:
            if p.get("stop_order_id"):
                self.broker.cancel(sym, p["stop_order_id"])
            have = self._free_qty(sym)
            p["stop_order_id"] = str(self.broker.place_stop(sym, have, new_stop, f))
            p["stop"] = new_stop
            return True
        except Exception:
            try:                                                 # never leave the position without a stop
                p["stop_order_id"] = str(self.broker.place_stop(sym, self._free_qty(sym), p["stop"], f))
            except Exception:
                pass
            return False

    def _buy(self, sym: str, row: dict, live: dict, stop_atr: float, size_mult: float, conviction: float, thesis: str, equity: float, cash: float, now: str) -> str:
        ref, atr = live["ask"], row["atr"]
        sz = self.rm.size(equity, cash, ref, ref - stop_atr * atr)
        if sz.qty <= 0:
            return f"blocked: {sz.reason}"
        qty = sz.qty * max(0.0, min(1.0, size_mult))
        cap = getattr(getattr(self.broker, "cfg", None), "max_order_notional", None)
        if cap and qty * ref > cap:                              # per-order cap: shrink the order instead of refusing it
            qty = cap / ref * 0.999
        try:
            f = self.broker.filters(sym)
            fill = self.broker.buy_market(sym, qty, ref, f)
        except Exception as e:
            return f"blocked: {type(e).__name__}: {str(e)[:100]}"
        if fill.qty <= 0:
            return "blocked: nothing filled"
        stop = fill.price - stop_atr * atr
        try:
            oid = str(self.broker.place_stop(sym, fill.qty, stop, f))
        except Exception as e:                                   # a position without a stop is not allowed: sell it straight back
            try:
                self.broker.sell_market(sym, fill.qty, f)
            except Exception:
                pass
            return f"stop could not be placed ({type(e).__name__}) - position closed again"
        fee = fill.fee or fill.qty * fill.price * self.cfg.costs.fee
        self.ds["positions"][sym] = {"symbol": sym, "qty": fill.qty, "entry": fill.price, "stop": stop, "stop_order_id": oid, "atr": atr, "opened": now, "opened_ms": int(time.time() * 1000),
                                     "cost": fill.qty * fill.price + fee, "risk_amount": sz.risk_amount * max(0.0, min(1.0, size_mult)), "conviction": conviction, "thesis": thesis}
        return f"bought {fill.qty:.6g} @ {fill.price:.6g}, stop {stop:.6g} on the exchange"

    # ------------------------------------------------------------------ scheduling + cycle
    def run_cycle(self) -> dict:
        raw, feats = self.refresh()
        if not feats:
            return {"status": "no data"}
        latest = max(f["open_time"].iloc[-1] for f in feats.values())
        if self.ds.get("last_bar") and latest <= pd.Timestamp(self.ds["last_bar"]):
            return {"status": "no new closed candle", "latest": iso(latest)}
        now = iso(latest)
        rows = {s: self._row(f) for s, f in feats.items() if f["open_time"].iloc[-1] == latest}
        prices = {s: r["close"] for s, r in rows.items()}
        regime = self._market_context(rows, feats)
        self.state["regime"] = regime
        self.ds["cycle"] += 1
        view = self.account_view(prices)
        closed = self.reconcile(view, now)
        for tr in closed:
            self._review(tr)
        view = self.account_view(prices) if closed else view
        equity = view["equity"]
        if self.ds["start_equity"] is None:
            self.ds["start_equity"] = equity
        if self.rs is None:
            self.rs = self.rm.new_state(equity)
        self.rm.on_bar(self.rs, now[:10], equity)
        for s, p in list(self.ds["positions"].items()):          # time stop
            if (time.time() * 1000 - p["opened_ms"]) / 3_600_000 >= MAX_HOLD_HOURS:
                tr = self._sell(s, "time", now)
                if tr:
                    self.ev("execution", f"{s} sold by the {MAX_HOLD_HOURS} h time stop  P&L {tr['pnl']:+.2f}", "good" if tr["pnl"] > 0 else "bad")
                    self._review(tr)
        view = self.account_view(prices)
        liquid = {s: r for s, r in rows.items() if self.checker.check_bar(s, r)[0]}
        res = self._decide(liquid, rows, prices, view, now, regime)
        view = self.account_view(prices)
        self.ds["account"] = self.snapshot(view, prices)
        self.ds["equity"].append([now, round(view["equity"], 2)])
        self.ds["equity"] = self.ds["equity"][-1500:]
        self.ds["last_bar"] = latest.isoformat()
        self.state["last_bar"] = latest.isoformat()
        self.save_direct()
        return {"status": "ok", "bar": now, "demo": res}

    def _decide(self, liquid: dict, rows: dict, prices: dict, view: dict, now: str, regime: dict) -> dict:
        positions = self.ds["positions"]
        if self.rs.halted:
            self.ev("risk_manager", "HALTED: 20% drawdown rule - a human must reset (exchange stops keep protecting open positions)", "bad")
            return {"skipped": "halted"}
        spikes = sorted([s for s, r in liquid.items() if not math.isnan(r["rel_volume"]) and r["rel_volume"] >= 1.3 and s not in positions], key=lambda s: liquid[s]["rel_volume"], reverse=True)[:5]
        if not spikes and not positions:
            self.ev("scout", "scanning: no unusual volume on the latest candle")
            return {"skipped": "nothing unusual"}
        if self.llm.over_budget():
            self.ev("risk_manager", f"LLM daily budget ${self.llm.daily_budget_usd:.2f} reached - no new decisions today (exchange stops stay active)", "warn")
            return {"skipped": "budget"}

        ctx = {k: v for k, v in regime.items() if k != "chg24"}
        picks: list[str] = []
        if spikes:
            sc = self.ask("scout", json.dumps({"candidates": self._cand_table(liquid, spikes), "market": ctx}))
            picks = [p["symbol"] for p in schemas.parse_scout(sc, set(spikes))] if sc is not None else spikes[:3]
            self.ev("scout", ("picks " + ", ".join(picks)) if picks else "no pick: " + (schemas.text((sc or {}).get("note"), 160) or "nothing met the bar"))
        live = {s: self._live(s, prices[s]) for s in picks}
        pick_set, open_set = set(picks), set(positions)
        equity, cash = view["equity"], view["usdt_free"]

        checks, views, dec, posact = {}, {}, {}, {}
        if picks:
            rc = self.ask("risk_checker", json.dumps({"picks": [{"symbol": s, "quote_vol_24h_musdt": r4(liquid[s]["quote_vol_24h"] / 1e6, 1), "spread_bps": live[s]["spread_bps"],
                                                                 "intended_notional_usdt": r4(equity * self.cfg.risk.max_position_pct, 0)} for s in picks]}))
            checks = schemas.parse_risk_checker(rc, pick_set)
            self.ev("risk_checker", " ".join(f"{s}:{'OK' if c['pass'] else 'NO'}" for s, c in checks.items()))
            sv = self.ask("sentiment", json.dumps({"symbols": [{"symbol": s, "book_imbalance_bid_share": live[s]["imbalance"], "spread_bps": live[s]["spread_bps"],
                                                                "chg_24h_pct": r4(regime["chg24"].get(s), 2), "rel_volume": r4(liquid[s]["rel_volume"], 2)} for s in picks], "market": ctx}))
            views, mood = schemas.parse_sentiment(sv, pick_set)
            self.ev("sentiment", f"{mood}: " + " ".join(f"{s}:{v['bias'][:4]}" for s, v in views.items()))
        pos_view = []
        for s, p in positions.items():
            px = self._price(s, prices)
            pos_view.append({"symbol": s, "entry": r4(p["entry"], 6), "price": r4(px, 6), "pnl_pct": r4((px / p["entry"] - 1) * 100, 2), "stop": r4(p["stop"], 6), "atr": r4(p["atr"], 6),
                             "hours_held": round((time.time() * 1000 - p["opened_ms"]) / 3_600_000, 1), "thesis": p["thesis"]})
        if picks or pos_view:
            st = self.ask("strategy", json.dumps({"picks": [{**c, "risk_check": checks.get(c["symbol"]), "sentiment": views.get(c["symbol"])} for c in self._cand_table(liquid, picks)],
                                                 "open_positions": pos_view, "market": ctx, "lessons_unverified_one_sample_each": self.state.get("lessons", [])[-5:]}))
            dec, posact = schemas.parse_strategy(st, pick_set, open_set)
            for s, d in dec.items():
                self.ev("strategy", f"{s}: {d['action']} conviction {d['conviction']:.2f} stop {d['stop_atr']:.1f}xATR - {d['thesis']}", "good" if d["action"] == "BUY" else "info")
            for s, a in posact.items():
                if a["action"] == "EXIT":
                    tr = self._sell(s, "agent_exit", now)
                    if tr:
                        self.ev("execution", f"EXIT {s} P&L {tr['pnl']:+.2f} - {a['why']}", "good" if tr["pnl"] > 0 else "bad")
                        self._review(tr)
                elif a["action"] == "TIGHTEN":
                    p = positions.get(s)
                    px = self._price(s, prices)
                    if p and self._tighten(s, min(px * 0.999, px - a["stop_atr"] * p["atr"])):
                        self.ev("strategy", f"TIGHTEN {s} stop to {positions[s]['stop']:.6g} - {a['why']}")
            view = self.account_view(prices)
            equity, cash = view["equity"], view["usdt_free"]
        buys = [s for s in sorted(dec, key=lambda x: dec[x]["conviction"], reverse=True) if dec[s]["action"] == "BUY" and checks.get(s, {}).get("pass")]
        if not buys:
            return {"picks": picks, "bought": []}
        planned = {}
        for s in buys:
            ok, why = self.rm.can_enter(self.rs, equity, len(positions), s, self.ds["cycle"])
            ref = live[s]["ask"]
            sz = self.rm.size(equity, cash, ref, ref - dec[s]["stop_atr"] * liquid[s]["atr"]) if ok else None
            if sz and sz.qty > 0:
                planned[s] = {"qty": sz.qty, "notional": r4(sz.qty * ref, 2), "risk_usdt": r4(sz.risk_amount, 2), "stop": r4(ref - dec[s]["stop_atr"] * liquid[s]["atr"], 6)}
            else:
                self.ev("risk_manager", f"{s}: rules engine blocks the entry ({why if not ok else (sz.reason if sz else 'size')})", "warn")
        if not planned:
            return {"picks": picks, "bought": []}
        ex = self.ask("execution", json.dumps({"approved_buys": [{"symbol": s, "atr_pct": r4(liquid[s]["atr"] / prices[s] * 100, 2), "spread_bps": live[s]["spread_bps"],
                                                                 "candle_rel_volume": r4(liquid[s]["rel_volume"], 2), "close_vs_48h_high_pct": r4((prices[s] / liquid[s]["prior_high"] - 1) * 100, 2)} for s in planned]}))
        orders = schemas.parse_execution_direct(ex, set(planned))
        mg = self.ask("risk_manager", json.dumps({"portfolio": {"equity": r4(equity, 2), "cash": r4(cash, 2), "exposure_pct": r4((equity - cash) / equity * 100, 1) if equity else 0, "open_positions": pos_view,
                                                                "day_start_equity": r4(self.rs.day_start_equity, 2), "peak_equity": r4(self.rs.peak_equity, 2)},
                                                  "proposed_buys": [{"symbol": s, **planned[s], "conviction": dec[s]["conviction"], "thesis": dec[s]["thesis"]} for s in planned], "market": ctx}))
        mgr, note = schemas.parse_manager(mg, set(planned))
        self.ev("risk_manager", (note or "reviewed proposals") + " | " + " ".join(f"{s}:{('x%.2f' % m['size_multiplier']) if m['approve'] else 'VETO'}" for s, m in mgr.items()))
        bought = []
        for s in planned:
            m, o = mgr[s], orders[s]
            if not m["approve"] or m["size_multiplier"] <= 0:
                continue
            if o["type"] != "MARKET":
                self.ev("execution", f"WAIT {s}: {o['why']}")
                continue
            res = self._buy(s, liquid[s], live[s], dec[s]["stop_atr"], m["size_multiplier"], dec[s]["conviction"], dec[s]["thesis"], equity, cash, now)
            self.ev("execution", f"MARKET {s}: {res}", "good" if res.startswith("bought") else "warn")
            if res.startswith("bought"):
                bought.append(f"{s}: {res}")
                view = self.account_view(prices)
                equity, cash = view["equity"], view["usdt_free"]
        return {"picks": picks, "bought": bought}

    # ------------------------------------------------------------------ live tick (15 s) for the dashboard
    def live_account(self) -> dict | None:
        try:
            prices = {s: self.broker.price(s) for s in self.ds["positions"]}
            view = self.account_view(prices)
            snap = self.snapshot(view, prices)
        except Exception:
            return None
        start = self.ds.get("start_equity") or view["equity"]
        today = pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%d")
        day_start = (self.rs.day_start_equity if self.rs and self.rs.day == today and self.rs.day_start_equity else start)
        self.ds["account"] = snap
        return {"equity": round(view["equity"], 2), "return_pct": round((view["equity"] / start - 1) * 100, 3), "day_pnl": round(view["equity"] - day_start, 2), "open": len(self.ds["positions"]), "account": snap}
