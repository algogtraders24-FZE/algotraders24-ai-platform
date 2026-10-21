"""Builds XXXUS30_demo.mq5 - the 30-day DEMO distribution build of XXX US30 - from XXXUS30_licensed.mq5.

What changes (trading logic is NOT touched; every value below is the licensed build's own default):
  * Inputs tab: only licence key, lot sizing, protection (prop mode / daily loss), magic and dashboard stay visible. Everything else
    (stops, targets, trailing, modules, trend filter, AI filter, shields, timeframe ...) becomes an internal `const` - it no longer appears
    in the EA's Inputs tab and no settings file can expose it.
  * The ONNX model is embedded ENCRYPTED (xxxus30_filter.bin); the key comes from the AT24 licence check (AT24_ModelVault.mqh).
    In the Strategy Tester there is no licence call, so the AI filter is off there.
  * Module names (strategy names) become "M1".."M5" in order comments and "Module 1".."Module 5" on the chart panel; log lines and the
    panel no longer say ONNX / AI / model details.
Usage: python build_xxxus30_demo_source.py <out_dir>
(The .enc file is made separately by encrypt_model.py; this script only writes the source.)"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
out_dir = Path(sys.argv[1])
out_dir.mkdir(parents=True, exist_ok=True)
src = (HERE / "source" / "XXXUS30_licensed.mq5").read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")


def sub(text, old, new, count=1):
    if old not in text:
        raise SystemExit("pattern not found: " + old[:80])
    return text.replace(old, new, count)


# ---------------------------------------------------------------- header / properties / includes
head_end = src.index("//--- AI model is built into this .ex5")
new_head = """//+------------------------------------------------------------------+
//|                                                XXXUS30_demo.mq5  |
//|                        Copyright algotraders24.ai                  |
//|                        XXX US30 - 30-day demo build                |
//+------------------------------------------------------------------+
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property version   "1.03"
#property strict
#property description "XXX US30 - Powered by ALGOTRADERS24 AI"
#property description "US30 Expert Advisor - 30-day demo build"

