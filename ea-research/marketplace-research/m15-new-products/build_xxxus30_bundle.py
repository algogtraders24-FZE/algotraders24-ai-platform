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
# The report lists InpUseONNX=true, but the Strategy Tester could not load the model file, so the AI filter did NOT run
# in the evidence run: the tested-settings file must say false to reproduce it.
inputs = [(k, 'false' if k == 'InpUseONNX' else v) for k, v in inputs]
set_txt = "; XXX US30 v%s - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n; (Exness US30, M15, 2025.07.01-2026.08.08). Load via the EA's Inputs tab > Load.\r\n; InpUseONNX is false on purpose: the report lists true, but the Strategy Tester could not find the model file, so the AI filter did not run.\r\n" % VERSION
set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)

README = """XXX US30 v1.01  -  Multi-module breakout EA for the Dow Jones (US30), M15
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  XXXUS30.ex5                    the Expert Advisor (the optional AI model is built in - no model files to copy)
  XXXUS30_tested_settings.set    the EXACT inputs of the backtest the marketplace evidence is based on
                                 (AI filter OFF - see below)

INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy XXXUS30.ex5 there (refresh the Navigator).
 2. Open a US30 chart on M15 and drag XXXUS30 onto it. Allow Algo Trading.
 3. Inputs tab > Load > XXXUS30_tested_settings.set to reproduce the tested configuration, then set InpFixedLot
    to a size that is right for your account (see below).

IMPORTANT - READ BEFORE USING
 * THE AI FILTER: the EA can score every setup with a small neural network (InpUseONNX). The model is built into
   the EA. The backtest the marketplace evidence is based on was run WITHOUT the AI filter (the tester could not
   load the model file), so the tested-settings file has InpUseONNX=false. The EA's built-in default is true.
   With it on the EA trades far less; that mode has not been backtested. Use the .set file to get the tested
   behaviour. The model was trained by the seller on the most recent 30,000 M15 bars at training time
   (5 Jun 2025 - 11 Sep 2026), so it has seen the period the backtest covers.
 * LOT SIZE: the backtest used a FIXED 1.0 lot on a 10,000 deposit. The EA's default is 0.01. Results scale with
   lot size and so does the risk. Note: US30 on Exness has a 0.05 minimum lot - adjust to your broker.
 * POINTS ARE BROKER POINTS: stop loss, take profit, breakeven, trailing and spread limits are in the symbol's
   POINTS. On Exness US30 (digits 1, point 0.1) 120 points = 12.0 index points. On a broker whose US30 has
   0 digits (point 1.0) the same numbers mean 120 index points - 10x wider. Re-scale before trading.
 * SYMBOL: tested on Exness "US30". Other brokers name it DJ30 / WS30 / US30.cash etc.
 * PENDING-ORDER BREAKOUT EA: BUY STOP / SELL STOP orders for up to 5 modules (Nova, Apex, Zenith, Pulse,
   Eclipse) at the same time; the tested run reached 11 simultaneous positions. Broker minimum stop distance,
   spread and slippage can change results materially.
 * Start on a DEMO account. Past performance is not a guarantee of future results. Trading leveraged
   products is risky; this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

files = [
    ("XXXUS30.ex5", open(os.path.join(SRC, "XXXUS30_embedded.ex5"), "rb").read()),
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
