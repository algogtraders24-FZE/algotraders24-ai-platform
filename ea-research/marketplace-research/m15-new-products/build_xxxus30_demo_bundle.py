"""Builds the XXX US30 30-DAY DEMO customer download: the compiled demo EA + a short README. NO settings file (the demo EA has almost no inputs
and nothing that describes how it trades). Deterministic zip.
Usage: python build_xxxus30_demo_bundle.py <XXXUS30_demo.ex5> <out_zip>"""
import hashlib
import json
import sys
import zipfile

ex5_path, out = sys.argv[1:3]
VERSION = "1.03"

README = """XXX US30 - 30-day DEMO  (v1.03)  -  Expert Advisor for MetaTrader 5
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

THIS IS A DEMO. Run it on a DEMO account only. It is a free 30-day trial of the same product that is sold on the AT24 marketplace.

FILES
  XXXUS30_demo.ex5     the Expert Advisor (no settings file - the EA has only a few inputs)

INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy XXXUS30_demo.ex5 there, then refresh the Navigator.
 2. Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add  https://www.algotraders24.ai
 3. Open a US30 / Dow Jones 30 chart of your DEMO broker (M15 is fine) and drag XXXUS30_demo onto it. Allow Algo Trading.
 4. In the Inputs tab paste your licence key into InpLicenseKey (your AT24 dashboard > Purchases > this product > "Your licence key").
 5. Choose the lot size (see below), press OK.

YOUR LICENCE
  The key works for 30 days and on ONE trading account. When it expires the EA stops opening new trades; trades that are already open are still
  managed. A short internet outage never stops a running EA.
  The EA needs the AT24 licence check to start - it will not start without internet access to algotraders24.ai.

LOT SIZE - IMPORTANT
  Start small. The demo is meant to show you the behaviour, not to chase profit.
  InpSizingMode 1 (default) sizes every trade as a percentage of your balance (InpRiskPercent, default 0.5).
  InpSizingMode 0 uses the fixed lot in InpFixedLot (default 0.10).
  US30 contracts differ between brokers: check how many US dollars one point is worth for one lot at YOUR broker before you choose a lot.

WHAT TO EXPECT - READ THIS
 * Results vary. Deep drawdowns and long losing stretches can happen, and the win rate is low: many small losses are normal, and a few larger
   winners make up the result. Judge the demo over the whole 30 days, not by one good or bad day.
 * 30 days is a short sample. A good or a bad month does not prove anything about the next one.
 * Demo is not live: spread, slippage, commission and execution on a real account are different, so real results can be worse. This build refuses
   real accounts on purpose.
 * Past results do not predict future results. Trading leveraged products is risky; this is not financial advice.

DEMO CONTEST (optional)
 * Keep InpMagicNumber at its default (33302): the contest counts only trades with that number.
 * Connect your demo account to AT24 Live Sync (free) and enter on the contest page of the AT24 website: algotraders24.ai/contest
 * Top 3 results win a 3-month licence; everyone who enters gets 20 percent off the full product. Ranking is by profit % inside daily-loss and
   max-loss limits, not by lot size. Rules and the leaderboard are on the contest page.

TIPS
 * Let it run for the whole 30 days without changing the settings, and keep your demo balance and lot constant so you can judge it fairly.
 * Optional: connect your demo account to AT24 Live Sync (free) to see your own results page - Dashboard > Live Sync.
 * The EA works on its own timeframe internally; do not run two copies on the same account with the same magic number.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

files = [("XXXUS30_demo.ex5", open(ex5_path, "rb").read()), ("README.txt", README.replace("\n", "\r\n").encode("utf-8"))]
manifest = {"version": VERSION, "files": {}}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in files:
        zi = zipfile.ZipInfo(name, date_time=(2026, 10, 21, 0, 0, 0))
        zi.compress_type = zipfile.ZIP_DEFLATED
        zi.external_attr = 0o644 << 16
        z.writestr(zi, data)
        manifest["files"][name] = hashlib.sha256(data).hexdigest()
manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
open(out + ".manifest.json", "w").write(json.dumps(manifest, indent=2))
print("built", out, manifest["zipSha256"][:16])
