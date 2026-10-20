"""Builds USTECHIndexSniper.mq5 (plain) and USTECHIndexSniper_licensed.mq5 (AT24 licence gate) from the owner's EA file.
Only names / comments / the init message / order comments change; every trading rule and input default is untouched
(a verification at the end asserts the code outside those lines is identical).
Usage: python build_ustechsniper_source.py "<Gold Sniper.mq5 from the owner>" """
import re
import sys
from pathlib import Path

src_path = Path(sys.argv[1])
OUT = Path(__file__).resolve().parent / "source"
raw = src_path.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")

HEADER_OLD = raw[: raw.index("#include <Trade/Trade.mqh>")]
HEADER_NEW = """//+------------------------------------------------------------------+
//| USTECHIndexSniper.mq5                                           |
//| USTECH Index Sniper - US Tech index M1 pending-stop trend       |
//| continuation (M5 trend + fair value gap, break-even + trailing) |
//+------------------------------------------------------------------+
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property strict
#property version   "1.00"
#property description "USTECH Index Sniper - Powered by ALGOTRADERS24 AI"
#property description "US Tech index M1 pending-stop trend continuation"
"""
plain = raw.replace(HEADER_OLD, HEADER_NEW, 1)
plain = plain.replace('input group "=== Broker / Gold Pip Definition ==="', 'input group "=== Broker / Index Point Definition ==="')
plain = plain.replace("input double PipSize                  = 0.01; // XAUUSD: verify broker convention", "input double PipSize                  = 0.01; // 1 pip = 0.01 price units; verify your broker's digits for the index symbol")
plain = plain.replace('"P4_BuyContinuation"', '"USTECHSniper_Buy"').replace('"P4_SellContinuation"', '"USTECHSniper_Sell"')
plain = plain.replace("   g_atrHandle = iATR(_Symbol, PERIOD_M1, ATRPeriod);", '   Print("=== USTECH Index Sniper v1.00 initialized ===");\n   g_atrHandle = iATR(_Symbol, PERIOD_M1, ATRPeriod);', 1)

lic = plain.replace(
    "CTrade trade;",
    '//--- AT24 licence gate: one key = one trading account, only for this product (Strategy Tester needs no key)\n'
    '#define AT24_PRODUCT_ID "USTECHSNIPER"\n#include "AT24_GatedTrade.mqh"\n'
    'input group "=== AT24 Licence ==="\ninput string InpLicenseKey = ""; // AT24 licence key (from your AT24 purchase page)\nCAT24Trade trade;',
    1,
)
lic = lic.replace("int OnInit()\n{\n", "int OnInit()\n{\n   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;\n", 1)
lic = lic.replace("void OnTick()\n{\n", "void OnTick()\n{\n   AT24Gate_Timer(InpLicenseKey);\n", 1)
assert "AT24Gate_Init" in lic and "AT24Gate_Timer" in lic and "CAT24Trade trade;" in lic

# Safety check: apart from the lines above, the logic must equal the owner's file.
def logic(t: str) -> list:
    out = []
    for line in t.split("\n"):
        s = line.strip()
        if s.startswith("//") or s.startswith("#property") or s.startswith("Print(\"=== ") or s.startswith("input group"):
            continue
        s = re.sub(r"//.*$", "", s).strip()
        s = s.replace("USTECHSniper_Buy", "P4_BuyContinuation").replace("USTECHSniper_Sell", "P4_SellContinuation")
        if s:
            out.append(s)
    return out


assert logic(plain) == logic(raw), "trading logic differs from the owner's file"
(OUT / "USTECHIndexSniper.mq5").write_bytes(plain.replace("\n", "\r\n").encode("utf-8"))
(OUT / "USTECHIndexSniper_licensed.mq5").write_bytes(lic.replace("\n", "\r\n").encode("utf-8"))
print("written USTECHIndexSniper.mq5 and USTECHIndexSniper_licensed.mq5; logic identical to the owner's file")
