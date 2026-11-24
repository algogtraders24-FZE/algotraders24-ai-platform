"""Licensed utility EA wrapper (MT5) for an indicator, from the AutoFib template. Also handles separate-window indicators.
usage: python wrap_gen2.py <Short> <SrcDir> <IndicatorBase> <PRODUCT-ID> "<Title>" "<one-line description>" <main|sub>
SrcDir holds the indicator .mq5 + .mqh + .bmp (MT5 sources, link-free is fine)."""
import os, shutil, sys, subprocess, time
short, src, ind, pid, title, desc, mode = sys.argv[1:8]
FI = "E:/algotraders24-ai-platform/ea-research/lab/FreeIndicators"
TPL = FI + "/AT24_AutoFib_Wrap_v1"
TERM = "C:/Users/om/AppData/Roaming/MetaQuotes/Terminal/D0E8209F77C8CF37AD8BF550E51FF075/MQL5/Indicators/AT24Lab/" + short
W = FI + "/AT24_%s_Wrap_v1" % short
shutil.rmtree(TERM, ignore_errors=True); os.makedirs(TERM)
for f in os.listdir(src):
    if f.endswith((".mqh", ".bmp")) or f == ind + ".mq5":
        shutil.copy(src + "/" + f, TERM + "/" + f)
os.makedirs(W, exist_ok=True)
for f in ["AT24_License.mqh", "AT24_LicenseGate.mqh"]:
    shutil.copy(TPL + "/" + f, W + "/" + f)
s = open(TPL + "/AT24_AutoFib_Licensed.mq5", encoding="utf-8").read()
s = (s.replace("AT24_AutoFib_Licensed", "AT24_%s_Licensed" % short).replace("AT24-AUTO-FIB-ZONES", pid)
      .replace("AT24_Auto_Fib_Zones", ind).replace("AutoFib", short).replace("Auto Fib Zones", title))
out = []
for ln in s.split("\n"):
    if ln.startswith('#property description "AT24 ' + title + ' - '):
        ln = '#property description "AT24 %s - %s"' % (title, desc)
    out.append(ln)
s = "\n".join(out)
if mode == "sub":
    s = s.replace("int win = 0;                                                  // this indicator draws on the main chart window",
                  "int win = (int)ChartGetInteger(0, CHART_WINDOWS_TOTAL);       // this indicator draws in its own sub-window")
    assert "CHART_WINDOWS_TOTAL" in s
open(W + "/AT24_%s_Licensed.mq5" % short, "w", encoding="utf-8", newline="\n").write(s)
ED = "C:/Program Files/MetaTrader 5/metaeditor64.exe"
B = chr(92)
subprocess.run([ED, "/compile:" + (TERM + "/" + ind + ".mq5").replace("/", B), "/log:" + (W + "/ind.log").replace("/", B)]); time.sleep(4)
subprocess.run([ED, "/compile:" + (W + "/AT24_%s_Licensed.mq5" % short).replace("/", B), "/log:" + (W + "/ea.log").replace("/", B)]); time.sleep(4)
for n in ("ind.log", "ea.log"):
    t = open(W + "/" + n, encoding="utf-16", errors="replace").read()
    print(n, [l for l in t.split("\n") if "Result" in l or "error" in l.lower()][:3])
print(os.path.exists(TERM + "/" + ind + ".ex5"), os.path.exists(W + "/AT24_%s_Licensed.ex5" % short))
