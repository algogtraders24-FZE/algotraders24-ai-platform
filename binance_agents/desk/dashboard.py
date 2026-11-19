"""Local dashboard (read-only): serves the desk state written by the runner. Binds to 127.0.0.1 only. Shows REAL paper numbers - nothing is mocked.
Run:  python -m binance_agents dashboard   ->  http://127.0.0.1:8800"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, JSONResponse

STATE_DIR = Path(__file__).resolve().parents[1] / "state"
HTML = Path(__file__).parent / "static" / "index.html"
TERMINAL = Path(__file__).parent / "static" / "terminal.html"
AGENT_ORDER = ["scout", "risk_checker", "sentiment", "strategy", "execution", "risk_manager", "reviewer"]


def _tail(path: Path, n: int) -> list[dict]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()[-n:]
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


def arm_stats(a: dict) -> dict:
    eq = [e[1] for e in a.get("equity", [])] or [a["initial"]]
    peak, dd = eq[0], 0.0
    for v in eq:
        peak = max(peak, v)
        dd = min(dd, v / peak - 1.0)
    t = a.get("trades", [])
    wins = [x for x in t if x["pnl"] > 0]
    losses = [x for x in t if x["pnl"] <= 0]
    gp, gl = sum(x["pnl"] for x in wins), -sum(x["pnl"] for x in losses)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    day_start = a["risk"].get("day_start_equity") or a["initial"]
    return {"equity": round(eq[-1], 2), "return_pct": round((eq[-1] / a["initial"] - 1) * 100, 2), "max_dd_pct": round(dd * 100, 2), "trades": len(t),
            "win_pct": round(100 * len(wins) / len(t), 1) if t else None, "profit_factor": round(gp / gl, 2) if gl > 0 else (None if not t else 99.0),
            "open": len(a.get("pos", {})), "day_pnl": round(eq[-1] - day_start, 2) if a["risk"].get("day") == today else 0.0, "halted": a["risk"].get("halted", False),
            "avg_r": round(sum(x["r"] for x in t) / len(t), 3) if t else None}


def merge_direct(p: dict, state_dir: Path) -> dict:
    """Add the 'Claude on Binance demo' arm, the demo account snapshot (balance, positions, open orders), its trades, activity and agent status."""
    d = state_dir / "direct"
    f = d / "direct_state.json"
    if not f.exists():
        return p
    try:
        ds = json.loads(f.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return p
    if ds.get("start_equity") is None:
        return p
    risk = ds.get("risk") or {}
    a = {"initial": ds["start_equity"], "equity": ds.get("equity", []), "trades": ds.get("trades", []), "pos": ds.get("positions", {}),
         "risk": {"day": risk.get("day"), "day_start_equity": risk.get("day_start_equity"), "halted": risk.get("halted", False)}}
    p["arms"]["demo"] = {"stats": arm_stats(a), "equity": a["equity"][-600:]}
    p["account"] = ds.get("account")
    p["demo_trades"] = list(reversed(ds.get("trades", [])[-12:]))
    p["activity"] = sorted(p.get("activity", []) + _tail(d / "activity.jsonl", 80), key=lambda x: x.get("ts", ""), reverse=True)[:100]
    dstate = d / "desk_state.json"
    if dstate.exists():
        try:
            dag = json.loads(dstate.read_text(encoding="utf-8")).get("agents", {})
            for x in p["agents"]:
                y = dag.get(x["name"])
                if y and (y.get("ts") or "") > (x.get("ts") or ""):
                    x.update({"text": y.get("text", ""), "level": y.get("level", "info"), "ts": y.get("ts")})
        except (OSError, ValueError):
            pass
    return p


def merge_live(p: dict, live: dict | None) -> dict:
    """Overlay the 15 s live tick (prices, marks, rolling volume) on the hourly snapshot; mirrors the website page's merge()."""
    if not live:
        return p
    ts = datetime.fromisoformat(live["ts"].replace("Z", "+00:00"))
    age = (datetime.now(timezone.utc) - ts).total_seconds()
    p["live_age"] = round(age)
    if age > 90:
        return p
    for k, a in p["arms"].items():
        lv = live["arms"].get(k)
        if lv:
            a["stats"].update({"equity": lv["equity"], "return_pct": lv["return_pct"], "day_pnl": lv["day_pnl"], "open": lv["open"]})
    pos = {x["symbol"]: x for x in live.get("positions", [])}
    for x in p["positions"]:
        if x["symbol"] in pos:
            x["price"], x["pnl_pct"] = pos[x["symbol"]]["price"], pos[x["symbol"]]["pnl_pct"]
    for r in p["radar"]:
        r["rel_volume"] = live["rel_live"].get(r["symbol"], r["rel_volume"])
        r["chg24"] = live["chg24"].get(r["symbol"], r["chg24"])
    main = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "LINKUSDT", "AVAXUSDT"]
    p["ticker"] = [{"symbol": s, "price": live["prices"][s], "chg24": live["chg24"].get(s)} for s in main if s in live["prices"]]
    if live.get("account"):
        p["account"] = live["account"]
    return p


def build_payload(state_dir: Path = STATE_DIR, with_live: bool = True) -> dict:
    f = state_dir / "desk_state.json"
    if not f.exists():
        return {"ready": False}
    s = json.loads(f.read_text(encoding="utf-8"))
    arms = s.get("arms", {})
    desk = arms.get("desk")
    last_prices = {x["symbol"]: x["price"] for x in s.get("ticker", [])}
    act = _tail(state_dir / "activity.jsonl", 80)
    payload = {
        "ready": True, "mode": "PAPER", "last_bar": s.get("last_bar"), "regime": {k: v for k, v in s.get("regime", {}).items() if k != "chg24"}, "ticker": s.get("ticker", []), "llm": s.get("llm", {}),
        "arms": {n: {"stats": arm_stats(a), "equity": a.get("equity", [])[-600:]} for n, a in arms.items()},
        "agents": [{"name": n, **s.get("agents", {}).get(n, {"text": "idle", "level": "info", "ts": None})} for n in AGENT_ORDER],
        "positions": [{**p, "price": last_prices.get(p["symbol"]), "pnl_pct": round((last_prices.get(p["symbol"], p["entry"]) / p["entry"] - 1) * 100, 2)} for p in (desk or {}).get("pos", {}).values()],
        "pending": (desk or {}).get("pending", []),
        "trades": list(reversed((desk or {}).get("trades", [])[-12:])),
        "activity": list(reversed(act)),
        "lessons": s.get("lessons", [])[-5:],
        "radar": s.get("radar", []),
        "live_age": None,
    }
    return merge_direct(payload, state_dir)


def create_app(state_dir: Path = STATE_DIR) -> FastAPI:
    app = FastAPI(title="Binance paper desk", docs_url=None, redoc_url=None)

    @app.get("/", response_class=HTMLResponse)
    def index():
        return HTMLResponse(HTML.read_text(encoding="utf-8"))

    @app.get("/terminal", response_class=HTMLResponse)
    def terminal():
        return HTMLResponse(TERMINAL.read_text(encoding="utf-8"))

    @app.get("/api/state")
    def state():
        payload = build_payload(state_dir)
        lf = state_dir / "live.json"
        if payload.get("ready") and lf.exists():
            try:
                payload = merge_live(payload, json.loads(lf.read_text(encoding="utf-8")))
            except (OSError, ValueError, KeyError):
                pass
        return JSONResponse(payload)

    return app
