"""Build a gate-free, link-free MQL5 Market indicator from an AT24 MT5 indicator folder.
usage: python mk_market.py AT24_Zone_Pro   -> E:/at24-ind-list/ea-research/marketplace-research/mql5-market/<Dir>/*.ex5"""
import os, re, shutil, subprocess, sys

d = sys.argv[1]
SRC = "E:/algotraders24-ai-platform/ea-research/lab/MQL5Market/peer_src/ea-research/indicators/%s/mt5/" % d
OUT = "E:/algotraders24-ai-platform/ea-research/lab/MQL5Market/peer_build/%s/" % d
os.makedirs(OUT, exist_ok=True)
main = None
for f in os.listdir(SRC):
    if f.endswith((".mq5", ".mqh", ".bmp")) and "SelfTest" not in f and "_Shot" not in f and "DstTest" not in f:
        shutil.copy(SRC + f, OUT + f)
        if f.endswith(".mq5") and (main is None or f == d + ".mq5"):
            main = f
s = open(OUT + main, encoding="utf-8", errors="replace").read()
s = re.sub(r'#property link[^\n]*\n', '', s)
s = s.replace('#property copyright "AlgoTraders24"', '#property copyright "Algotraders24 AI"')
s = re.sub(r'\s*algotraders24\.ai', '', s, flags=re.I)
s = re.sub(r'\(c\) AlgoTraders24 -', '(c) Algotraders24 AI', s)
s = s.replace('\r\n', '\n')
# MQL5 pre-test server has only a few symbols: selecting a missing symbol logs "symbol X does not exist"
# and counts as an error. Select a symbol only when it is in the server's symbol list.
if 'SymbolSelect(' in s:
    helper = ('bool AT24SymSelect(const string sym, const bool on)\n  {\n   int n = SymbolsTotal(false);\n'
              '   for(int i = 0; i < n; i++)\n      if(SymbolName(i, false) == sym) return SymbolSelect(sym, on);\n   return false;\n  }\n\n')
    s = s.replace('SymbolSelect(', 'AT24SymSelect(')
    s = s.replace('bool AT24SymSelect(const string sym, const bool on)', 'bool AT24SymSelect(const string sym, const bool on)', 1)
    k = s.index('input group')
    s = s[:k] + helper + s[k:]
    s = s.replace('return SymbolSelect(sym, on)', 'return SymbolSelect(sym, on)')  # keep the real call inside the helper
    s = s.replace('return AT24SymSelect(sym, on)', 'return SymbolSelect(sym, on)')
    s = re.sub(r'#property version\s+"1\.00"', '#property version   "1.01"', s)
# Volatility Forecast: the MQL5 pre-test also runs on D1; failing in OnInit is rejected, so show a message instead.
if d == "AT24_Volatility_Forecast":
    old = ('      Print("AT24 Volatility Forecast: use a chart of H1 or lower (time-of-day pattern needs intraday bars).");\n'
           '      return INIT_PARAMETERS_INCORRECT;')
    assert old in s
    s = s.replace(old, '      Comment("AT24 Volatility Forecast: use a chart of H1 or lower (the time of day pattern needs intraday bars).");\n'
                       '      gBadTf = true;\n      return INIT_SUCCEEDED;')
    s = s.replace('bool   gDash = false;', 'bool   gDash = false;\nbool   gBadTf = false;', 1)
    s = s.replace('   if(rates_total < 600) return 0;', '   if(gBadTf || rates_total < 600) return 0;', 1)
    s = s.replace('void OnDeinit(const int reason) { ObjectsDeleteAll(0, PFX); }',
                  'void OnDeinit(const int reason) { ObjectsDeleteAll(0, PFX); if(gBadTf) Comment(""); }', 1)
    s = re.sub(r'#property version\s+"1\.0\d"', '#property version   "1.01"', s)
open(OUT + main, "w", encoding="utf-8", newline="\n").write(s)
bad = [l for l in s.split("\n") if re.search(r'algotraders24\.|http|WebRequest|#import', l, re.I)]
print("remaining flagged lines:", bad)
T="C:/Users/om/AppData/Roaming/MetaQuotes/Terminal/D0E8209F77C8CF37AD8BF550E51FF075/MQL5/Indicators/AT24Market/%s/" % d
shutil.rmtree(T, ignore_errors=True); shutil.copytree(OUT, T)
subprocess.run(['C:/Program Files/MetaTrader 5/metaeditor64.exe', '/compile:' + (T + main).replace('/', '\\'), '/log:' + (OUT + 'compile.log').replace('/', '\\')])
import time
time.sleep(5)
log = open(OUT + 'compile.log', encoding='utf-16', errors='replace').read()
print([l for l in log.split("\n") if 'Result' in l or 'error' in l.lower()][:5])
shutil.copy(T + main.replace('.mq5', '.ex5'), OUT + main.replace('.mq5', '.ex5'))
print([x for x in os.listdir(OUT) if x.endswith('.ex5')])
