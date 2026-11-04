"""Builds the licence-protected Universal EA v7.03 customer download.
  python build_universalea_v703.py src  <lab v7.03 .mq5> <out dir>                    -> <out dir>/UniversalEA_v703_licensed.mq5 (to compile next to AT24_LicenseGate.mqh)
  python build_universalea_v703.py zip  <compiled .ex5> <report.xlsx> <out zip>       -> deterministic zip: UniversalEA.ex5 + UniversalEA_tested_settings.set + README.txt
The trading logic is the lab build's (the build the Strategy Tester report was produced with); only the AT24 licence gate
(one key = one trading account, only for this product; the Strategy Tester needs no key) is added."""
import hashlib
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
mode = sys.argv[1]


def sub(text, old, new):
    if old not in text:
        raise SystemExit("pattern not found: " + old[:80])
    return text.replace(old, new, 1)


if mode == "src":
    src, out_dir = sys.argv[2:4]
    t = open(src, "rb").read().decode("utf-8-sig").replace("\r\n", "\n")
    t = sub(t, "#include <Canvas/Canvas.mqh>", '''//--- AT24 licence gate: one key = one trading account, only for this product (the Strategy Tester needs no key)
#define AT24_PRODUCT_ID "UNIVERSALEA"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = "";   // AT24 licence key (from your AT24 purchase page)

#include <Canvas/Canvas.mqh>''')
    t = sub(t, "int OnInit()\n{\n", "int OnInit()\n{\n   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;\n   EventSetTimer(1);                                        // licence re-check every few hours (and the dashboard)\n")
    t = sub(t, "bool RiskAllowsNewOrders()\n{\n", "bool RiskAllowsNewOrders()\n{\n   if(!AT24Gate_Allowed()) return false;                    // no valid licence: no new trades and no reversals\n")
    t = sub(t, "   // STEP 3: Manage position SL (breakeven + trailing)\n   ApplyStopManagement();\n", "   // STEP 3: Manage position SL (breakeven + trailing)\n   ApplyStopManagement();\n   if(!AT24Gate_Allowed()) RemoveAllPendings();             // no valid licence: open trades are still managed, no pending orders stand\n")
    t = sub(t, "void OnTimer() { DrawDash(); }", "void OnTimer() { AT24Gate_Timer(InpLicenseKey); DrawDash(); }")
    t = t.replace("UniversalEA_v7.03", "UniversalEA_v703_licensed")
    os.makedirs(out_dir, exist_ok=True)
    open(os.path.join(out_dir, "UniversalEA_v703_licensed.mq5"), "wb").write(("﻿" + t.replace("\n", "\r\n")).encode("utf-8"))
    print("written source,", len(t), "chars")

elif mode == "zip":
    ex5, report, out = sys.argv[2:5]
    sys.path.insert(0, os.path.join(HERE, "..", "m2-evidence-engine"))
    import evidence_engine as e  # noqa: E402
    from pathlib import Path  # noqa: E402
    rows = e.read_mt5_xlsx_rows(Path(report))
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
    assert len(inputs) >= 30, len(inputs)
    set_txt = ("; Universal EA v7.03 - EXACT inputs of the Strategy Tester run the marketplace evidence is based on\r\n"
               "; (ICMarketsSC-Demo, XAUUSD, M5, 2025.09.01-2026.10.27, real ticks, 1,000 USD deposit, FIXED lot 0.05). Load via the EA's Inputs tab > Load.\r\n"
               "; LOT SIZE: 0.05 lot on a 1,000 USD account is a HIGH-risk setting (the reconstructed equity drawdown was about 71%). Scale the lot to YOUR account.\r\n"
               "; These are NOT the EA's defaults: the trend filter was ON (default OFF), break-even trigger 400 (default 300), trailing 300 (default 400), lot 0.05 (default 0.01).\r\n")
    set_txt += "".join("%s=%s\r\n" % kv for kv in inputs)
    README = open(os.path.join(HERE, "universalea_readme_template.txt"), encoding="utf-8").read()
    files = [
        ("UniversalEA.ex5", open(ex5, "rb").read()),
        ("UniversalEA_tested_settings.set", set_txt.encode("ascii", "replace")),
        ("README.txt", README.replace("\n", "\r\n").encode("utf-8")),
    ]
    manifest = {"version": "7.03", "files": {}}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            zi = zipfile.ZipInfo(name, date_time=(2026, 11, 4, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
            manifest["files"][name] = hashlib.sha256(data).hexdigest()
    manifest["zipSha256"] = hashlib.sha256(open(out, "rb").read()).hexdigest()
    json.dump(manifest, open(out + ".manifest.json", "w"), indent=2)
    print(out, manifest["zipSha256"][:16], "| inputs in .set:", len(inputs))
