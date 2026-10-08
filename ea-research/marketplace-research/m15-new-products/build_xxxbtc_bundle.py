"""Builds the XXX BTC customer download (deterministic zip): the compiled EA, the two ONNX files the EA loads from
MQL5\\Files, the EXACT input set used in the backtest (parsed from the report's own Inputs block) and an install guide.
Usage: python build_xxxbtc_bundle.py <hdr-dump.txt>   (hdr dump = first rows of the report's Settings block)"""
import sys, os, zipfile, hashlib, json, re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source")
VERSION = "1.00"

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
set_txt = "; XXX BTC v%s - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n; (Exness BTCUSD, M15, 2025.01.01-2026.08.08). Load via the EA's Inputs tab > Load.\r\n" % VERSION
set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)

README = """XXX BTC v1.00  -  Multi-module 24/7 breakout EA for Bitcoin (BTCUSD), M15
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  XXXBTC.ex5                     the Expert Advisor
  xxxbtc_filter.onnx             AI entry filter model (loaded by the EA when InpUseONNX=true)
  xxxbtc_filter.onnx.data        the model's weights file - must sit next to the .onnx
  XXXBTC_tested_settings.set     the EXACT inputs of the backtest the marketplace evidence is based on

INSTALL (5 minutes)
 1. MetaTrader 5: File > Open Data Folder.
 2. Copy XXXBTC.ex5 into MQL5\\Experts   (refresh the Navigator or restart the terminal).
 3. Copy BOTH xxxbtc_filter.onnx and xxxbtc_filter.onnx.data into MQL5\\Files.
    If the EA cannot find them it prints "AI DISABLED (fail-safe)" and trades WITHOUT the AI filter.
 4. Open a BTCUSD chart on M15 and drag XXXBTC onto it. Allow Algo Trading.
 5. Inputs tab > Load > XXXBTC_tested_settings.set to reproduce the tested configuration, then choose a lot
    size that is right for your account (see below).

IMPORTANT - READ BEFORE USING
 * THE TESTED SETTINGS DIFFER FROM THE EA DEFAULTS: the backtest ran with the H1 trend filter (InpUseMTFTrend)
   OFF and the ONNX AI filter (InpUseONNX) ON. The EA's built-in defaults are the opposite (trend filter ON,
   ONNX OFF, lot 0.01). Load the .set file to get the tested behaviour.
 * LOT SIZE: the backtest used a FIXED 0.10 lot on a 10,000 deposit. Results and risk scale with lot size.
 * BROKER POINTS: stop loss, take profit, breakeven, trailing, breakout buffer and spread limit are in the symbol's
   POINTS. On Exness BTCUSD (2 decimals, point 0.01) the default 1000-point stop loss is a 10.00 price move and
   the 3000-point take profit is a 30.00 price move. Re-scale the point inputs to your broker before trading.
 * THE REPORT'S UNITS: the tester report this evidence comes from prints its currency as "profit in pips". The
   marketplace shows the report's figures exactly as the report states them; check the money value of a trade
   on your own broker/account before relying on any figure.
 * SYMBOL: tested on Exness "BTCUSD". Other brokers name it BTCUSD.m / BTCUSDm / BTCUSD# etc.; check contract
   size and minimum lot.
 * PENDING-ORDER BREAKOUT EA: it places BUY STOP / SELL STOP orders for up to 5 modules (Nova, Apex, Zenith,
   Pulse, Eclipse) at the same time. Broker minimum stop distance, spread and slippage can change results a lot.
 * The AI filter is a model supplied by the seller. Its training data and window are not disclosed.
 * The tester run used only 37% real ticks; several of its statistics (very high Sharpe, near-zero drawdown) are
   far outside what live trading produces. Start on a DEMO account.
 * Past performance is not a guarantee of future results. Trading leveraged products is risky; this is not
   financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

files = [
    ("XXXBTC.ex5", open(os.path.join(SRC, "XXXBTC.ex5"), "rb").read()),
    ("xxxbtc_filter.onnx", open(os.path.join(SRC, "xxxbtc_filter.onnx"), "rb").read()),
    ("xxxbtc_filter.onnx.data", open(os.path.join(SRC, "xxxbtc_filter.onnx.data"), "rb").read()),
    ("XXXBTC_tested_settings.set", set_txt.encode("ascii", "replace")),
    ("README.txt", README.replace("\n", "\r\n").encode("utf-8")),
]
out = os.path.join(SRC, "XXXBTC_v%s.zip" % VERSION)
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