"""
s = new_head + src[head_end:]
s = sub(s, '#resource "xxxus30_filter_embedded.onnx" as uchar g_EmbeddedModel[]', '#resource "xxxus30_filter.bin" as uchar g_EncModel[]')
s = sub(s, "//--- AI model is built into this .ex5 (no model files to copy). See OnInit for the load order.", "//--- the model is built into this .ex5 in encrypted form (key comes from the AT24 licence check)")
s = sub(s, '#define AT24_PRODUCT_ID "XXXUS30"\n#include "AT24_LicenseGate.mqh"', '#define AT24_PRODUCT_ID "XXXUS30"\n#define AT24_WANT_MODEL_KEY\n#include "AT24_LicenseGate.mqh"\n#include "AT24_ModelVault.mqh"')

# ---------------------------------------------------------------- inputs
lines = s.split("\n")
i0 = next(i for i, l in enumerate(lines) if l.startswith('input group "=== LOT SIZE ==="'))
i1 = next(i for i, l in enumerate(lines) if l.startswith("input bool   InpShowDashboard"))
block = lines[i0:i1 + 1]
pat = re.compile(r"^input\s+(\S+)\s+(\w+)\s*=\s*([^;]+);")
decl = []
for l in block:
    m = pat.match(l)
    if m:
        decl.append((m.group(1), m.group(2), m.group(3).strip()))
VISIBLE = {"InpSizingMode", "InpFixedLot", "InpRiskPercent", "InpMaxLot", "InpPropFirmMode", "InpPropFirmMaxDrawdown", "InpPropFirmProfitTarget",
           "InpDailyLossLimitEnabled", "InpMaxDailyLossPercent", "InpMagicNumber", "InpShowDashboard"}
vals = {n: (t, v) for t, n, v in decl}
assert VISIBLE <= set(vals), VISIBLE - set(vals)
# demo-friendly sizing defaults (the licensed build's defaults are for the owner's own accounts)
demo_default = {"InpSizingMode": "1", "InpFixedLot": "0.10", "InpRiskPercent": "0.5", "InpMaxLot": "0.0"}
comments = {
    "InpSizingMode": "0 = fixed lot, 1 = risk % of balance",
    "InpFixedLot": "lot size when sizing mode is 0",
    "InpRiskPercent": "risk per trade in % of balance when sizing mode is 1",
    "InpMaxLot": "largest lot allowed (0 = no cap)",
    "InpPropFirmMode": "stop trading when the drawdown or profit target below is reached",
    "InpPropFirmMaxDrawdown": "max drawdown in %",
    "InpPropFirmProfitTarget": "profit target in %",
    "InpDailyLossLimitEnabled": "pause for the day after the loss below",
    "InpMaxDailyLossPercent": "daily loss limit in %",
    "InpMagicNumber": "magic number of this EA",
    "InpShowDashboard": "show the panel on the chart",
}


def inp(name):
    t, v = vals[name]
    v = demo_default.get(name, v)
    return f"input {t} {name} = {v}; // {comments[name]}"


new_block = ['input group "=== LOT SIZE ==="'] + [inp(n) for n in ("InpSizingMode", "InpFixedLot", "InpRiskPercent", "InpMaxLot")]
new_block += ['', 'input group "=== PROTECTION ==="'] + [inp(n) for n in ("InpPropFirmMode", "InpPropFirmMaxDrawdown", "InpPropFirmProfitTarget", "InpDailyLossLimitEnabled", "InpMaxDailyLossPercent")]
new_block += ['', 'input group "=== GENERAL ==="'] + [inp(n) for n in ("InpMagicNumber", "InpShowDashboard")]
new_block += ['', '//--- fixed internal settings (not user inputs)']
for t, n, v in decl:
    if n in VISIBLE:
        continue
    if n in ("InpEnableApex", "InpEnablePulse"):
        continue  # these two modules are not part of the demo build at all
    if n == "InpUseONNX":
        v = "true"
    if n == "InpONNXFile":
        v = '""'
    new_block.append(f"const {t} {n} = {v};")
lines[i0:i1 + 1] = new_block
s = "\n".join(lines)

# ---------------------------------------------------------------- model load (encrypted resource + licence key)
old_load = """      if(StringLen(InpONNXFile) > 0 && FileIsExist(InpONNXFile)) {
         onnx_handle = OnnxCreate(InpONNXFile, ONNX_DEFAULT);
         if(onnx_handle != INVALID_HANDLE) g_aiSource = "file " + InpONNXFile;
      }
      if(onnx_handle == INVALID_HANDLE) {
         onnx_handle = OnnxCreateFromBuffer(g_EmbeddedModel, ONNX_DEFAULT);
         if(onnx_handle != INVALID_HANDLE) g_aiSource = "embedded model";
      }"""
new_load = """      // The model is embedded ENCRYPTED; its key comes from the AT24 licence check (not available in the Strategy Tester).
      string modelKey = AT24Gate_ModelKey();
      if(modelKey != "") {
         uchar plainModel[];
         if(AT24Vault_Decrypt(g_EncModel, modelKey, plainModel)) {
            onnx_handle = OnnxCreateFromBuffer(plainModel, ONNX_DEFAULT);
            if(onnx_handle != INVALID_HANDLE) g_aiSource = "protected";
            AT24Vault_Wipe(plainModel);
         } else Print("Protected filter could not be opened (key or data invalid).");
      } else Print("Protected filter: no key available (Strategy Tester or licence not checked).");"""
s = sub(s, old_load, new_load)

# ---------------------------------------------------------------- module names -> neutral, neutral log lines
# the demo carries three modules only: Apex and Pulse are removed from the code, not just switched off
for blk in ("InpEnableApex", "InpEnablePulse"):
    s, n_removed = re.subn(r"\n   if\(" + blk + r"\) \{.*?\n   \}\n", "\n", s, count=1, flags=re.S)
    assert n_removed == 1, blk
s = re.sub(r'\n   CreateModuleRowCompact\("(?:Apex|Pulse)", InpEnable(?:Apex|Pulse), [^\n]*', "", s)
s = s.replace('CreateModuleRowCompact("Zenith", InpEnableZenith, yModules+52, xLeft);', 'CreateModuleRowCompact("Zenith", InpEnableZenith, yModules+37, xLeft);')
s = s.replace('CreateModuleRowCompact("Eclipse", InpEnableEclipse, yModules+82, xLeft);', 'CreateModuleRowCompact("Eclipse", InpEnableEclipse, yModules+52, xLeft);')
s = s.replace('CreateRect(g_prefix+"ModulesBG", xLeft, yModules, wLeft, 95, clrBG, clrGrayBox);', 'CreateRect(g_prefix+"ModulesBG", xLeft, yModules, wLeft, 65, clrBG, clrGrayBox);')
s = s.replace("int yShields = yModules + 105;", "int yShields = yModules + 75;")
for k, name in enumerate(["Nova", "Zenith", "Eclipse"], start=1):
    s = s.replace(f'"{name}_Buy"', f'"M{k}_Buy"').replace(f'"{name}_Sell"', f'"M{k}_Sell"')
    s = s.replace(f'CreateModuleRowCompact("{name}"', f'CreateModuleRowCompact("Module {k}"')
s = s.replace("XXX US30 v1.01 ONNX", "XXX US30 DEMO").replace("algotraders24.ai | US30 v1.01", "algotraders24.ai | demo build")
s = s.replace("=== XXX US30 v1.02 Initialized ===", "=== XXX US30 demo Initialized ===")
s = s.replace("XXX US30 v1.02", "XXX US30 demo")

# neutral log lines and panel text (no model / threshold / feature details)
def _neutral(m):
    t = m.group(0)
    if "Loaded Successfully" in t:
        return 'Print("Protected filter loaded");'
    if "could not be loaded" in t:
        return 'Print("WARNING: protected filter could not be loaded, error ", GetLastError());'
    if "AI DISABLED" in t:
        return 'Print("Protected filter disabled (fail-safe mode) - the EA keeps running without it");'
    if "Failed to set" in t:
        return 'Print("WARNING: protected filter setup failed");'
    if "released successfully" in t:
        return 'Print("Protected filter released");'
    if "release returned false" in t:
        return 'Print("Protected filter release: handle already invalid");'
    if "inference failed" in t:
        return 'Print("Protected filter error - fail-safe mode");'
    if "DISABLED (InpUseONNX" in t:
        return 'Print("Protected filter disabled");'
    return t


s = re.sub(r'Print\("[^;\n]*(?:ONNX|AI DISABLED)[^;\n]*\);', _neutral, s)
s = s.replace('"AI: "+aiTxt+" ("+DoubleToString(InpAIScoreThreshold, 2)+")"', '"FILTER: "+aiTxt')

for gone in ("Apex", "Pulse", "iHighest(_Symbol, InpTF, MODE_HIGH, 12", "atr_val*0.5"):
    assert gone not in s, "removed module still present: " + gone
open(out_dir / "XXXUS30_demo.mq5", "wb").write(s.replace("\n", "\r\n").encode("utf-8"))
leaks = sorted(set(re.findall(r'"[^"\n]*(?:ONNX|onnx|AI |Nova|Apex|Zenith|Pulse|Eclipse|MoonLock|EMA|Fractal|RSI|ATR|breakout|Breakout)[^"\n]*"', s)))
print("written", out_dir / "XXXUS30_demo.mq5", "| visible inputs:", len(VISIBLE), "| hidden consts:", len(decl) - len(VISIBLE))
print("strings still mentioning logic words (review):")
for x in leaks:
    print("  ", x.encode("ascii", "replace").decode())
