"""Builds the v1.14 customer sources of XXX US30 from the lab build (ea-research/lab/XXXUS30_Index_v1.14):
  XXXUS30_v114_licensed.mq5  - paid build: v1.14 + AT24 licence gate (one key = one account), model embedded plain (as v1.03 did)
  XXXUS30_v114_demo.mq5      - 30-day demo build: only lot/protection/magic/dashboard are inputs, everything else is const,
                               module names become M1..M3, the ONNX model is embedded ENCRYPTED (key from the licence check), demo accounts only.
Trading logic is not touched; only the licence/vault hooks and the Inputs tab change.
Usage: python build_xxxus30_v114.py <lab_v114.mq5> <out_dir>"""
import re
import sys
from pathlib import Path

lab_src, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
base = lab_src.read_bytes().decode("utf-8-sig").replace("\r\r\n", "\n").replace("\r\n", "\n")


def sub(text, old, new, count=1):
    if old not in text:
        raise SystemExit("pattern not found: " + old[:90])
    return text.replace(old, new, count)


def write(name, text):
    (out_dir / name).write_bytes(("﻿" + text.replace("\n", "\r\n")).encode("utf-8"))
    print("written", out_dir / name, len(text))


def with_gate(text, build_id=None):
    s = text
    gate = '//--- AT24 licence gate: one key = one trading account, only for this product (Strategy Tester needs no key)\n#define AT24_PRODUCT_ID "XXXUS30"\n'
    if build_id:
        gate += f'#define AT24_BUILD_ID "{build_id}"\n#define AT24_WANT_MODEL_KEY\n'
    gate += '#include "AT24_LicenseGate.mqh"\n'
    if build_id:
        gate += '#include "AT24_ModelVault.mqh"\n'
    gate += 'input string InpLicenseKey = ""; // AT24 licence key (from your AT24 purchase page)\n\n'
    s = sub(s, "#include <Trade\\Trade.mqh>", gate + "#include <Trade\\Trade.mqh>")
    s = sub(s, "int OnInit()\n  {\n", "int OnInit()\n  {\n   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;\n   EventSetTimer(1);\n")
    s = sub(s, "void OnTimer()\n  {\n   if(!g_dashOn) return;", "void OnTimer()\n  {\n   AT24Gate_Timer(InpLicenseKey);\n   if(!g_dashOn) return;")
    s = sub(s, "bool isBlocked = g_isPaused || IsWeekendBlocked()", "bool isBlocked = g_isPaused || !AT24Gate_Allowed() || IsWeekendBlocked()")
    return s


# ------------------------------------------------------------------ licensed
lic = with_gate(base)
lic = sub(lic, '#resource "\\\\Files\\\\xxxus30_filter.onnx" as uchar g_EmbeddedModel[]', '#resource "xxxus30_filter_embedded.onnx" as uchar g_EmbeddedModel[]')
write("XXXUS30_v114_licensed.mq5", lic)

# ------------------------------------------------------------------ demo
s = with_gate(base, "demo")
s = sub(s, '#resource "\\\\Files\\\\xxxus30_filter.onnx" as uchar g_EmbeddedModel[]', '#resource "xxxus30_filter.bin" as uchar g_EncModel[]')
head_end = s.index("//--- AT24 licence gate")
s = ('//+------------------------------------------------------------------+\n//|                                                XXXUS30_demo.mq5  |\n'
     '//|                        Copyright algotraders24.ai                  |\n//|                        XXX US30 - 30-day demo build                |\n'
     '//+------------------------------------------------------------------+\n#property copyright "Copyright algotraders24.ai - All Rights Reserved"\n'
     '#property version   "1.14"\n#property description "XXX US30 - Powered by ALGOTRADERS24 AI"\n#property description "US30 Expert Advisor - 30-day demo build"\n\n'
     + s[head_end:])

lines = s.split("\n")
i0 = next(i for i, l in enumerate(lines) if l.startswith('input group "=== LOT SIZE ==="'))
i1 = next(i for i, l in enumerate(lines) if l.startswith("input bool   InpDashInTester"))
pat = re.compile(r"^input\s+(\S+)\s+(\w+)\s*=\s*([^;]+);")
decl = [(m.group(1), m.group(2), m.group(3).strip()) for m in (pat.match(l) for l in lines[i0:i1 + 1]) if m]
VISIBLE = ["InpSizingMode", "InpFixedLot", "InpRiskPercent", "InpMaxLot", "InpPropFirmMode", "InpPropFirmMaxDrawdown", "InpPropFirmProfitTarget",
           "InpDailyLossLimitEnabled", "InpMaxDailyLossPercent", "InpMagicNumber", "InpShowDashboard"]
