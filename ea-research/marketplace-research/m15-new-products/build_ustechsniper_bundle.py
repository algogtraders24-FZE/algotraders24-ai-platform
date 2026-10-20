"""Builds the USTECH Index Sniper customer download (deterministic zip): the licence-protected compiled EA, the EXACT input set of the
backtest the marketplace evidence is based on (parsed from the report's own Inputs block) and an install guide.
Usage: python build_ustechsniper_bundle.py <licensed.ex5> <report.html>"""
import hashlib
import json
import os
import re
import sys
import zipfile

ex5_path, report_path = sys.argv[1:3]
HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = "1.00"

raw = open(report_path, "rb").read(600000)
text = raw.decode("utf-16", errors="ignore") if raw[:2] in (b"\xff\xfe", b"\xfe\xff") else raw.decode("utf-8", errors="ignore")
text = re.sub(r"<[^>]+>", "\n", text)
lines = [l.strip() for l in text.split("\n") if l.strip()]
start = next(i for i, l in enumerate(lines) if l.startswith("Inputs:") or l == "Inputs:")
inputs = []
for l in lines[start + 1:]:
    if l.startswith("Company:"):
        break
    m = re.match(r"^(\w+)=(.*)$", l)
    if m:
        inputs.append((m.group(1), m.group(2)))
assert len(inputs) >= 45, len(inputs)
names = {k for k, _ in inputs}
assert {"RiskPercent", "StopLossPips", "TakeProfitPips", "UsePipsForTrailing"} <= names

set_txt = ("; USTECH Index Sniper v%s - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n"
           "; (Exness demo server, symbol USTEC_x100, M1, 2025.01.01-2026.10.09, 100,000 USD deposit, risk-based lot 2%%).\r\n"
           "; Load via the EA's Inputs tab > Load.\r\n"
           "; RISK: RiskPercent=2 per trade. This is the tested value - it is NOT a recommendation. Lower it (the EA default is 0.5) for live use.\r\n"
           "; PIPS: PipSize=0.01, so StopLossPips=5000 means a 50.00 price-unit move and TakeProfitPips=11000 a 110.00 move.\r\n"
           "; The run used UsePipsForTrailing=false, so the point-based break-even / trailing inputs further down are the ones that were active.\r\n") % VERSION
set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)

