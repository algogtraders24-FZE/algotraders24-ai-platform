"""Builds the licence-protected GoldBreakoutScalper v1.12 customer download.
  python build_goldbreakout_v112.py src  <lab v1.12 .mq5> <out dir>   -> <out dir>/GoldBreakoutScalper_v112_licensed.mq5 (to compile)
  python build_goldbreakout_v112.py zip  <compiled .ex5> <out zip>    -> deterministic zip: GoldBreakoutScalper.ex5 + README.txt
The trading logic is the lab build's; only the AT24 licence gate (one key = one trading account, only for this product) is added."""
import hashlib
import json
import os
import sys
import zipfile

mode = sys.argv[1]


def sub(text, old, new):
    if old not in text:
        raise SystemExit("pattern not found: " + old[:80])
    return text.replace(old, new, 1)


if mode == "src":
    src, out_dir = sys.argv[2:4]
    t = open(src, "rb").read().decode("utf-8-sig").replace("\r\n", "\n")
    t = sub(t, "#include <Trade\\Trade.mqh>", '''//--- AT24 licence gate: one key = one trading account, only for this product (the Strategy Tester needs no key)
#define AT24_PRODUCT_ID "GOLDBREAKOUTSCALPER"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = "";   // AT24 licence key (from your AT24 purchase page)

#include <Trade\\Trade.mqh>''')
    t = sub(t, "int OnInit()\n{\n", "int OnInit()\n{\n   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;\n")
    t = sub(t, "if(dashOn) { EventSetTimer(1); if(!Dash_Init()) dashOn = false; }", "EventSetTimer(1);\n   if(dashOn && !Dash_Init()) dashOn = false;")
    t = sub(t, "void OnTimer() { Dash_Update(); }", "void OnTimer() { AT24Gate_Timer(InpLicenseKey); Dash_Update(); }")
    t = sub(t, 'string BlockReason()                                         // "" = entries allowed\n{\n', 'string BlockReason()                                         // "" = entries allowed\n{\n   if(!AT24Gate_Allowed())          return "licence not valid";\n')
    t = sub(t, "   UpdateSpreadAverage();\n   ManagePositions();\n", "   UpdateSpreadAverage();\n   ManagePositions();                                       // open trades are always managed\n   if(!AT24Gate_Allowed())\n   {\n      if(CountPending() > 0) CancelAllPendingOrders();       // no valid licence: no new trades\n      return;\n   }\n")
    t = t.replace("GoldBreakoutScalper_v1.12", "GoldBreakoutScalper_v112_licensed")
    os.makedirs(out_dir, exist_ok=True)
    open(os.path.join(out_dir, "GoldBreakoutScalper_v112_licensed.mq5"), "wb").write(("﻿" + t.replace("\n", "\r\n")).encode("utf-8"))
    print("written source,", len(t), "chars")

elif mode == "zip":
    ex5, out = sys.argv[2:4]
    README = """AT24 Gold Breakout Scalper v1.12  -  Expert Advisor for XAUUSD (gold), MetaTrader 5
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES
  GoldBreakoutScalper.ex5   the Expert Advisor

LICENCE KEY (required)
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA to an XAUUSD chart (M5 or M1), Allow Algo Trading, paste the key into InpLicenseKey.
  One key works on ONE trading account at a time and only for this product. To move it: Dashboard > Purchases > this
  product > "Change trading account" (2 changes per 30 days). The EA checks the key at start and every 4 hours; if it is
  revoked or used on another account it stops opening NEW trades (open trades are still managed). A short internet
  outage never stops a running EA (72 hours of grace). The Strategy Tester needs no key.

WHAT IS NEW IN v1.12 (compared with the first release v1.00)
  * Works on the chart symbol only and only on gold (no symbol auto-detection).
  * Trading costs are part of the logic: spread, your broker's commission (InpCommissionPerLotUSD, ROUND TURN per lot) and
    a slippage allowance. Breakeven sits at entry + cost, the trailing stop never trails inside the cost, and no trade is
    taken when the ATR is too small compared with the cost (InpMinATRtoCost).
  * Real trend filter, stale pending orders are rebuilt every bar, entry session hours (server time), Friday and panic
    handling, stop-modification throttling and broker freeze/stops-level handling.
  * Lot size: LOT_FIXED (the lot you type) or LOT_AUTO (grows with the account and shrinks with it, 0.01 lot per 1000 by
    default), with a risk cap per trade (InpMaxRiskPercent, hard stop-loss based).
  * A chart dashboard (never shown in the Strategy Tester unless you switch it on).

IMPORTANT - READ BEFORE USING
  * v1.12 has NOT been validated by the marketplace evidence. The evidence on the listing belongs to the first release
    (v1.00). In the seller's own Strategy Tester runs on REAL ticks (XAUUSD M5, October 2026) the default settings were
    around break-even; a wider exit (InpSL_Points 800, InpBreakEven_Points 300, InpTrail_Points 300) did better in that
    one month, but one month proves nothing. Backtests on 1-minute OHLC data look far better than real ticks - use real
    ticks.
  * Set InpCommissionPerLotUSD to the REAL round-turn commission of your account (0 if there is none).
  * Start on a DEMO account with a small lot. Past performance is not a guarantee of future results. Trading leveraged
    products is risky; this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""
    files = [("GoldBreakoutScalper.ex5", open(ex5, "rb").read()), ("README.txt", README.replace("\n", "\r\n").encode("utf-8"))]
    manifest = {"version": "1.12", "files": {}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            zi = zipfile.ZipInfo(name, date_time=(2026, 10, 29, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
            manifest["files"][name] = hashlib.sha256(data).hexdigest()
    manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
    json.dump(manifest, open(out + ".manifest.json", "w"), indent=2)
    print(out, manifest["zipSha256"][:16])
