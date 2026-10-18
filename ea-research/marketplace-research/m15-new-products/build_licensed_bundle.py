"""Builds the licence-protected customer download of an existing XXX product: takes the previous release zip (tested-settings file
and README stay), swaps in the newly compiled licensed .ex5 and adds the licence-key instructions to the README. Deterministic zip.

Usage: python build_licensed_bundle.py <old_zip> <licensed.ex5> <new_version> <ex5_name_in_zip> <out_zip>
  e.g. python build_licensed_bundle.py source/XXXUS30_v1.01.zip source/XXXUS30_licensed.ex5 1.02 XXXUS30.ex5 source/XXXUS30_v1.02.zip
"""
import hashlib
import json
import re
import sys
import zipfile

old_zip, new_ex5, version, ex5_name, out = sys.argv[1:6]
old_version = re.search(r"_v(\d+\.\d+)\.zip$", old_zip).group(1)

LICENCE_BLOCK = """LICENCE KEY (required since v{v})
  Your key is on your AT24 purchase page (Dashboard > Purchases > this product > "Your licence key").
  1. MetaTrader 5: Tools > Options > Expert Advisors > tick "Allow WebRequest for listed URL" and add
        https://www.algotraders24.ai
  2. Attach the EA, open the Inputs tab, load the settings file (Load > ..._tested_settings.set), THEN paste the key into
     InpLicenseKey (loading a settings file afterwards would not remove it, but paste it last to be safe).
  One key works on ONE trading account at a time (and only for this product). Moving to another broker/account or VPS:
  Dashboard > Purchases > this product > "Change trading account" (2 changes per 30 days), then run the EA there.
  The EA checks the key when it starts and every 4 hours. If the key is revoked, belongs to another product or is
  used on another account, the EA stops opening NEW trades and removes its pending orders; trades that are already
  open are still managed. A short internet outage never stops a running EA (72 hours of grace).
  The Strategy Tester needs no key, so you can still backtest the EA.

"""

zin = zipfile.ZipFile(old_zip)
names = zin.namelist()
set_name = next(n for n in names if n.endswith(".set"))
readme_name = next(n for n in names if n.lower().endswith("readme.txt"))
readme = zin.read(readme_name).decode("utf-8").replace("\r\n", "\n")
readme = readme.replace("v%s" % old_version, "v%s" % version)
assert "FILES IN THIS DOWNLOAD" in readme and "INSTALL (3 minutes)" in readme
readme = readme.replace("INSTALL (3 minutes)", LICENCE_BLOCK.format(v=version) + "INSTALL (3 minutes)", 1)

files = [
    (ex5_name, open(new_ex5, "rb").read()),
    (set_name, zin.read(set_name)),
    ("README.txt", readme.replace("\n", "\r\n").encode("utf-8")),
]
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
print("built", out, manifest["zipSha256"][:16])
