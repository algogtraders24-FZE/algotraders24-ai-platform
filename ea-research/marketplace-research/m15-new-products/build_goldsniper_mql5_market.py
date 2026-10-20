"""Builds the MQL5 Market submission source for Gold Sniper: the plain (NO AT24 licence) GoldSniper.mq5 with the tested
distances / filter toggles as defaults (lot stays risk-based 0.5% so a default attach never trades 1.0 lot on a small account)
and the website name removed from the properties (Market rules).
Usage: python -I build_goldsniper_mql5_market.py <out_dir>"""
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
SRC = open(os.path.join(HERE, "source", "GoldSniper.mq5"), encoding="utf-8", errors="replace").read()

z = zipfile.ZipFile(os.path.join(HERE, "source", "GoldSniper_v1.00.zip"))
tested = {}
for line in z.read("GoldSniper_tested_settings.set").decode("ascii").replace("\r", "").split("\n"):
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
out = out.replace('#property description "Gold Sniper - Powered by ALGOTRADERS24 AI"',
                  '#property description "Gold Sniper - XAUUSD M1 trend continuation, one precise pending order at a time"')
out = out.replace('#property description "XAUUSD M1 pending-stop trend continuation"',
                  '#property description "M5 EMA trend + fair value gap, buy-stop / sell-stop entry, break-even and trailing exit. Use on XAUUSD."')

target = os.path.join(out_dir, "GoldSniper.mq5")
open(target, "w", encoding="utf-8", newline="\r\n").write(out)
for c in changes:
    print("default -> tested:", *c)
print("wrote", target, "| inputs changed:", len(changes))
