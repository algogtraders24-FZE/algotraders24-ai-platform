"""One hourly cycle of the desk: update data -> deterministic exits for every arm -> new decisions.
Three arms trade the same market with the same rules engine, fees and slippage:
  desk   - the six Claude agents (+ Reviewer). Their proposals are validated/clipped and the rules engine keeps the final word.
  rules  - the deterministic breakout + volume strategy (no LLM).
  random - coin-flip entries (same trend + liquidity filters, same exits, matched trade frequency).  The honest yardstick.
Nothing here ever touches a real exchange account: only public market data is read and everything is paper."""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..agents import RiskChecker, Scout, Sentiment, Strategy
from ..config import Config
from ..data import BinanceData
from ..features import compute_features
from . import schemas
from .book import PaperBook
from .prompts import SYSTEM

ARMS = ("desk", "rules", "random")
AGENTS = ("scout", "risk_checker", "sentiment", "strategy", "execution", "risk_manager", "reviewer")
STATE_DIR = Path(__file__).resolve().parents[1] / "state"


def iso(ts) -> str:
    return pd.Timestamp(ts).tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def r4(x, n=4):
    return None if x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x))) else round(float(x), n)


class Desk:
    def __init__(self, cfg: Config, llm, state_dir: Path | None = None, data: BinanceData | None = None, universe: list[str] | None = None,
                 random_prob: float = 0.004, live_books: bool = True):
        self.cfg, self.llm = cfg, llm
        self.dir = Path(state_dir or STATE_DIR)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.data = data or BinanceData()
        self.universe = universe or list(cfg.universe)
        self.random_prob = random_prob
        self.live_books = live_books
        self.scout, self.checker, self.sent, self.strat = Scout(cfg.params), RiskChecker(cfg.params, cfg.live), Sentiment(cfg.live), Strategy(cfg.params)
        self.state = self._load()
        self.arms = {n: PaperBook.from_dict(self.state["arms"][n], cfg) if n in self.state.get("arms", {}) else PaperBook(n, cfg) for n in ARMS}

    # ------------------------------------------------------------------ persistence / feed
    def _load(self) -> dict:
        f = self.dir / "desk_state.json"
        if f.exists():
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                pass
        return {"last_bar": None, "arms": {}, "lessons": [], "agents": {}, "regime": "neutral", "ticker": [], "llm": {}, "created": iso(pd.Timestamp.now(tz="UTC"))}

    def save(self) -> None:
        self.state["arms"] = {n: b.to_dict() for n, b in self.arms.items()}
        self.state["llm"] = {"spent_today_usd": round(self.llm.spent_today(), 4), "budget_usd": self.llm.daily_budget_usd, "calls": len(self.llm.log),
                             "failed": sum(1 for c in self.llm.log if not c.ok)}
        tmp = self.dir / "desk_state.json.tmp"
        tmp.write_text(json.dumps(self.state, default=str), encoding="utf-8")
        tmp.replace(self.dir / "desk_state.json")

    def event(self, agent: str, text: str, arm: str = "desk", level: str = "info", **extra) -> None:
        rec = {"ts": iso(pd.Timestamp.now(tz="UTC")), "agent": agent, "arm": arm, "level": level, "text": text, **extra}
        with (self.dir / "activity.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, default=str) + "\n")
        st = self.state["agents"].setdefault(agent, {})
        st.update({"ts": rec["ts"], "text": text, "level": level})

    def log_llm(self, agent: str, user: str, out: dict | None) -> None:
        c = self.llm.log[-1] if self.llm.log else None
        with (self.dir / "llm_calls.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"agent": agent, "ok": bool(c and c.ok), "seconds": getattr(c, "seconds", 0), "tokens_in": getattr(c, "tokens_in", 0), "tokens_out": getattr(c, "tokens_out", 0),
                                "cost_usd": getattr(c, "cost_usd", 0), "error": getattr(c, "error", ""), "ts": iso(pd.Timestamp.now(tz="UTC")), "user": user[:6000], "response": out}, default=str) + "\n")

    def ask(self, agent: str, user: str) -> dict | None:
        out = self.llm.ask(agent, SYSTEM[agent], user)
        self.log_llm(agent, user, out)
        if out is None:
            err = self.llm.log[-1].error if self.llm.log else "no answer"
            self.event(agent, f"no usable answer ({err}) - safe default applied", level="warn")
        return out

    # ------------------------------------------------------------------ market data
    def refresh(self, tail: int = 400) -> tuple[dict[str, pd.DataFrame], dict[str, pd.DataFrame]]:
        raw, feats = {}, {}
        for s in self.universe:
            try:
                df = self.data.klines(s, self.cfg.params.interval, "2021-01-01")
            except Exception as e:
                self.event("scout", f"{s}: data error {str(e)[:80]}", level="warn")
                continue
            if len(df) > 300:
                raw[s] = df
                feats[s] = compute_features(df.tail(tail + 250).reset_index(drop=True), self.cfg.params).tail(tail).reset_index(drop=True)
        return raw, feats

    def _row(self, f: pd.DataFrame, i: int = -1) -> dict:
        r = f.iloc[i]
        return {k: (bool(r[k]) if k in ("breakout", "bullish", "trend_ok") else (r[k].isoformat() if k == "open_time" else float(r[k]))) for k in f.columns}

    # ------------------------------------------------------------------ scheduling
    def cycle_due(self) -> bool:
        """A new decision cycle is due once the next 1h candle (last processed + 2h) has closed, with 20 s for the data to settle."""
        now = pd.Timestamp.now(tz="UTC")
        if now < getattr(self, "_retry_at", pd.Timestamp(0, tz="UTC")):
            return False
        lb = self.state.get("last_bar")
        return True if not lb else now >= pd.Timestamp(lb) + pd.Timedelta(hours=2, seconds=20)

    def backoff(self, seconds: int = 30) -> None:
        self._retry_at = pd.Timestamp.now(tz="UTC") + pd.Timedelta(seconds=seconds)

    # ------------------------------------------------------------------ cycle
    def run_cycle(self) -> dict:
        raw, feats = self.refresh()
        if not feats:
            return {"status": "no data"}
        times = sorted(set().union(*[set(f["open_time"]) for f in feats.values()]))
        latest = times[-1]
        last = pd.Timestamp(self.state["last_bar"]) if self.state.get("last_bar") else None
        if last is not None and latest <= last:
            return {"status": "no new closed candle", "latest": iso(latest)}
        todo = [t for t in times if last is not None and t > last][-48:] if last is not None else [latest]
        by_time = {s: f.set_index("open_time") for s, f in feats.items()}

        # ---- deterministic part: exits, limit orders, equity marks, for every arm, candle by candle
        for t in todo:
            candles = {s: {k: float(by_time[s].loc[t, k]) for k in ("open", "high", "low", "close")} for s in by_time if t in by_time[s].index}
            prices = {s: v["close"] for s, v in candles.items()}
            for name, book in self.arms.items():
                book.cycle += 1
                for tr in book.process_candle(candles, iso(t)):
                    self.event("execution", f"{name}: {tr['symbol']} closed by {tr['reason']}  P&L {tr['pnl']:+.2f} ({tr['r']:+.2f}R)", arm=name, level="good" if tr["pnl"] > 0 else "bad")
                    if name == "desk":
                        self._review(tr)
                eq = book.value(prices)
                book.rm.on_bar(book.rs, iso(t)[:10], eq)
                book.equity.append([iso(t), round(eq, 2)])
        self.state["last_bar"] = latest.isoformat()

        # ---- decisions at the latest closed candle
        rows = {s: self._row(f) for s, f in feats.items() if f["open_time"].iloc[-1] == latest}
        prices = {s: r["close"] for s, r in rows.items()}
        liquid = {s: r for s, r in rows.items() if self.checker.check_bar(s, r)[0]}
        regime = self._market_context(rows, feats)
        self.state["regime"] = regime
        self.state["radar"] = [{"symbol": s, "close": r4(r["close"], 6), "rel_volume": r4(r["rel_volume"], 2), "chg24": r4(regime["chg24"].get(s), 2), "breakout": r["breakout"],
                                "trend_ok": r["trend_ok"], "bullish": r["bullish"], "liquid": s in liquid,
                                "avg_qv48": r4(float(feats[s]["quote_volume"].iloc[-49:-1].mean()), 0)} for s, r in sorted(rows.items())]
        self.state["ticker"] = [{"symbol": s, "price": r4(rows[s]["close"], 4), "chg24": r4(regime["chg24"].get(s))} for s in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "LINKUSDT", "AVAXUSDT") if s in rows]
        out = {"status": "ok", "bar": iso(latest)}
        out["rules"] = self._rules_arm(liquid, prices, iso(latest))
        out["random"] = self._random_arm(liquid, prices, iso(latest), latest)
        out["desk"] = self._desk_arm(liquid, rows, prices, iso(latest), regime)
        self.save()
        return out

    # ------------------------------------------------------------------ context
    def _market_context(self, rows: dict, feats: dict) -> dict:
        above = [r["trend_ok"] for r in rows.values()]
        chg24 = {}
        for s, f in feats.items():
            if len(f) > 25:
                chg24[s] = float(f["close"].iloc[-1] / f["close"].iloc[-25] - 1.0) * 100
        btc = feats.get("BTCUSDT")
        return {"breadth_above_ema200_pct": r4(100.0 * sum(above) / max(1, len(above)), 1), "btc_24h_pct": r4(chg24.get("BTCUSDT"), 2),
                "btc_7d_pct": r4((float(btc["close"].iloc[-1] / btc["close"].iloc[-169] - 1.0) * 100) if btc is not None and len(btc) > 170 else None, 2),
                "btc_above_ema200": bool(rows["BTCUSDT"]["trend_ok"]) if "BTCUSDT" in rows else None,
                "universe_up_24h_pct": r4(100.0 * sum(1 for v in chg24.values() if v > 0) / max(1, len(chg24)), 1), "chg24": chg24}

    def _live(self, symbol: str, last_close: float) -> dict:
        """Best bid/ask, spread, imbalance. Falls back to the last close when the book cannot be read (paper mode never needs it to be perfect)."""
        if self.live_books:
            try:
                b = self.data.book(symbol, 100)
                bid, ask = float(b["bids"][0][0]), float(b["asks"][0][0])
                return {"bid": bid, "ask": ask, "spread_bps": r4((ask - bid) / ((ask + bid) / 2) * 1e4, 2), "imbalance": r4(Sentiment.imbalance(b), 3), "book": b}
            except Exception:
                pass
        return {"bid": last_close, "ask": last_close, "spread_bps": None, "imbalance": None, "book": None}

    # ------------------------------------------------------------------ arms
    def _enter(self, book: PaperBook, sym: str, row: dict, prices: dict, now: str, stop_atr: float, ref: float, size_mult=1.0, conviction=0.0, thesis="", limit_bps=0.0) -> str:
        ok, why = book.can_enter(sym, prices)
        if not ok:
            return f"blocked: {why}"
        if limit_bps > 0:
            done = book.place_limit(sym, ref * (1 - limit_bps / 1e4), row["atr"], stop_atr, now, prices, size_mult, conviction, thesis)
            return "limit placed" if done else "blocked: position too small"
        p = book.buy_market(sym, ref, row["atr"], stop_atr, now, prices, size_mult, conviction, thesis)
        return f"bought {p.qty:.6g} @ {p.entry:.6g} stop {p.stop:.6g}" if p else "blocked: position too small"

    def _rules_arm(self, liquid: dict, prices: dict, now: str) -> list:
        book, acts = self.arms["rules"], []
        for c in self.scout.scan(liquid):
            sig = self.strat.evaluate(c.symbol, liquid[c.symbol])
            if sig:
                res = self._enter(book, c.symbol, liquid[c.symbol], prices, now, self.cfg.params.stop_atr, liquid[c.symbol]["close"])
                acts.append(f"{c.symbol}: {res}")
                self.event("strategy", f"rules: {c.symbol} breakout x{sig.rel_volume:.1f} volume -> {res}", arm="rules")
        return acts

    def _random_arm(self, liquid: dict, prices: dict, now: str, latest) -> list:
        book, acts = self.arms["random"], []
        rng = np.random.default_rng(int(pd.Timestamp(latest).timestamp()))
        for s, r in sorted(liquid.items()):
            if r["trend_ok"] and not math.isnan(r["atr"]) and rng.random() < self.random_prob:
                res = self._enter(book, s, r, prices, now, self.cfg.params.stop_atr, r["close"])
                acts.append(f"{s}: {res}")
                self.event("strategy", f"random: coin flip picked {s} -> {res}", arm="random")
        return acts

    # ---- the Claude desk ------------------------------------------------------------
    def _cand_table(self, rows: dict, feats_syms: list[str]) -> list[dict]:
        out = []
        for s in feats_syms:
            r = rows[s]
            out.append({"symbol": s, "close": r4(r["close"], 6), "rel_volume": r4(r["rel_volume"], 2), "breakout": r["breakout"], "bullish": r["bullish"],
                        "above_ema200": r["trend_ok"], "close_vs_48h_high_pct": r4((r["close"] / r["prior_high"] - 1) * 100, 2) if r["prior_high"] else None,
                        "atr_pct": r4(r["atr"] / r["close"] * 100, 2), "quote_vol_24h_musdt": r4(r["quote_vol_24h"] / 1e6, 1)})
        return out

    def _desk_arm(self, liquid: dict, rows: dict, prices: dict, now: str, regime: dict) -> dict:
        book = self.arms["desk"]
        if book.rs.halted:
            self.event("risk_manager", "HALTED: 20% drawdown rule - a human must reset", level="bad")
            return {"skipped": "halted"}
        spikes = sorted([s for s, r in liquid.items() if not math.isnan(r["rel_volume"]) and r["rel_volume"] >= 1.3 and r["bullish"] and s not in book.pos], key=lambda s: liquid[s]["rel_volume"], reverse=True)[:5]
        if not spikes and not book.pos:
            self.event("scout", "scanning: no unusual volume on the latest candle", level="info")
            return {"skipped": "nothing unusual"}
        if self.llm.over_budget():
            self.event("risk_manager", f"LLM daily budget ${self.llm.daily_budget_usd:.2f} reached - desk makes no new decisions today", level="warn")
            return {"skipped": "budget"}

        ctx = {k: v for k, v in regime.items() if k != "chg24"}
        picks: list[str] = []
        if spikes:
            sc = self.ask("scout", json.dumps({"candidates": self._cand_table(liquid, spikes), "market": ctx}))
            picks = [p["symbol"] for p in schemas.parse_scout(sc, set(spikes))] if sc is not None else spikes[:3]
            if picks:
                self.event("scout", "picks " + ", ".join(picks) + (" (Scout silent - top volume used)" if sc is None else ""))
            elif sc is not None:
                self.event("scout", "no pick: " + (schemas.text(sc.get("note"), 160) or "nothing met the bar"))
        live = {s: self._live(s, prices[s]) for s in picks}
        pick_set, open_set = set(picks), set(book.pos)

        checks, views, dec, posact, orders, mgr = {}, {}, {}, {}, {}, {}
        if picks:
            rc = self.ask("risk_checker", json.dumps({"picks": [{"symbol": s, "quote_vol_24h_musdt": r4(liquid[s]["quote_vol_24h"] / 1e6, 1), "spread_bps": live[s]["spread_bps"],
                                                                 "intended_notional_usdt": r4(book.value(prices) * self.cfg.risk.max_position_pct, 0)} for s in picks]}))
            checks = schemas.parse_risk_checker(rc, pick_set)
            self.event("risk_checker", " ".join(f"{s}:{'OK' if c['pass'] else 'NO'}" for s, c in checks.items()), level="info")
            sv = self.ask("sentiment", json.dumps({"symbols": [{"symbol": s, "book_imbalance_bid_share": live[s]["imbalance"], "spread_bps": live[s]["spread_bps"],
                                                                "chg_24h_pct": r4(regime["chg24"].get(s), 2), "rel_volume": r4(liquid[s]["rel_volume"], 2)} for s in picks], "market": ctx}))
            views, mood = schemas.parse_sentiment(sv, pick_set)
            self.event("sentiment", f"{mood}: " + " ".join(f"{s}:{v['bias'][:4]}" for s, v in views.items()), level="info")
        lessons = self.state.get("lessons", [])[-5:]
        pos_view = [{"symbol": s, "entry": r4(p.entry, 6), "price": r4(prices.get(s, p.entry), 6), "pnl_pct": r4((prices.get(s, p.entry) / p.entry - 1) * 100, 2), "stop": r4(p.stop, 6),
                     "bars_held": p.bars, "atr": r4(p.atr, 6), "thesis": p.thesis} for s, p in book.pos.items()]
        if picks or pos_view:
            st = self.ask("strategy", json.dumps({"picks": [{**c, "risk_check": checks.get(c["symbol"]), "sentiment": views.get(c["symbol"])} for c in self._cand_table(liquid, picks)],
                                                 "open_positions": pos_view, "market": ctx, "lessons_unverified_one_sample_each": lessons}))
            dec, posact = schemas.parse_strategy(st, pick_set, open_set)
            for s, d in dec.items():
                self.event("strategy", f"{s}: {d['action']} conviction {d['conviction']:.2f} stop {d['stop_atr']:.1f}xATR - {d['thesis']}", level="good" if d["action"] == "BUY" else "info")
            for s, a in posact.items():
                if a["action"] == "EXIT":
                    tr = book.exit_now(s, self._live(s, prices[s])["bid"], "desk_exit", now)
                    if tr:
                        self.event("execution", f"EXIT {s} P&L {tr['pnl']:+.2f} - {a['why']}", level="good" if tr["pnl"] > 0 else "bad")
                        self._review(tr)
                elif a["action"] == "TIGHTEN" and book.tighten(s, prices[s], a["stop_atr"]):
                    self.event("strategy", f"TIGHTEN {s} stop to {book.pos[s].stop:.6g} - {a['why']}")
        buys = [s for s in sorted(dec, key=lambda x: dec[x]["conviction"], reverse=True) if dec[s]["action"] == "BUY" and checks.get(s, {}).get("pass")]
        if not buys:
            return {"picks": picks, "bought": []}
        # rules engine computes the size BEFORE the Risk Manager agent speaks, so the agent can only scale it down
        planned = {}
        for s in buys:
            ok, why = book.can_enter(s, prices)
            pl = book.plan(s, live[s]["ask"], liquid[s]["atr"], dec[s]["stop_atr"], prices) if ok else None
            if pl:
                planned[s] = {"qty": pl[0], "notional": r4(pl[0] * live[s]["ask"], 2), "risk_usdt": r4(pl[2], 2), "stop": r4(pl[1], 6)}
            else:
                self.event("risk_manager", f"{s}: rules engine blocks the entry ({why if not ok else 'position too small'})", level="warn")
        if not planned:
            return {"picks": picks, "bought": []}
        ex = self.ask("execution", json.dumps({"approved_buys": [{"symbol": s, "atr_pct": r4(liquid[s]["atr"] / prices[s] * 100, 2), "spread_bps": live[s]["spread_bps"],
                                                                 "candle_rel_volume": r4(liquid[s]["rel_volume"], 2), "close_vs_48h_high_pct": r4((prices[s] / liquid[s]["prior_high"] - 1) * 100, 2)} for s in planned]}))
        orders = schemas.parse_execution(ex, set(planned))
        mg = self.ask("risk_manager", json.dumps({"portfolio": {"equity": r4(book.value(prices), 2), "cash": r4(book.cash, 2), "exposure_pct": r4(book.exposure(prices) * 100, 1),
                                                                "open_positions": pos_view, "day_start_equity": r4(book.rs.day_start_equity, 2), "peak_equity": r4(book.rs.peak_equity, 2)},
                                                  "proposed_buys": [{"symbol": s, **planned[s], "conviction": dec[s]["conviction"], "thesis": dec[s]["thesis"]} for s in planned], "market": ctx}))
        mgr, note = schemas.parse_manager(mg, set(planned))
        self.event("risk_manager", (note or "reviewed proposals") + " | " + " ".join(f"{s}:{('x%.2f' % m['size_multiplier']) if m['approve'] else 'VETO'}" for s, m in mgr.items()),
                   level="info")
        bought = []
        for s in planned:
            m, o = mgr[s], orders[s]
            if not m["approve"] or m["size_multiplier"] <= 0:
                continue
            res = self._enter(book, s, liquid[s], prices, now, dec[s]["stop_atr"], live[s]["ask"], m["size_multiplier"], dec[s]["conviction"], dec[s]["thesis"],
                              o["limit_offset_bps"] if o["type"] == "LIMIT" else 0.0)
            self.event("execution", f"{o['type']} {s}: {res}", level="good" if res.startswith(("bought", "limit")) else "warn")
            bought.append(f"{s}: {res}")
        return {"picks": picks, "bought": bought}

    def _review(self, tr: dict) -> None:
        rv = schemas.parse_reviewer(self.ask("reviewer", json.dumps({"closed_trade": {k: (r4(v, 4) if isinstance(v, float) else v) for k, v in tr.items() if k != "arm"}})))
        if rv["lesson"]:
            self.state.setdefault("lessons", []).append({"symbol": tr["symbol"], "pnl": r4(tr["pnl"], 2), "reason": tr["reason"], "conviction": tr["conviction"], **rv})
            self.state["lessons"] = self.state["lessons"][-30:]
            self.event("reviewer", f"{tr['symbol']}: {rv['lesson']}", level="info")
