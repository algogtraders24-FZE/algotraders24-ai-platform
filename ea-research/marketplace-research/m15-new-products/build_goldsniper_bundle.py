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

set_txt = (
           "; Gold Sniper v%s - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n"
           "; (Exness XAUUSD, M1, 2025.01.01-2026.10.09, risk-based lot 2 percent, 100,000 USD deposit). Load via the EA's Inputs tab > Load.\r\n"
           "; LOT SIZE: this run used UseRiskLot=true with RiskPercent=2 (high risk, compounding). Lower RiskPercent to a level that is right for YOUR account.\r\n"
           "; PIPS: PipSize=0.01, so StopLossPips=5000 means a 50.00 USD price move and TakeProfitPips=11000 a 110.00 USD move.\r\n"
           "; EXITS: UsePipsForTrailing=false, so break-even / trailing use the POINT inputs (BreakEvenStartPoints etc.) - tested on a 2-digit gold quote.\r\n" % VERSION)
set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)

README = open(os.path.join(HERE, "goldsniper_readme_template.txt"), encoding="utf-8").read()

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
