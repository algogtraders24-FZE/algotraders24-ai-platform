"""Market validator fix applied to the plain USTECH Index Sniper source by build_ustechsniper_mql5_market.py.

The MQL5 Market tests EURUSD / GBPUSD / XAUUSD on several timeframes with default inputs and rejects an EA that makes no trades.
The index-scaled distances (PipSize 0.01 on a ~21,700 index, so a 5000-pip stop is a 50-point move) would never fire on forex, so on
non-index symbols the EA scales every distance by price / 21700 (the index level the defaults were built on). On a US Tech index symbol
nothing changes. The spread filter keeps its original rule on the index; on other symbols it uses max(MaxSpreadPoints * pip unit,
0.015 percent of price) so a normal forex spread does not block every trade."""

REF_PRICE = "21700.0"

HELPERS = """datetime g_lastAction = 0;
double g_pip = 0.01;
bool   g_scaled = false;

bool IsIndexSymbol()
{
   string s = _Symbol; StringToUpper(s);
   return (StringFind(s, "USTEC") >= 0 || StringFind(s, "US100") >= 0 || StringFind(s, "NAS100") >= 0 ||
           StringFind(s, "NDX") >= 0 || StringFind(s, "NASDAQ") >= 0 || StringFind(s, "TECH100") >= 0);
}

void InitPipUnit()
{
   g_pip = PipSize;
   g_scaled = false;
   if(!AutoAdaptSymbol || IsIndexSymbol()) return;
   double px = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(px <= 0.0) px = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(px > 0.0) { g_pip = PipSize * px / REFPRICE; g_scaled = true; }
}"""

SPREAD_OLD = "return (t.ask-t.bid)/_Point<=MaxSpreadPoints;"
SPREAD_NEW = """if(!g_scaled) return (t.ask-t.bid)/_Point<=MaxSpreadPoints;
   double cap = MathMax(MaxSpreadPoints*g_pip, (t.ask+t.bid)*0.5*0.00015);
   return (t.ask-t.bid)<=cap;"""


def must(cond, msg):
    if not cond:
        raise SystemExit("patch failed: " + msg)


def apply(out):
    nl = "\r\n" if "\r\n" in out else "\n"
    out = out.replace("\r\n", "\n")
    must('#property version   "1.00"' in out, "version")
    old = 'Print("=== USTECH Index Sniper v1.00 initialized ===");'
    must(old in out, "init print")
    out = out.replace(old, 'Print("=== USTECH Index Sniper v1.00 initialized | symbol ", _Symbol, " | pip unit ", DoubleToString(g_pip, 8), " ===");')
    res = []
    for ln in out.split("\n"):
        if ln.startswith("input double PipSize"):
            res.append(ln)
            res.append("input bool   AutoAdaptSymbol          = true;   // Non-index symbols: scale all distances by price / %s (tested on a US Tech index only)" % REF_PRICE.replace(".0", ""))
            continue
        if "PipSize" in ln and not ln.startswith("input") and "PipSize <= 0.0" not in ln:
            ln = ln.replace("PipSize", "g_pip")
        res.append(ln)
    out = "\n".join(res)
    must("datetime g_lastAction = 0;" in out, "anchor")
    out = out.replace("datetime g_lastAction = 0;", HELPERS.replace("REFPRICE", REF_PRICE), 1)
    old = "   trade.SetExpertMagicNumber(MagicNumber);"
    must(old in out, "init anchor")
    out = out.replace(old, "   InitPipUnit();\n" + old, 1)
    must(SPREAD_OLD in out, "spread")
    out = out.replace(SPREAD_OLD, SPREAD_NEW)
    rest = out.replace("input double PipSize", "").replace("PipSize <= 0.0", "").replace("g_pip = PipSize", "").replace("PipSize * px", "")
    must("PipSize" not in rest, "leftover PipSize")
    return out.replace("\n", nl)
