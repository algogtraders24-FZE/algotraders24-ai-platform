"""Replaces the embedded offline licence (License_Key + License_Expiry + Lic_* functions) of a m14 catalog EA with the AT24 licence gate
(one key = one trading account, only for this product, issued with the AT24 purchase). Only the licence plumbing changes: the
trading logic is untouched; new entries are blocked while the licence is refused through a CTrade subclass (CAT24Trade).
Usage: python patch_licensed.py <source.mq5> <out.mq5> <AT24_PRODUCT_ID> <new_version>"""
import re
import sys

src, out, product, new_version = sys.argv[1:5]
s = open(src, encoding="utf-8", errors="surrogateescape").read()
crlf = "\r\n" in s
s = s.replace("\r\n", "\n")


def must(cond, msg):
    if not cond:
        raise SystemExit("PATCH FAILED (%s): %s" % (src, msg))


# 1) the licence block -> the AT24 gate
start_marker = "//|  ALGOTRADERS24 AI - Embedded License (account + expiry key)"
i = s.find(start_marker)
must(i > 0, "licence block header not found")
block_start = s.rfind("//+----", 0, i)
must(block_start >= 0, "separator before the licence block not found")
fn = s.find("string Lic_Validate(){")
must(fn > i, "Lic_Validate not found")
end = s.find("\n}\n", fn)
must(end > fn, "end of Lic_Validate not found")
end += 3
NEW_BLOCK = (
    "//+------------------------------------------------------------------+\n"
    "//|  ALGOTRADERS24 AI - licence (AT24 licence key, one key = one account) |\n"
    "//+------------------------------------------------------------------+\n"
    "#define AT24_PRODUCT_ID \"%s\"\n"
    "#include \"AT24_GatedTrade.mqh\"\n"
    "input group \"=== LICENSE ===\"\n"
    "input string InpLicenseKey = \"\";   // AT24 licence key (from your AT24 purchase page)\n" % product
)
s = s[:block_start] + NEW_BLOCK + s[end:]

# 2) the OnInit licence check
m = re.search(r"   // --- License check ---\n   string licErr=Lic_Validate\(\);\n   if\(licErr!=\"\"\)\{\n(?:.*\n){1,4}?   \}\n", s)
must(m is not None, "OnInit licence check not found")
s = s[:m.start()] + "   // --- AT24 licence ---\n   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;\n" + s[m.end():]
must("Lic_Validate" not in s and "License_Key" not in s and "License_Expiry" not in s and "LIC_SECRET" not in s, "old licence code still referenced")

# 3) the trade object
must(s.count("CTrade        trade;") == 1, "CTrade trade; not found exactly once")
s = s.replace("CTrade        trade;", "CAT24Trade    trade;", 1)

# 4) timer hook
must(s.count("void OnTimer()\n{\n") == 1 or s.count("void OnTimer()\n{") == 1, "OnTimer not found")
s = re.sub(r"void OnTimer\(\)\s*\n\{\n", "void OnTimer()\n{\n   AT24Gate_Timer(InpLicenseKey);\n", s, count=1)
must("AT24Gate_Timer" in s, "timer hook not inserted")

# 5) version
mv = re.search(r'#property version(\s+)"([\d.]+)"', s)
must(mv is not None, "version property not found")
s = s.replace(mv.group(0), '#property version%s"%s"' % (mv.group(1), new_version), 1)

if crlf:
    s = s.replace("\n", "\r\n")
open(out, "w", encoding="utf-8", errors="surrogateescape").write(s)
print("ok", out)