vals = {n: (t, v) for t, n, v in decl}
assert set(VISIBLE) <= set(vals), set(VISIBLE) - set(vals)
demo_default = {"InpSizingMode": "SIZE_RISK", "InpFixedLot": "0.10", "InpRiskPercent": "0.5", "InpMaxLot": "0.0"}
comments = {"InpSizingMode": "FIXED lot or RISK % of balance", "InpFixedLot": "lot size when sizing mode is FIXED",
            "InpRiskPercent": "risk per trade in % of balance when sizing mode is RISK", "InpMaxLot": "largest lot allowed (0 = no cap)",
            "InpPropFirmMode": "stop trading when the drawdown or profit target below is reached", "InpPropFirmMaxDrawdown": "max drawdown in %",
            "InpPropFirmProfitTarget": "profit target in %", "InpDailyLossLimitEnabled": "pause for the day after the loss below",
            "InpMaxDailyLossPercent": "daily loss limit in %", "InpMagicNumber": "magic number of this EA", "InpShowDashboard": "show the panel on the chart"}


def inp(n):
    t, v = vals[n]
    return f"input {t} {n} = {demo_default.get(n, v)}; // {comments[n]}"


nb = ['input group "=== LOT SIZE ==="'] + [inp(n) for n in VISIBLE[:4]]
nb += ["", 'input group "=== PROTECTION ==="'] + [inp(n) for n in VISIBLE[4:9]]
nb += ["", 'input group "=== GENERAL ==="'] + [inp(n) for n in VISIBLE[9:]]
nb += ["", "//--- fixed internal settings (not user inputs)"]
for t, n, v in decl:
    if n in VISIBLE:
        continue
    if n == "InpONNXFile":
        v = '""'
    nb.append(f"const {t} {n} = {v};")
lines[i0:i1 + 1] = nb
s = "\n".join(lines)

# model: encrypted resource + key from the licence check
a = s.index("      onnx_handle = OnnxCreateFromBuffer(g_EmbeddedModel, ONNX_DEFAULT);")
b = s.index("      if(onnx_handle == INVALID_HANDLE)\n        {\n         g_ai_status = 2;")
s = s[:a] + """      string modelKey = AT24Gate_ModelKey();   // not available in the Strategy Tester: the filter is off there
      if(modelKey != "")
        {
         uchar plainModel[];
         if(AT24Vault_Decrypt(g_EncModel, modelKey, plainModel))
           {
            onnx_handle = OnnxCreateFromBuffer(plainModel, ONNX_DEFAULT);
            AT24Vault_Wipe(plainModel);
           }
        }
""" + s[b:]

# demo accounts only, refused BEFORE a licence slot is used
s = sub(s, "   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;", """   if(!AT24Gate_IsTester() && AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_REAL)
     {
      Print("This is the 30-day DEMO build - it runs on demo accounts only.");
      Alert("XXX US30 demo: this build runs on demo accounts only. Open a demo account to use it.");
      return INIT_FAILED;
     }
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;""")

# neutral names / log lines
s = sub(s, 'const string MOD_NAME[3] = {"Nova", "Apex", "Zenith"};', 'const string MOD_NAME[3] = {"M1", "M2", "M3"};')
s = re.sub(r'Print\("[^;\n]*(?:ONNX|AI DISABLED)[^;\n]*\);', 'Print("Protected filter status updated");', s)
s = s.replace("XXX US30 v1.14", "XXX US30 demo").replace("| v1.14 |", "| demo |")
# dashboard text: no indicator / model details in the demo
s = sub(s, '"  |  ATR " + DoubleToString(atr, 1)', '"  |  VOL " + DoubleToString(atr, 1)')
s = sub(s, 'ts = "EMA gap +" + DoubleToString((fast - slow), 1) + " pts"', 'ts = "trend gap +" + DoubleToString((fast - slow), 1) + " pts"')
s = sub(s, 'ts = "EMA gap " + DoubleToString((fast - slow), 1) + " pts"', 'ts = "trend gap " + DoubleToString((fast - slow), 1) + " pts"')
s = sub(s, 'av = "AI OFF"; as = "not used"', 'av = "FILTER OFF"; as = "not used"')
s = sub(s, '"NO MODEL" : "AI FAILED"; as = InpRequireAI ? "trading blocked" : "trades without AI"', '"NO FILTER" : "FILTER OFF"; as = InpRequireAI ? "trading blocked" : "fail-safe mode"')
s = sub(s, 'av = "B " + DoubleToString(g_aiBuy, 2) + "  S " + DoubleToString(g_aiSell, 2); as = "need " + DoubleToString(InpAIScoreThreshold, 2);', 'av = ok ? "PASS" : "WAIT"; as = "filter active";')
s = sub(s, '"GATE 2 | AI SCORE"', '"GATE 2 | FILTER"')
s = sub(s, '// "Nova", "Apex" ... of an open position (for the dashboard)', '// module label of an open position (for the dashboard)')
write("XXXUS30_v114_demo.mq5", s)

leaks = sorted(set(re.findall(r'"[^"\n]*(?:ONNX|onnx|AI |Nova|Apex|Zenith|MoonLock|EMA|Fractal|RSI|ATR|reakout|momentum|Momentum)[^"\n]*"', s)))
print("demo strings still mentioning logic words (review):")
for x in leaks:
    print("  ", x.encode("ascii", "replace").decode())
