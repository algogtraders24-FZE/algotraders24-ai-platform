"""Builds the XXX US30 customer download (deterministic zip): the compiled EA, the two ONNX files the EA loads from
MQL5\Files, the EXACT input set used in the backtest (parsed from the report's own Inputs block) and an install guide.
Usage: python build_xxxus30_bundle.py <hdr-dump.txt>   (hdr dump = first rows of the report's Settings block)"""
import sys, os, zipfile, hashlib, json, re
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source")
VERSION = "1.01"

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
set_txt = "; XXX US30 v%s - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n; (Exness US30, M15, 2025.07.01-2026.08.08). Load via the EA's Inputs tab > Load.\r\n" % VERSION
set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)

README = """XXX US30 v1.01  -  Multi-module breakout EA for the Dow Jones (US30), M15
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  XXXUS30.ex5                    the Expert Advisor
  xxxus30_filter.onnx            AI entry filter model (loaded by the EA)
  xxxus30_filter.onnx.data       the model's weights file - must sit next to the .onnx
  XXXUS30_tested_settings.set    the EXACT inputs of the backtest the marketplace evidence is based on

INSTALL (5 minutes)
 1. MetaTrader 5: File > Open Data Folder.
 2. Copy XXXUS30.ex5 into MQL5\Experts   (refresh the Navigator or restart the terminal).
 3. Copy BOTH xxxus30_filter.onnx and xxxus30_filter.onnx.data into MQL5\Files.
    If the EA cannot find them it prints "AI DISABLED (fail-safe mode)" and trades WITHOUT the AI filter -
    check the Experts log and the dashboard ("AI: READY").
 4. Open a US30 chart on M15 and drag XXXUS30 onto it. Allow Algo Trading.
 5. Inputs tab > Load > XXXUS30_tested_settings.set to reproduce the tested configuration, then lower
    InpFixedLot to a size that is right for your account (see below).

IMPORTANT - READ BEFORE USING
 * LOT SIZE: the backtest used a FIXED 1.0 lot (InpFixedLot=1) on a 10,000 deposit. The EA's built-in
   default is 0.01. Results scale with lot size and so does the risk. Do not copy the tested lot size
   unless your account can carry it.
 * POINTS ARE BROKER POINTS: stop loss, take profit, breakeven, trailing and spread limits are in the symbol's
   POINTS. On Exness US30 (digits 1, point 0.1) 120 points = 12.0 index points. On a broker whose US30 has
   0 digits (point 1.0) the same numbers mean 120 index points - 10x wider. Re-scale the point inputs
   to your broker before trading.
 * SYMBOL: tested on Exness "US30". Other brokers name it DJ30 / WS30 / US30.cash etc. Attach to your broker's
   Dow Jones symbol and check the contract size - USD per point differs between brokers.
 * PENDING-ORDER BREAKOUT EA: it places BUY STOP / SELL STOP orders. Broker minimum stop distance, spread and
   slippage at news time can change results materially.
 * Up to 5 modules (Nova, Apex, Zenith, Pulse, Eclipse) can have orders open at the same time - the tested
   run reached 11 simultaneous positions.
 * The AI filter is a model trained by the seller on US30 M15 data. Its training window is not disclosed.
 * Start on a DEMO account. Past performance is not a guarantee of future results. Trading leveraged
   products is risky; this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

files = [
    ("XXXUS30.ex5", open(os.path.join(SRC, "XXXUS30.ex5"), "rb").read()),
    ("xxxus30_filter.onnx", open(os.path.join(SRC, "xxxus30_filter.onnx"), "rb").read()),
    ("xxxus30_filter.onnx.data", open(os.path.join(SRC, "xxxus30_filter.onnx.data"), "rb").read()),
    ("XXXUS30_tested_settings.set", set_txt.encode("ascii", "replace")),
    ("README.txt", README.replace("\n", "\r\n").encode("utf-8")),
]
out = os.path.join(SRC, "XXXUS30_v%s.zip" % VERSION)
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
