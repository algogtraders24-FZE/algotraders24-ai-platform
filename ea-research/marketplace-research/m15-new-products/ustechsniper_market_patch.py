"""Market validator fix applied to the plain USTECH Index Sniper source by build_ustechsniper_mql5_market.py.

The MQL5 Market tests EURUSD / GBPUSD / XAUUSD on several timeframes with default inputs and rejects an EA that makes no trades.
The index-scaled distances (PipSize 0.01 on a ~21,700 index, so a 5000-pip stop is a 50-point move) would never fire on forex, so on
non-index symbols the EA scales every distance by price / 21700 (the index level the defaults were built on). On a US Tech index symbol
nothing changes. The spread filter keeps its original rule on the index; on other symbols it uses max(MaxSpreadPoints * pip unit,
0.015 percent of price) so a normal forex spread does not block every trade.

v1.01 (Market validator, "failed cancel order" errors): the broker's FREEZE level is now respected. Entries are placed at least
max(stops level, freeze level) + buffer away from the market, a pending order is never cancelled while its price is inside the freeze
zone (the server refuses that request), a refused cancel is retried only after 2 minutes, and trailing stops are not modified while the
position's stop or take profit is inside the freeze zone.

v1.02 (the v1.01 report still showed "failed cancel order ... Modification failed due to order or position being close to market"
although the freeze check passed, i.e. the validator's symbol reports a freeze level of 0 yet refuses the request): the "too close to
market" guard no longer relies on the reported freeze level. SafeDistance() = max(freeze, stops level) and, on non-index symbols,
at least 0.3 percent of the price (about 30 pips on EURUSD). A pending order or a stop/take profit that is closer to the market than
that is simply left alone (it fills, or the price moves away, and then it is cancelled / modified normally) instead of being sent to a
server that refuses it. The index behaviour is unchanged."""

REF_PRICE = "21700.0"

HELPERS = """datetime g_lastAction = 0;
double g_pip = 0.01;
bool   g_scaled = false;
datetime g_nextCancelTry = 0;

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
}

double SafeDistance()
{
   double fz = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL) * _Point;
   double st = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;
   double d = MathMax(fz, st);
   if(g_scaled)
   {
      double px = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(px <= 0.0) px = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      d = MathMax(d, px * 0.003);
   }
   return d;
}"""

MAINTAIN_OLD_START = "void MaintainPendingOrdersEveryTick()"
MAINTAIN_NEW = """void MaintainPendingOrdersEveryTick()
{
   bool outSession=EnableSessionFilter && !IsEntrySessionOpen();
   double freeze=SafeDistance();
   MqlTick tk; bool haveTick=SymbolInfoTick(_Symbol,tk);
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong ticket=OrderGetTicket(i); if(ticket==0) continue;
      if(OrderGetString(ORDER_SYMBOL)!=_Symbol || OrderGetInteger(ORDER_MAGIC)!=MagicNumber) continue;
      datetime expiry=(datetime)OrderGetInteger(ORDER_TIME_EXPIRATION);
      bool expired=(expiry>0 && TimeCurrent()>=expiry);
      if(outSession || expired)
      {
         if(TimeCurrent()<g_nextCancelTry) continue;   // a cancel was refused a moment ago: wait before asking again
         if(haveTick && freeze>0.0)
         {
            // the server refuses to cancel an order whose price is too close to the market: leave it until it fills or the price moves away
            ENUM_ORDER_TYPE ot=(ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
            double ref=(ot==ORDER_TYPE_BUY_STOP || ot==ORDER_TYPE_BUY_LIMIT) ? tk.ask : tk.bid;
            if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN)-ref)<=freeze) continue;
         }
         if(trade.OrderDelete(ticket)) g_lastAction=TimeCurrent();
         else g_nextCancelTry=TimeCurrent()+120;
      }
   }
}
"""

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
    out = out.replace('#property version   "1.00"', '#property version   "1.02"')
    old = 'Print("=== USTECH Index Sniper v1.00 initialized ===");'
    must(old in out, "init print")
    out = out.replace(old, 'Print("=== USTECH Index Sniper v1.02 initialized | symbol ", _Symbol, " | pip unit ", DoubleToString(g_pip, 8), " ===");')
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
    stops_old = "int stops=(int)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);"
    must(out.count(stops_old) == 2, "stops level lines")
    out = out.replace(stops_old, "int stops=(int)MathMax(SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL),SymbolInfoInteger(_Symbol,SYMBOL_TRADE_FREEZE_LEVEL));")
    i = out.index(MAINTAIN_OLD_START)
    j = out.index("\n}\n", i) + 3
    out = out[:i] + MAINTAIN_NEW.rstrip("\n") + "\n" + out[j:]
    mod_old = "      if(improve)\n      {\n         if(!trade.PositionModify(ticket,candidate,oldTP))"
    must(mod_old in out, "modify block")
    mod_new = ("      if(improve)\n      {\n"
               "         double fz=SafeDistance();\n"
               "         if(fz>0.0 && ((oldSL>0.0 && MathAbs(price-oldSL)<=fz) || (oldTP>0.0 && MathAbs(price-oldTP)<=fz))) continue;   // too close to the market: the server would refuse the change\n"
               "         if(!trade.PositionModify(ticket,candidate,oldTP))")
    out = out.replace(mod_old, mod_new, 1)
    must(SPREAD_OLD in out, "spread")
    out = out.replace(SPREAD_OLD, SPREAD_NEW)
    rest = out.replace("input double PipSize", "").replace("PipSize <= 0.0", "").replace("g_pip = PipSize", "").replace("PipSize * px", "")
    must("PipSize" not in rest, "leftover PipSize")
    return out.replace("\n", nl)
