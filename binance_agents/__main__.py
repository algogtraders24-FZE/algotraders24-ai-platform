"""CLI.  python -m binance_agents <command>

  download                    download / refresh the 1h candles (public data, no key)
  backtest [--no-halt]        the deterministic rules strategy over history, with the random-entry baseline
  desk [--once|--loop]        run the paper desk (Claude agents + rules arm + random arm) on live public data; PAPER ONLY.
                              --loop = a live tick every 15 s + a decision cycle after every closed 1h candle
  dashboard [--port 8800]     local read-only dashboard for the desk state
"""
from __future__ import annotations

import argparse
import dataclasses
import json
import sys
import time
import warnings
from datetime import datetime, timedelta, timezone

import numpy as np

warnings.filterwarnings("ignore")


def cmd_download(a):
    from .config import DEFAULT_UNIVERSE
    from .data import load_universe
    d = load_universe(DEFAULT_UNIVERSE, "1h", "2021-01-01")
    print(f"{len(d)} symbols ready")


def matched_random_prob(frames, cfg) -> float:
    from .features import compute_features
    p, sig, elig = cfg.params, 0, 0
    for df in frames.values():
        f = compute_features(df, p)
        ok = (f["quote_vol_24h"] >= p.min_quote_vol_24h) & f["trend_ok"].astype(bool) & f["atr"].notna()
        strat = ok & f["breakout"].astype(bool) & f["bullish"].astype(bool) & (f["rel_volume"] >= p.min_rel_volume)
        sig, elig = sig + int(strat.sum()), elig + int(ok.sum())
    return sig / elig if elig else 0.004


def cmd_backtest(a):
    from .backtest import buy_and_hold, run_backtest
    from .config import Config, DEFAULT_UNIVERSE, Risk
    from .data import load_universe
    cfg = Config()
    if a.no_halt:
        cfg = dataclasses.replace(cfg, risk=Risk(max_drawdown_halt=0.999))
    frames = load_universe(DEFAULT_UNIVERSE, "1h", "2021-01-01", verbose=False)
    windows = {"full": (a.start, a.end)} if (a.start or a.end) else {"full 2021-2026": (None, None), "2021-2023": ("2021-01-01", "2023-12-31"), "2024-now": ("2024-01-01", None)}
    for name, (s, e) in windows.items():
        r = run_backtest(frames, cfg, s, e)
        st = r.stats
        print(f"{name:16s} trades={st['trades']:4d} win%={st.get('win_rate_pct', 0):5.1f} PF={st.get('profit_factor', 0):5.2f} avgR={st.get('avg_r', 0):6.3f} "
              f"ret%={st['total_return_pct']:7.1f} maxDD%={st['max_drawdown_pct']:6.1f} halted={r.halted}  buy&hold={ {k: round(v) for k, v in buy_and_hold(frames, s, e).items()} }")
    if a.baseline:
        prob = matched_random_prob(frames, cfg)
        rs = [run_backtest(frames, cfg, None, None, random_entries=(prob, seed)) for seed in range(a.baseline)]
        pf = [r.stats.get("profit_factor", 0) for r in rs]
        print(f"random entries x{a.baseline} (p={prob:.5f}): trades~{np.mean([r.stats['trades'] for r in rs]):.0f} PF mean {np.mean(pf):.2f} [{min(pf):.2f}..{max(pf):.2f}] "
              f"avgR {np.mean([r.stats.get('avg_r', 0) for r in rs]):.3f}")


def cmd_desk(a):
    from .config import Config, DEFAULT_UNIVERSE
    from .data import load_universe
    from .desk.cycle import Desk
    from .desk.llm import FakeLLM, LLMClient
    cfg = Config()
    llm = FakeLLM() if a.fake else LLMClient(daily_budget_usd=a.budget)
    if a.reset:
        import shutil
        from .desk.cycle import STATE_DIR
        shutil.rmtree(STATE_DIR, ignore_errors=True)
    desk = Desk(cfg, llm)
    if not desk.state.get("random_prob"):
        frames = load_universe(DEFAULT_UNIVERSE, "1h", "2021-01-01", verbose=False)
        desk.state["random_prob"] = matched_random_prob(frames, cfg)
    desk.random_prob = desk.state["random_prob"]
    from .desk.dashboard import build_payload
    from .desk.live import build_live, write_live
    from .desk.push import ArenaPush
    push = ArenaPush.from_env()
    if push:
        print("pushing paper results to", push.url)
        if desk.state.get("last_bar"):
            print("initial push:", "ok" if push.full(build_payload(desk.dir)) else push.last_error)
    else:
        print("AT24_ARENA_TOKEN not set: results stay local (dashboard on this machine only)")

    def tick():
        live = build_live(desk)
        if live:
            write_live(desk, live)
            if push and not push.live(live):
                print(datetime.now(timezone.utc).strftime("%H:%M:%S"), "live push failed:", push.last_error)

    while True:
        if desk.cycle_due() or not a.loop:
            res = desk.run_cycle()
            print(datetime.now(timezone.utc).strftime("%H:%M:%S"), json.dumps(res, default=str)[:600], "| llm spend $%.4f" % llm.spent_today())
            if res.get("status") == "ok":
                if push:
                    print("push full:", "ok" if push.full(build_payload(desk.dir)) else push.last_error)
            else:
                desk.backoff(30)
        tick()
        if not a.loop:
            break
        time.sleep(15)


def cmd_dashboard(a):
    import uvicorn
    from .desk.dashboard import create_app
    print(f"dashboard on http://127.0.0.1:{a.port}  (read-only, local only)")
    uvicorn.run(create_app(), host="127.0.0.1", port=a.port, log_level="warning")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="binance_agents", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("download").set_defaults(fn=cmd_download)
    b = sub.add_parser("backtest")
    b.add_argument("--no-halt", action="store_true", help="disable the 20%% drawdown halt to see the raw edge over the whole sample")
    b.add_argument("--start")
    b.add_argument("--end")
    b.add_argument("--baseline", type=int, default=0, help="also run N random-entry baselines")
    b.set_defaults(fn=cmd_backtest)
    d = sub.add_parser("desk")
    d.add_argument("--once", action="store_true")
    d.add_argument("--loop", action="store_true")
    d.add_argument("--fake", action="store_true", help="offline stand-in for Claude (no API calls)")
    d.add_argument("--budget", type=float, default=3.0, help="daily Claude budget in USD (estimate)")
    d.add_argument("--reset", action="store_true", help="wipe the paper state and start again")
    d.set_defaults(fn=cmd_desk)
    s = sub.add_parser("dashboard")
    s.add_argument("--port", type=int, default=8800)
    s.set_defaults(fn=cmd_dashboard)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