README = """USTECH Index Sniper v1.00  -  US Tech index M1 pending-stop trend-continuation EA for MetaTrader 5
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  USTECHIndexSniper.ex5                    the Expert Advisor
  USTECHIndexSniper_tested_settings.set    the EXACT inputs of the backtest the marketplace evidence is based on

LICENCE KEY (required)
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA, open the Inputs tab, load the settings file (Load > USTECHIndexSniper_tested_settings.set), THEN paste the key into
     InpLicenseKey (loading a settings file afterwards would not remove it, but paste it last to be safe).
  One key works on ONE trading account at a time (and only for this product). Moving to another broker/account or VPS:
  Dashboard > Purchases > this product > "Change trading account" (2 changes per 30 days), then run the EA there.
  The EA checks the key when it starts and every 4 hours. If the key is revoked, belongs to another product or is
  used on another account, the EA stops placing NEW orders; positions that are already open are still managed.
  A short internet outage never stops a running EA (72 hours of grace).
  The Strategy Tester needs no key, so you can still backtest the EA.

INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy USTECHIndexSniper.ex5 there (refresh the Navigator).
 2. Open a chart of your broker's US Tech 100 / Nasdaq index symbol (USTEC, NAS100, US100 ... the name differs by broker; any timeframe - the EA
    works on M1 bars internally) and drag USTECHIndexSniper onto it. Allow Algo Trading.
 3. Inputs tab > Load > USTECHIndexSniper_tested_settings.set to reproduce the tested configuration, paste your licence key, then LOWER
    RiskPercent to a level you can afford (see below).

HOW IT TRADES
  Only inside the London and New York sessions (hours in BROKER SERVER time, inputs LondonStartHour...NewYorkEndHour), with an
  acceptable spread. After each closed M1 bar it needs an M5 EMA(50) trend (price on the right side of a rising/falling EMA) and a fresh
  3-candle fair value gap of at least 8 pips (0.08 price units) in the same direction. It then places ONE buy-stop / sell-stop just beyond
  the last 5 M1 bars' high/low (30 points buffer, cancelled after 3 minutes), with a fixed pip stop loss and take profit. One position or
  pending order at a time, 30 seconds cooldown. Exits: break-even and trailing, checked on every tick.
  Optional filters in the code (CVD pressure proxy, entropy/volatility regime, tick order-flow) were OFF in the tested run.

IMPORTANT - READ BEFORE USING
 * THE TESTED SETTINGS DIFFER FROM THE EA DEFAULTS: the backtest used UseRiskLot=true with RiskPercent=2, StopLossPips=5000,
   TakeProfitPips=11000, UsePipsForTrailing=false (so the POINT-based break-even / trailing inputs were active: break-even after 100 points of
   profit locking 20 points, fixed trailing after 100 points at a distance of 10 pips with a 20-point step) and the CVD / regime / order-flow
   filters OFF. The EA's built-in defaults are different (RiskPercent=0.5, StopLossPips=50, TakeProfitPips=100, pip-based trailing, all
   filters ON). Use the .set file to get the tested behaviour; other settings have NOT been backtested.
 * "PIPS" ARE 0.01 PRICE UNITS (PipSize=0.01): StopLossPips=5000 is a 50.00 price-unit move (50 index points) and TakeProfitPips=11000 a
   110.00 move. Check your broker's digits for the index symbol before relying on pip-based inputs.
 * THE TEST RAN ON THE EXNESS SYMBOL "USTEC_x100" (Exness demo server Exness-MT5Trial8, Zero-account index group "Idx_Enlarge"): a contract size of 100 and a
   maximum of 20 lots. In that run one lot earned or lost 100 USD per index point (checked on the first trade: 0.4 lot, +5.19 points = +207.60 USD),
   far more than a normal index CFD, and the deals show a commission instead of a spread. Other brokers and account types use different index contracts
   (often 1 per point), so the lot sizes, profits and drawdowns in the report cannot be copied to them; only the risk-based sizing (a % of equity per
   trade) carries over, and spread, slippage, commission and lot limits will differ.
 * COMPOUNDING: the tested lot size grew with the account, from 0.4 lot to 20.0 lots (the largest lot of the run). The headline tester profit
   (+36.7 million on 100,000) is the result of that compounding on the USTEC_x100 symbol. It is NOT an expectation for a live account.
 * PROFIT TIMING: the test's profit came in June-December 2025 (+40.8 million); January-September 2026 was net NEGATIVE (-4.1 million) with
   6 losing months out of 9. Recent behaviour of the tested settings is weaker than the headline.
 * WIN/LOSS SHAPE: about 94.6 percent of trades were net winners (the report prints 97.4 percent before commission) but the average losing
   trade was about 8 times the average winner, and the largest single loss was about 731,000 USD. A few losers can erase many wins.
 * DRAWDOWN: the tester prints a balance drawdown of 11.28 percent but also an EQUITY drawdown of 100 percent, which AT24 could not reproduce or explain.
   AT24 rebuilt the intraday equity curve from real Exness 15-minute candles of USTEC_x100 pulled from an Exness demo terminal (29,280 bars covering the whole
   test period, the only gaps are market holidays): maximum drawdown 11.46 percent, the longest drawdown about 250 days (equity was below its late-2025 peak for
   62 percent of the period and has not recovered it). A 15-minute curve cannot see price swings inside a trade shorter than one bar (the average trade lasts about
   3 minutes), so real intratrade drawdown can be larger.
 * HISTORY QUALITY of the tested run was 43 percent real ticks; the spread model is not disclosed by the report.
 * SERVER TIME: session hours are BROKER SERVER time. Check your own broker's server-time offset and adjust the hours.
 * Start on a DEMO account with a small risk setting. Past performance is not a guarantee of future results. Trading leveraged
   products is risky; this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

files = [
    ("USTECHIndexSniper.ex5", open(ex5_path, "rb").read()),
    ("USTECHIndexSniper_tested_settings.set", set_txt.encode("ascii", "replace")),
    ("README.txt", README.replace("\n", "\r\n").encode("utf-8")),
]
out = os.path.join(HERE, "source", "USTECHIndexSniper_v%s.zip" % VERSION)
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
