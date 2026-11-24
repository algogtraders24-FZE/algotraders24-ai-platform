"""Make licensed website copies of the MT5 utilities Trade Manager and Prop Firm Guard (adds the AT24 licence gate)."""
import os, shutil, subprocess, time, re
FI = "E:/algotraders24-ai-platform/ea-research/lab/FreeIndicators"
U = "E:/algotraders24-ai-platform/ea-research/lab/MQL5Market/utilities"
TPL = FI + "/AT24_AutoFib_Wrap_v1"
ED = "C:/Program Files/MetaTrader 5/metaeditor64.exe"; B = chr(92)
def make(short, d, pid, patches):
    W = "%s/AT24_%s_Wrap_v1" % (FI, short); os.makedirs(W, exist_ok=True)
    for f in ("AT24_License.mqh", "AT24_LicenseGate.mqh"): shutil.copy(TPL + "/" + f, W + "/" + f)
    s = open("%s/%s/%s.mq5" % (U, d, d), encoding="utf-8").read().replace("\r\n", "\n")
    s = s.replace('#include <Trade/Trade.mqh>', '#define AT24_PRODUCT_ID "%s"\n#include "AT24_LicenseGate.mqh"\n#include <Trade/Trade.mqh>\n\ninput string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)' % pid, 1)
    for old, new in patches:
        assert old in s, old
        s = s.replace(old, new, 1)
    out = "%s/%s_Licensed.mq5" % (W, d)
    open(out, "w", encoding="utf-8", newline="\n").write(s)
    subprocess.run([ED, "/compile:" + out.replace("/", B), "/log:" + (W + "/ea.log").replace("/", B)]); time.sleep(4)
    t = open(W + "/ea.log", encoding="utf-16", errors="replace").read()
    print(short, [l for l in t.split("\n") if "Result" in l or "error" in l.lower()][:3], os.path.exists(out.replace(".mq5", ".ex5")))
make("TradeManager", "AT24_Trade_Manager", "AT24-TRADE-MANAGER", [
    ("int OnInit()\n  {\n", "int OnInit()\n  {\n   if(!AT24Gate_Init(InpLicenseKey))\n      return INIT_FAILED;\n"),
    ("   if(gDayLock || gDDLock) { Say(\"Locked: no new orders\"); return; }", "   if(!AT24Gate_Allowed()) { Say(\"Licence check failed: no new orders\"); return; }\n   if(gDayLock || gDDLock) { Say(\"Locked: no new orders\"); return; }"),
    ("void OnTimer() { Cycle();", "void OnTimer() { AT24Gate_Timer(InpLicenseKey); Cycle();"),
])
make("PropGuard", "AT24_Prop_Firm_Guard", "AT24-PROP-FIRM-GUARD", [
    ("int OnInit()\n  {\n", "int OnInit()\n  {\n   if(!AT24Gate_Init(InpLicenseKey))\n      return INIT_FAILED;\n"),
    ("void OnTimer()\n  {\n   Cycle();", "void OnTimer()\n  {\n   AT24Gate_Timer(InpLicenseKey);   // the guard keeps watching the account even if the licence check fails later\n   Cycle();"),
])
make("BasketCloser", "AT24_Basket_Closer", "AT24-BASKET-CLOSER", [
    ("int OnInit()\n  {\n", "int OnInit()\n  {\n   if(!AT24Gate_Init(InpLicenseKey))\n      return INIT_FAILED;\n"),
    ("void OnTimer()\n  {\n", "void OnTimer()\n  {\n   AT24Gate_Timer(InpLicenseKey);   // closing is never blocked\n"),
])
