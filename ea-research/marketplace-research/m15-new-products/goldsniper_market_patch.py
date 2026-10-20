"""Market validator fix (v1.01) applied to the plain Gold Sniper source by build_goldsniper_mql5_market.py.

The MQL5 Market tests EURUSD / GBPUSD / XAUUSD on several timeframes with default inputs and rejects an EA that makes no trades.
The gold-scaled distances (PipSize 0.01) never fire on forex, so on non-gold symbols the EA now scales every distance by
price / 2500 (the gold price the defaults were built on). On gold nothing changes. The spread limit is expressed in the same
pip unit, so it no longer depends on the broker's digits."""

HELPERS = """datetime g_lastAction = 0;
double g_pip = 0.01;

bool IsGoldSymbol()
{
   string s = _Symbol; StringToUpper(s);
   return (StringFind(s, "XAU") >= 0 || StringFind(s, "GOLD") >= 0);
}

void InitPipUnit()
{
   g_pip = PipSize;
   if(!AutoAdaptSymbol || IsGoldSymbol()) return;
   double px = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(px <= 0.0) px = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   if(px > 0.0) g_pip = PipSize * px / 2500.0;
}"""


def must(cond, msg):
    if not cond:
        raise SystemExit("patch failed: " + msg)


def apply(out):
    nl = "\r\n" if "\r\n" in out else "\n"
    out = out.replace("\r\n", "\n")
    must('#property version   "1.00"' in out, "version")
    out = out.replace('#property version   "1.00"', '#property version   "1.01"')
    old = 'Print("=== Gold Sniper v1.00 initialized ===");'
    must(old in out, "init print")
    out = out.replace(old, 'Print("=== Gold Sniper v1.01 initialized | symbol ", _Symbol, " | pip unit ", DoubleToString(g_pip, 8), " ===");')
    res = []
    for ln in out.split("\n"):
        if ln.startswith("input double PipSize"):
            res.append(ln)
            res.append("input bool   AutoAdaptSymbol          = true;   // Non-gold symbols: scale all distances by price / 2500 (tested on XAUUSD only)")
            continue
        if "PipSize" in ln and not ln.startswith("input") and "PipSize <= 0.0" not in ln:
            ln = ln.replace("PipSize", "g_pip")
        res.append(ln)
    out = "\n".join(res)
    must("datetime g_lastAction = 0;" in out, "anchor")
    out = out.replace("datetime g_lastAction = 0;", HELPERS, 1)
    old = "   trade.SetExpertMagicNumber(MagicNumber);"
    must(old in out, "init anchor")
    out = out.replace(old, "   InitPipUnit();\n" + old, 1)
    old = "return (t.ask-t.bid)/_Point<=MaxSpreadPoints;"
    must(old in out, "spread")
    out = out.replace(old, "return (t.ask-t.bid)/g_pip<=MaxSpreadPoints;")
    rest = out.replace("input double PipSize", "").replace("PipSize <= 0.0", "").replace("g_pip = PipSize", "").replace("PipSize * px", "")
    must("PipSize" not in rest, "leftover PipSize")
    return out.replace("\n", nl)
