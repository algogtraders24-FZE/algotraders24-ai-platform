"""Builds the licence-protected customer zip (EA + README, same layout and README licence block as the other AT24 products) for each
catalog EA patched by patch_licensed.py.
Usage: python build_catalog_bundles.py <dir with the compiled <name>_licensed.ex5 files> <out dir>"""
import hashlib
import json
import os
import re
import sys
import zipfile

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "source")
compiled_dir, out_dir = sys.argv[1:3]
os.makedirs(out_dir, exist_ok=True)

# source file stem -> (title shown to buyers, symbol note)
PRODUCTS = {
    "AXON_24": ("AXON 24", "the symbol it is made for (see the listing)"),
    "AXON_PRO_26": ("AXON PRO 26", "the symbol it is made for (see the listing)"),
    "GLOBAL_COMMODITY_MATRIX": ("Global Commodity Matrix", "the commodity symbol it is made for (see the listing)"),
    "NEXUSMINING_EXPLORATION_ALGO": ("Nexusmining Exploration Algo", "the symbol it is made for (see the listing)"),
    "QUANTUMTECH_NAS": ("QuantumTech NAS", "the index symbol it is made for (see the listing)"),
    "QUANTUM_GOLD_AI": ("Quantum Gold AI", "XAUUSD / gold (see the listing)"),
    "QUANTUM_INDEX_ENGINE": ("Quantum Index Engine", "the index symbol it is made for (see the listing)"),
    "QUANTUM_WALLSTREET_PRO": ("Quantum WallStreet Pro", "the index symbol it is made for (see the listing)"),
    "QuantumPulse_BTC": ("QuantumPulse BTC", "BTCUSD (see the listing)"),
    "SILVER_MINING_ALGO": ("Silver Mining Algo", "XAGUSD / silver (see the listing)"),
}

LICENCE = """LICENCE KEY (required since v{v})
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA, open the Inputs tab and paste the key into  InpLicenseKey.
  One key works on ONE trading account at a time (and only for this product). Moving to another broker/account or VPS:
  Dashboard > Purchases > this product > "Change trading account" (2 changes per 30 days), then run the EA there.
  The EA checks the key when it starts and every 4 hours. If the key is revoked, belongs to another product or is
  used on another account, the EA stops opening NEW trades; trades that are already open are still managed.
  A short internet outage never stops a running EA (72 hours of grace).
  The Strategy Tester needs no key, so you can still backtest the EA.
  (Older versions used a separate account + expiry key from the seller; that key is no longer used.)

"""

README = """{title} v{v}
=================================================================
Algotraders24 AI  |  https://www.algotraders24.ai

FILES IN THIS DOWNLOAD
  {ex5}     the Expert Advisor

{licence}INSTALL (3 minutes)
 1. MetaTrader 5: File > Open Data Folder > MQL5 > Experts: copy {ex5} there (refresh the Navigator).
 2. Open a chart of {symbols} and drag {name} onto it. Allow Algo Trading.
 3. Inputs tab > paste your licence key into InpLicenseKey, then set the lot size / risk that is right for your account.

IMPORTANT - READ BEFORE USING
 * Start on a DEMO account. Past performance is not a guarantee of future results. Trading leveraged
   products is risky; this is not financial advice.
 * Broker, symbol names, spread and execution differ between brokers and change results. Check the symbol and the
   point-based inputs on your own broker before trading.
 * Everything the marketplace shows about this product is described on its listing page.

SUPPORT: https://www.algotraders24.ai  (dashboard > Support)
"""

for stem, (title, symbols) in PRODUCTS.items():
    src = open(os.path.join(SRC, stem + "_licensed.mq5"), encoding="utf-8", errors="replace").read()
    version = re.search(r'#property version\s+"([\d.]+)"', src).group(1)
    ex5_name = stem + ".ex5"
    ex5 = open(os.path.join(compiled_dir, stem + "_licensed.ex5"), "rb").read()
    readme = README.format(title=title, v=version, ex5=ex5_name, name=stem, symbols=symbols, licence=LICENCE.format(v=version))
    files = [(ex5_name, ex5), ("README.txt", readme.replace("\n", "\r\n").encode("utf-8"))]
    out = os.path.join(out_dir, "%s_v%s.zip" % (stem, version))
    manifest = {"version": version, "files": {}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            zi = zipfile.ZipInfo(name, date_time=(2026, 10, 18, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
            manifest["files"][name] = hashlib.sha256(data).hexdigest()
    manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
    open(out + ".manifest.json", "w").write(json.dumps(manifest, indent=2))
    print("built", os.path.basename(out), "v" + version, manifest["zipSha256"][:12])
