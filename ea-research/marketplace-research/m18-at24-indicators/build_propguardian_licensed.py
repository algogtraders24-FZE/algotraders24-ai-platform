"""Builds the licence-protected AT24 Prop Guardian v1.01 (a protection EA: it places no trades of its own).
  python build_propguardian_licensed.py src <indicators/AT24_Prop_Guardian/mt5 dir> <out dir>   -> <out dir>/AT24_PropGuardian_Licensed.mq5 (+ core and logo copied; compile next to AT24_LicenseGate.mqh)
The logic is the peer's v1.01; only the AT24 licence gate is added (one key = one account = one product; the Strategy Tester needs no key)."""
import os
import shutil
import sys


def sub(text, old, new):
    if old not in text:
        raise SystemExit("pattern not found: " + old[:80])
    return text.replace(old, new, 1)


mode, src_dir, out_dir = sys.argv[1:4]
if mode != "src":
    raise SystemExit("only 'src'")
t = open(os.path.join(src_dir, "AT24_Prop_Guardian.mq5"), "rb").read().decode("utf-8-sig").replace("\r\n", "\n")
t = sub(t, "#include <Trade\\Trade.mqh>", '''//--- AT24 licence gate: one key = one trading account, only for this product (the Strategy Tester needs no key)
#define AT24_PRODUCT_ID "AT24-PROP-GUARDIAN"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = "";   // AT24 licence key (from your AT24 purchase page)

#include <Trade\\Trade.mqh>''')
t = sub(t, "int OnInit()\n  {\n", "int OnInit()\n  {\n   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;\n")
t = sub(t, "void OnTimer() { if(!gTester) Evaluate(); }", "void OnTimer() { AT24Gate_Timer(InpLicenseKey); if(!gTester) Evaluate(); }")
t = sub(t, "void Evaluate()\n  {\n", "void Evaluate()\n  {\n   if(!AT24Gate_Allowed()) return;                          // no valid licence: the guardian is OFF (the gate says why)\n")
os.makedirs(out_dir, exist_ok=True)
open(os.path.join(out_dir, "AT24_PropGuardian_Licensed.mq5"), "wb").write(("﻿" + t.replace("\n", "\r\n")).encode("utf-8"))
for f in ("AT24_PropGuard_Core.mqh", "gd_logo56.bmp"):
    shutil.copy(os.path.join(src_dir, f), os.path.join(out_dir, f))
print("written", os.path.join(out_dir, "AT24_PropGuardian_Licensed.mq5"))
