"""Builds the MQL5 Market submission source for USTECH Index Sniper: the plain (NO AT24 licence) USTECHIndexSniper.mq5 with the tested
distances / filter toggles as defaults (lot stays risk-based 0.5% so a default attach never trades a huge lot on a small account),
the website name removed from the properties (Market rules) and the validator fix from ustechsniper_market_patch.py.
Usage: python -I build_ustechsniper_mql5_market.py <out_dir>"""
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
SRC = open(os.path.join(HERE, "source", "USTECHIndexSniper.mq5"), encoding="utf-8", errors="replace").read()

z = zipfile.ZipFile(os.path.join(HERE, "source", "USTECHIndexSniper_v1.00.zip"))
tested = {}
for line in z.read("USTECHIndexSniper_tested_settings.set").decode("ascii").replace("\r", "").split("\n"):
    m = re.match(r"^(\w+)=(.*)$", line)
    if m:
        tested[m.group(1)] = m.group(2)

KEEP_DEFAULT = {"UseRiskLot", "RiskPercent", "FixedLot", "TrendTF"}  # lot sizing stays safe; TrendTF is an enum (already M5)
pat = re.compile(r"^(input\s+(?:ENUM_\w+|\w+)\s+)(\w+)(\s*=\s*)([^;]+);(.*)$", re.M)
changes = []


def same(a, b):
    try:
        return float(a) == float(b)
    except ValueError:
        return a.lower() == b.lower()


def sub(m):
    name, old = m.group(2), m.group(4).strip()
    if name in KEEP_DEFAULT or name not in tested or same(old, tested[name]):
        return m.group(0)
    new = tested[name].lower()
    changes.append((name, old, new))
    return "%s%s%s%s;%s" % (m.group(1), name, m.group(3), new, m.group(5))


out = pat.sub(sub, SRC)
out = out.replace('#property copyright "Copyright algotraders24.ai - All Rights Reserved"', '#property copyright "Algotraders24 AI"')
out = out.replace('#property description "USTECH Index Sniper - Powered by ALGOTRADERS24 AI"',
                  '#property description "USTECH Index Sniper - US Tech 100 M1 trend continuation, one precise pending order at a time"')
out = out.replace('#property description "US Tech index M1 pending-stop trend continuation"',
                  '#property description "M5 EMA trend + fair value gap, buy-stop / sell-stop entry, break-even and trailing exit. Use on USTEC / NAS100 / US100."')

sys.path.insert(0, HERE)
import ustechsniper_market_patch  # noqa: E402

out = ustechsniper_market_patch.apply(out)

target = os.path.join(out_dir, "USTECHIndexSniper.mq5")
open(target, "w", encoding="utf-8", newline="\r\n").write(out)
for c in changes:
    print("default -> tested:", *c)
print("wrote", target, "| inputs changed:", len(changes))
