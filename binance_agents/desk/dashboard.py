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


def build_payload(state_dir: Path = STATE_DIR) -> dict:
    f = state_dir / "desk_state.json"
    if not f.exists():
        return {"ready": False}
    s = json.loads(f.read_text(encoding="utf-8"))
    arms = s.get("arms", {})
    desk = arms.get("desk")
    last_prices = {x["symbol"]: x["price"] for x in s.get("ticker", [])}
    act = _tail(state_dir / "activity.jsonl", 80)
    return {
        "ready": True, "mode": "PAPER", "last_bar": s.get("last_bar"), "regime": {k: v for k, v in s.get("regime", {}).items() if k != "chg24"}, "ticker": s.get("ticker", []), "llm": s.get("llm", {}),
        "arms": {n: {"stats": arm_stats(a), "equity": a.get("equity", [])[-600:]} for n, a in arms.items()},
        "agents": [{"name": n, **s.get("agents", {}).get(n, {"text": "idle", "level": "info", "ts": None})} for n in AGENT_ORDER],
        "positions": [{**p, "price": last_prices.get(p["symbol"]), "pnl_pct": round((last_prices.get(p["symbol"], p["entry"]) / p["entry"] - 1) * 100, 2)} for p in (desk or {}).get("pos", {}).values()],
        "pending": (desk or {}).get("pending", []),
        "trades": list(reversed((desk or {}).get("trades", [])[-12:])),
        "activity": list(reversed(act)),
        "lessons": s.get("lessons", [])[-5:],
        "radar": s.get("radar", []),
    }


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
        return JSONResponse(build_payload(state_dir))

    return app
