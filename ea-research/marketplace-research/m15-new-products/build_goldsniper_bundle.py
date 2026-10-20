"""Builds the Gold Sniper customer download (deterministic zip): the licence-protected compiled EA, the EXACT input set of the backtest the
marketplace evidence is based on (parsed from the report's own Inputs block) and an install guide - same layout as the other AT24 products.
Usage: python build_goldsniper_bundle.py <licensed.ex5> <report.xlsx>"""
import hashlib
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "m2-evidence-engine"))
import evidence_engine as e  # noqa: E402
from pathlib import Path  # noqa: E402

ex5_path, report_path = sys.argv[1:3]
VERSION = "1.00"

rows = e.read_mt5_xlsx_rows(Path(report_path))
inputs = []
on = False
for r in rows:
    cells = [c for c in r if c != ""]
    if not cells:
        continue
    first = cells[0]
    if first.startswith("Inputs:"):
        on = True
        cells = cells[1:]
        if not cells:
            continue
        first = cells[0]
    if on:
        if first.startswith("Company:"):
            break
        if first.startswith("==="):
            continue
        m = re.match(r"^(\w+)=(.*)$", first.strip())
        if m:
            inputs.append((m.group(1), m.group(2)))
assert len(inputs) >= 45, len(inputs)

set_txt = ("; Gold Sniper v%s - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n"
           "; (Exness XAUUSD, M1, 2025.01.01-2026.10.09, fixed 1.0 lot, 100,000 USD deposit). Load via the EA's Inputs tab > Load.\r\n"
           "; LOT SIZE: this run used FixedLot=1 (= 100 oz). Change FixedLot to a size that is right for YOUR account before trading live.\r\n"
           "; PIPS: PipSize=0.01, so StopLossPips=5000 means a 50.00 USD price move and TakeProfitPips=20000 a 200.00 USD move.\r\n") % VERSION
set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)

README = """Gold Sniper v1.00  -  XAUUSD M1 pending-stop trend-continuation EA for MetaTrader 5
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  GoldSniper.ex5                    the Expert Advisor
  GoldSniper_tested_settings.set    the EXACT inputs of the backtest the marketplace evidence is based on

LICENCE KEY (required)
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA, open the Inputs tab, load the settings file (Load > GoldSniper_tested_settings.set), THEN paste the key into
     InpLicenseKey (loading a settings file afterwards would not remove it, but paste it last to be safe).
  One key works on ONE trading account at a time (and only for this product). Moving to another broker/account or VPS:
  Dashboard > Purchases > this product > "Change trading account" (2 changes per 30 days), then run the EA there.
  The EA checks the key when it starts and every 4 hours. If the key is revoked, belongs to another product or is
  used on another account, the EA stops placing NEW orders; positions that are already open are still managed.
  A short internet outage never stops a running EA (72 hours of grace).
  The Strategy Tester needs no key, so you can still backtest the EA.

INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy GoldSniper.ex5 there (refresh the Navigator).
 2. Open an XAUUSD chart (any timeframe - the EA works on M1 bars internally) and drag GoldSniper onto it. Allow Algo Trading.
 3. Inputs tab > Load > GoldSniper_tested_settings.set to reproduce the tested configuration, paste your licence key, then set
    FixedLot to a size that is right for your account (see below).

HOW IT TRADES
  Only inside the London and New York sessions (hours in BROKER SERVER time, inputs LondonStartHour...NewYorkEndHour), with an
  acceptable spread. After each closed M1 bar it needs an M5 EMA(50) trend (price on the right side of a rising/falling EMA) and a fresh
  3-candle fair value gap of at least 8 pips (0.08 USD) in the same direction. It then places ONE buy-stop / sell-stop just beyond the last 5 M1
  bars' high/low (30 points buffer, cancelled after 3 minutes), with a fixed pip stop loss and take profit. One position or pending
  order at a time, 30 seconds cooldown. Exits: break-even and a fixed-distance trailing stop, checked on every tick.
  Optional filters in the code (CVD pressure proxy, entropy/volatility regime, tick order-flow) were OFF in the tested run.

IMPORTANT - READ BEFORE USING
 * THE TESTED SETTINGS DIFFER FROM THE EA DEFAULTS: the backtest used StopLossPips=5000, TakeProfitPips=20000, BreakEvenTriggerPips=10000,
   BreakEvenLockPips=9000, TrailingStopPips=3000, TrailingStepPips=1000, UseRiskLot=false, FixedLot=1 and the CVD / regime / order-flow
   filters OFF. The EA's built-in defaults are different (for example StopLossPips=50, TakeProfitPips=100, risk-based lot, all filters ON).
   Use the .set file to get the tested behaviour; other settings have NOT been backtested.
 * "PIPS" ARE 0.01 PRICE UNITS (PipSize=0.01): StopLossPips=5000 is a 50.00 USD move, TakeProfitPips=20000 a 200.00 USD move,
   break-even trigger 10000 = 100.00 USD. On XAUUSD one lot is 100 ounces, so a 50.00 USD stop at 1.0 lot is about 5,000 USD of risk.
 * LOT SIZE: the backtest used a FIXED 1.0 lot on a 100,000 USD deposit (about 5 percent risk per stop-out). Results, drawdown and risk scale
   with lot size. For a 10,000 USD account the same risk is about 0.1 lot; for 1,000 USD about 0.01 lot. Choose your own size.
 * DRAWDOWN: the tester report prints a balance drawdown of 25.85 percent (66,245 on closed trades, 100,000 start) and an EQUITY
   drawdown of 100 percent. AT24 could not rebuild an intraday equity curve for the whole test period (real candle data was missing
   for about 7 of the 21 months), so intraday drawdown is NOT independently verified. Treat the 100 percent figure as unexplained and
   expect intraday drawdowns of at least the closed-trade level.
 * HISTORY QUALITY of the tested run was 43 percent real ticks; spread model is not disclosed by the report. Pending-order EAs on gold are
   sensitive to spread, slippage and stop level around news; the largest single loss in the test (about 11,056 USD) was more than twice the
   5,000 USD that a 50.00 USD stop at 1.0 lot implies - the report does not say why (slippage or a price gap is the usual cause).
 * SERVER TIME: session hours are BROKER SERVER time. The test ran on Exness; check your own broker's server-time offset and adjust the hours.
 * SYMBOL: tested on Exness "XAUUSD". Other brokers name it XAUUSD.m / GOLD / XAUUSDm etc.; check PipSize and digits.
 * Start on a DEMO account. Past performance is not a guarantee of future results. Trading leveraged products is risky;
   this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

files = [
    ("GoldSniper.ex5", open(ex5_path, "rb").read()),
    ("GoldSniper_tested_settings.set", set_txt.encode("ascii", "replace")),
    ("README.txt", README.replace("\n", "\r\n").encode("utf-8")),
]
out = os.path.join(HERE, "source", "GoldSniper_v%s.zip" % VERSION)
manifest = {"version": VERSION, "files": {}}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in files:
        zi = zipfile.ZipInfo(name, date_time=(2026, 10, 20, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, data)
        manifest["files"][name] = hashlib.sha256(data).hexdigest()
manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
open(out + ".manifest.json", "w").write(json.dumps(manifest, indent=2))
print("built", out, manifest["zipSha256"][:16], "| inputs in .set:", len(inputs))
