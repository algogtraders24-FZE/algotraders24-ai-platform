"""Builds the v1.14 customer zips (deterministic): paid XXXUS30_v1.14.zip and 30-day demo XXXUS30_demo_v1.14.zip.
Usage: python build_xxxus30_v114_bundles.py   (expects source/XXXUS30_v114_licensed.ex5 and source/XXXUS30_v114_demo.ex5)"""
import hashlib, json, os, zipfile
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "source")

LIC = """XXX US30 v1.14  -  Breakout EA for the Dow Jones (US30), M15
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES
  XXXUS30.ex5   the Expert Advisor (the optional AI filter model is built in - no model files to copy)

LICENCE KEY
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add  https://www.algotraders24.ai
  2. Attach the EA to a US30 M15 chart, Allow Algo Trading, paste the key into InpLicenseKey.
  One key works on ONE trading account at a time and only for this product. To move it: Dashboard > Purchases > this product >
  "Change trading account". The EA checks the key at start and every 4 hours; if it is revoked or used elsewhere it stops opening NEW
  trades (open trades are still managed). A short internet outage never stops a running EA. The Strategy Tester needs no key.

WHAT CHANGED IN v1.14
  Three modules (Nova, Apex, Zenith), exactly one order or position per module, new dashboard panel, AI model works in the
  Strategy Tester too. The earlier Pulse and Eclipse modules were removed.

READ THIS
 * v1.14 has NOT been validated by the marketplace evidence. The evidence shown on the listing belongs to the earlier v1.03 build
   (5 modules). The seller's own real-tick tests of the 3-module logic were not profitable; use a DEMO account first.
 * Defaults: fixed lot 0.01, stop 1200 / target 4000 points, M15. Points are broker points - check your broker's US30 digits.
 * Past performance is not a guarantee of future results. Trading leveraged products is risky; this is not financial advice.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

DEMO = """XXX US30 - 30-day DEMO  (v1.14)  -  Expert Advisor for MetaTrader 5
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

THIS IS A DEMO. Run it on a DEMO account only. It is a free 30-day trial of the product sold on the AT24 marketplace.

INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy XXXUS30_demo.ex5 there, refresh the Navigator.
 2. Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add  https://www.algotraders24.ai
 3. Open a US30 chart of your DEMO broker (M15) and drag XXXUS30_demo onto it. Allow Algo Trading.
 4. Paste your licence key into InpLicenseKey (dashboard > Purchases > this product > "Your licence key"), choose the lot size, OK.

LICENCE: 30 days, ONE trading account. After that the EA stops opening new trades (open trades are still managed). It needs internet
access to algotraders24.ai to start.

LOT SIZE: InpSizingMode RISK (default) risks InpRiskPercent (0.5) of the balance per trade; FIXED uses InpFixedLot. Check what one point is
worth at YOUR broker before choosing. Start small.

WHAT TO EXPECT
 * Results vary; losing stretches happen. 30 days is a short sample and proves nothing about the next month.
 * Demo is not live: spread, slippage and execution differ on a real account. This build refuses real accounts on purpose.
 * Past results do not predict future results. Trading leveraged products is risky; this is not financial advice.

DEMO CONTEST (optional): keep InpMagicNumber at 33302, connect the demo account to AT24 Live Sync (free) and enter on
algotraders24.ai/contest. Rules and leaderboard are on the contest page.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

def build(out_name, ex5_src, ex5_name, readme, version):
    files = [(ex5_name, open(os.path.join(SRC, ex5_src), "rb").read()), ("README.txt", readme.replace("\n", "\r\n").encode("utf-8"))]
    out = os.path.join(SRC, out_name)
    man = {"version": version, "files": {}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for n, d in files:
            zi = zipfile.ZipInfo(n, date_time=(2026, 10, 27, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
            z.writestr(zi, d); man["files"][n] = hashlib.sha256(d).hexdigest()
    man["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
    json.dump(man, open(out + ".manifest.json", "w"), indent=2)
    print(out_name, man["zipSha256"][:16])

build("XXXUS30_v1.14.zip", "XXXUS30_v114_licensed.ex5", "XXXUS30.ex5", LIC, "1.14")
build("XXXUS30_demo_v1.14.zip", "XXXUS30_v114_demo.ex5", "XXXUS30_demo.ex5", DEMO, "1.14")
