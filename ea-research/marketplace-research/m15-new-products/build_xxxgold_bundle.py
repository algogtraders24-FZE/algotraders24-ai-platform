"""Builds the XXX GOLD customer download (deterministic zip): the compiled EA, the two ONNX files the EA loads from
MQL5\Files, the EXACT input set used in the backtest (parsed from the report's own Inputs block) and an install guide.
Usage: python build_xxxgold_bundle.py <hdr-dump.txt>   (hdr dump = first rows of the report's Settings block)"""
import sys, os, zipfile, hashlib, json, re
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source")
VERSION = "3.02"

lines = open(sys.argv[1], encoding="utf-8", errors="replace").read().splitlines()
inputs = []
on = False
for l in lines:
    if l.startswith("Inputs: |"):
        on = True
        continue
    if on:
        if l.startswith("Company:"):
            break
        if l.startswith("==="):
            continue
        m = re.match(r"^(Inp\w+)=(.*)$", l.strip())
        if m:
            inputs.append((m.group(1), m.group(2)))
assert len(inputs) >= 40, len(inputs)
set_txt = "; XXX GOLD v%s - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n; (Exness XAUUSD, M15, 2025.01.01-2026.08.08). Load via the EA's Inputs tab > Load.\r\n" % VERSION
set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)

README = """XXX GOLD v3.02  -  Multi-module breakout EA for Gold (XAUUSD), M15
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  XXXGOLD.ex5                    the Expert Advisor
  XXXGOLD_tested_settings.set    the EXACT inputs of the backtest the marketplace evidence is based on

INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy XXXGOLD.ex5 there (refresh the Navigator).
 2. Open an XAUUSD chart on M15 and drag XXXGOLD onto it. Allow Algo Trading.
 3. Inputs tab > Load > XXXGOLD_tested_settings.set to reproduce the tested configuration, then set the lot
    inputs to a size that is right for your account (see below).

IMPORTANT - READ BEFORE USING
 * THE TESTED SETTINGS DIFFER FROM THE EA DEFAULTS. The backtest ran with auto-lot-growth ON (InpAutoLotGrowth),
   a lot cap of 0.10 (InpMaxLot), the daily-loss limit ON and a break-even trigger of 12 pips. The EA's built-in
   defaults are growth OFF, no cap, daily-loss limit OFF, trigger 10 pips, fixed lot 0.01.
 * THE TESTED RUN TRADED 0.10 LOT THROUGHOUT: with growth on and a 10,000 deposit the lot is at its 0.10 cap from
   the first trade. Profit and drawdown scale with lot size - on a small account 0.10 lot on gold is a large risk.
 * AUTO-LOT GROWTH raises the lot by InpAutoLotStepSize for every InpAutoLotBalanceStep of balance above
   InpAutoLotBaseBalance, up to InpMaxLot. Keep InpMaxLot at a level you can afford.
 * PIPS: the stop loss, take profit, break-even and trailing inputs are in the EA's own "pip" units for gold (see the
   input names, e.g. InpGoldPipStopLoss=20). Check how that maps to price on YOUR broker's XAUUSD digits.
 * THE REPORT'S UNITS: the tester report this evidence comes from prints its currency as "profit in pips". The
   marketplace shows the report's figures exactly as the report states them; check the money value of a trade
   on your own broker/account before relying on any figure.
 * SYMBOL: tested on Exness "XAUUSD". Other brokers name it XAUUSD.m / GOLD etc.; check contract size, minimum
   lot and spread (the spread shield uses points - InpMaxSpreadPoints).
 * PENDING-ORDER BREAKOUT EA: BUY STOP / SELL STOP orders for up to 5 modules (Nova, Apex, Zenith, Pulse,
   Eclipse) at the same time; the tested run reached 9 simultaneous positions. Broker minimum stop distance,
   spread and slippage can change results a lot at this trade frequency.
 * The tester run used only 37% real ticks. Start on a DEMO account.
 * Past performance is not a guarantee of future results. Trading leveraged products is risky; this is not
   financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

files = [
    ("XXXGOLD.ex5", open(os.path.join(SRC, "XXXGOLD_seller_build.ex5"), "rb").read()),
    ("XXXGOLD_tested_settings.set", set_txt.encode("ascii", "replace")),
    ("README.txt", README.replace("\n", "\r\n").encode("utf-8")),
]
out = os.path.join(SRC, "XXXGOLD_v%s.zip" % VERSION)
manifest = {"version": VERSION, "files": {}}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in files:
        zi = zipfile.ZipInfo(name, date_time=(2026, 10, 8, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, data)
        manifest["files"][name] = hashlib.sha256(data).hexdigest()
manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
json.dump(manifest, open(out + ".manifest.json", "w"), indent=2)
print(out, manifest["zipSha256"], "inputs parsed:", len(inputs))
