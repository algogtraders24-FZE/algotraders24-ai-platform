//+------------------------------------------------------------------+
//|                                        GoldBreakoutScalper.mq5   |
//|  Original breakout-scalping EA for XAUUSD (built from scratch)  |
//|                                                                  |
//|  Strategy: pending STOP orders on H/L breakout, instant tight   |
//|  trailing exit, balance-based sizing, Friday flat, spread/news  |
//|  spike filter, panic close on gap, symbol auto-detection.       |
//+------------------------------------------------------------------+
#property copyright "Original work"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

//=== Enums ==========================================================
enum ENUM_LOT_MODE  { LOT_FIXED, LOT_BALANCE };
enum ENUM_SR_MODE   { MODE_HIGH_FREQ, MODE_HIGH_PROB };

//=== Inputs ==========================================================
input group "=== Core Exit / Entry Distances (points, auto-scaled) ==="
input int    InpSL_Points        = 400;     // Hard Stop Loss
input int    InpTP_Points        = 10000;   // Take Profit (far - trailing does real exit)
input int    InpTrail_Points     = 20;      // Trailing distance - core exit
input int    InpShift_Points     = 1000;    // Min distance of pending order from price
input int    InpOrderGap_Points  = 5000;    // Min gap between own pending orders
input int    InpBreakEven_Points = 50;      // Move SL to BE once price moves this far in profit (0=off)

input group "=== Lot Sizing ==="
input ENUM_LOT_MODE InpLotMode   = LOT_BALANCE;
input double InpFixedLot         = 0.01;    // Used if LOT_FIXED
input double InpBalanceDiv       = 10000.0; // 0.01 lot per this much balance (LOT_BALANCE)

input group "=== Structure & Timing ==="
input ENUM_SR_MODE InpMode       = MODE_HIGH_PROB; // HIGH_FREQ = more levels, HIGH_PROB = filtered
input int    InpSwingLookback    = 24;      // Bars scanned for swing high/low
input int    InpTouchLookback    = 100;     // Bars scanned for touch-count confirmation (HIGH_PROB)
input int    InpMinTouches       = 2;       // Min prior touches of level to qualify (HIGH_PROB only)
input int    InpTrendMA_Period   = 50;      // MA period for trend filter (HIGH_PROB only)
input int    InpExpiryDays       = 7;       // Pending order expiry (days)
input int    InpMaxPositions     = 2;       // Max simultaneous open positions

input group "=== Trailing Behavior ==="
input bool   InpTrailingSmart    = true;    // Widen trail distance with live spread
input bool   InpHighProfitTrail  = false;   // Loosen trail once trade is well in profit to ride trend

input group "=== Filters / Safety ==="
input int    InpMaxSpread_Points = 100;     // Skip new entries if spread above this
input bool   InpNewsFilter       = true;    // Block new entries on abnormal spread spikes
input double InpSpreadSpikeMult  = 2.5;     // Spike = current spread > MultX average spread
input bool   InpFridayClose      = true;    // Close everything & stop trading before weekend
input int    InpFridayCloseHour  = 21;      // Server-time hour to flatten on Friday
input bool   InpPanicClose       = true;    // Emergency close on abnormal gap vs last tick
input double InpPanicGapPoints   = 3000;    // Gap size (points) considered a panic event
input int    InpCooldownSeconds  = 60;      // Pause new entries this long after a losing close
input int    InpMaxDeviation     = 30;      // Max slippage (points)
input long   InpMagic            = 990321;  // Magic number

//=== Globals =========================================================
CTrade   trade;
string   Sym;
double   Pt;
int      Scale = 1;
datetime lastBarTime   = 0;
datetime cooldownUntil = 0;
double   avgSpread     = 0.0;   // rolling average spread (points, unscaled)
double   lastBid       = 0.0;

//--- scaled point-input helper
double P(const int pts) { return pts * Scale * Pt; }

//+------------------------------------------------------------------+
//| Pick the correct broker symbol for gold (handles suffix/prefix)  |
//+------------------------------------------------------------------+
string DetectGoldSymbol()
{
   string best = "";
   double bestSpread = -1.0;

   // IMPORTANT: scan the FULL server symbol list (true), not just symbols
   // already sitting in Market Watch - most brokers do not pre-add
   // suffixed gold symbols (e.g. XAUUSD.m) to Market Watch by default.
   int total = SymbolsTotal(true);
   for(int i = 0; i < total; i++)
   {
      string s = SymbolName(i, true);
      string up = s;
      StringToUpper(up);
      if(StringFind(up, "XAU") < 0 && StringFind(up, "GOLD") < 0) continue;

      if(!SymbolSelect(s, true)) continue; // must be selected to read live quotes
      double bid = SymbolInfoDouble(s, SYMBOL_BID);
      if(bid <= 0.0) continue;

      double spread = (double)SymbolInfoInteger(s, SYMBOL_SPREAD);
      if(bestSpread < 0.0 || spread < bestSpread)
      {
         bestSpread = spread;
         best = s;
      }
   }
   if(best == "") best = _Symbol; // fallback: chart symbol
   return best;
}

//+------------------------------------------------------------------+
int OnInit()
{
   Sym = DetectGoldSymbol();
   SymbolSelect(Sym, true);

   Pt = SymbolInfoDouble(Sym, SYMBOL_POINT);
   if(Pt <= 0.0) return INIT_FAILED;

   int digits = (int)SymbolInfoInteger(Sym, SYMBOL_DIGITS);
   Scale = (digits >= 3 && SymbolInfoDouble(Sym, SYMBOL_BID) > 100.0) ? 10 : 1;

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpMaxDeviation);

   long fill = SymbolInfoInteger(Sym, SYMBOL_FILLING_MODE);
   if((fill & SYMBOL_FILLING_FOK) != 0)      trade.SetTypeFilling(ORDER_FILLING_FOK);
   else if((fill & SYMBOL_FILLING_IOC) != 0) trade.SetTypeFilling(ORDER_FILLING_IOC);
   else                                       trade.SetTypeFilling(ORDER_FILLING_RETURN);

   avgSpread = (double)SymbolInfoInteger(Sym, SYMBOL_SPREAD);
   lastBid   = SymbolInfoDouble(Sym, SYMBOL_BID);

   PrintFormat("GoldBreakoutScalper init | symbol=%s digits=%d scale=x%d mode=%s",
               Sym, digits, Scale, (InpMode==MODE_HIGH_PROB ? "HIGH_PROB" : "HIGH_FREQ"));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(SymbolInfoDouble(Sym, SYMBOL_BID) <= 0.0) return;

   // Panic check must run before anything else updates lastBid/avgSpread
   if(InpPanicClose && PanicGapDetected())
   {
      CloseAllPositions();
      CancelAllPendingOrders();
      return;
   }

   if(InpFridayClose && IsFridayFlatTime())
   {
      CloseAllPositions();
      CancelAllPendingOrders();
      return;
   }

   UpdateSpreadAverage();
   ManagePositions();

   if(!SpreadOK()) return;
   if(InpNewsFilter && SpreadSpike()) return;
   if(TimeCurrent() < cooldownUntil) return;

   datetime bt = iTime(Sym, _Period, 0);
   if(bt != lastBarTime)
   {
      lastBarTime = bt;
      RefreshPendingOrders();
   }
}

//+------------------------------------------------------------------+
//| Track a simple rolling average spread to detect news-like spikes |
//+------------------------------------------------------------------+
void UpdateSpreadAverage()
{
   double cur = (double)SymbolInfoInteger(Sym, SYMBOL_SPREAD);
   avgSpread = (avgSpread <= 0.0) ? cur : (avgSpread * 0.98 + cur * 0.02);
   // NOTE: lastBid is intentionally NOT touched here - PanicGapDetected()
   // owns that update, and must run first each tick so it compares against
   // the *previous* tick's price, not the current one.
}

bool SpreadSpike()
{
   double cur = (double)SymbolInfoInteger(Sym, SYMBOL_SPREAD);
   return (avgSpread > 0.0 && cur > avgSpread * InpSpreadSpikeMult);
}

bool SpreadOK()
{
   return SymbolInfoInteger(Sym, SYMBOL_SPREAD) <= (long)InpMaxSpread_Points * Scale;
}

//+------------------------------------------------------------------+
//| Detect an abnormal price gap vs the last observed tick (panic)   |
//+------------------------------------------------------------------+
bool PanicGapDetected()
{
   double bid = SymbolInfoDouble(Sym, SYMBOL_BID);
   if(lastBid <= 0.0) { lastBid = bid; return false; }
   double gap = MathAbs(bid - lastBid);
   bool panic = gap >= P(InpPanicGapPoints);
   lastBid = bid;
   return panic;
}

bool IsFridayFlatTime()
{
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   return (t.day_of_week == 5 && t.hour >= InpFridayCloseHour);
}

//+------------------------------------------------------------------+
//| Manage open positions: breakeven, smart/tight trailing exit      |
//+------------------------------------------------------------------+
void ManagePositions()
{
   double trail = P(InpTrail_Points);
   if(InpTrailingSmart)
   {
      double spreadNow = (double)SymbolInfoInteger(Sym, SYMBOL_SPREAD) * Pt;
      trail = MathMax(trail, spreadNow * 1.5);
   }
   double stopLvl = SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL) * Pt;
   double minDist = MathMax(trail, stopLvl + Pt);
   double be      = P(InpBreakEven_Points);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Sym) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;

      long   type  = PositionGetInteger(POSITION_TYPE);
      double open  = PositionGetDouble(POSITION_PRICE_OPEN);
      double curSL = PositionGetDouble(POSITION_SL);
      double curTP = PositionGetDouble(POSITION_TP);
      double profitDist;
      double newSL = 0.0;
      double dist  = MathMax(trail, minDist); // never trail tighter than broker allows

      if(type == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(Sym, SYMBOL_BID);
         profitDist = bid - open;

         if(InpBreakEven_Points > 0 && profitDist >= be && curSL < open)
         {
            // Only move to breakeven if that's not tighter than the broker's
            // minimum stop distance from the current price.
            if(bid - open >= minDist)
               trade.PositionModify(ticket, NormalizeDouble(open, _Digits), curTP);
            continue;
         }
         if(InpHighProfitTrail && profitDist > trail * 5.0)
            dist = MathMax(trail * 2.0, minDist); // loosen trail to let a strong trend run

         newSL = NormalizeDouble(bid - dist, _Digits);
         if(newSL < open) continue;
         if(newSL <= curSL + Pt) continue;
      }
      else
      {
         double ask = SymbolInfoDouble(Sym, SYMBOL_ASK);
         profitDist = open - ask;

         if(InpBreakEven_Points > 0 && profitDist >= be && (curSL > open || curSL == 0.0))
         {
            if(open - ask >= minDist)
               trade.PositionModify(ticket, NormalizeDouble(open, _Digits), curTP);
            continue;
         }
         if(InpHighProfitTrail && profitDist > trail * 5.0)
            dist = MathMax(trail * 2.0, minDist);

         newSL = NormalizeDouble(ask + dist, _Digits);
         if(newSL > open) continue;
         if(curSL > 0.0 && newSL >= curSL - Pt) continue;
      }
      if(!trade.PositionModify(ticket, newSL, curTP))
         PrintFormat("PositionModify failed ticket=%I64u retcode=%d (%s)",
                      ticket, trade.ResultRetcode(), trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| Place/refresh breakout stop orders                                |
//+------------------------------------------------------------------+
void RefreshPendingOrders()
{
   if(CountPositions() >= InpMaxPositions) return;

   int neededBars = MathMax(InpSwingLookback, InpTouchLookback) + 2;
   if(Bars(Sym, _Period) < neededBars) return; // not enough history loaded yet

   int hi = iHighest(Sym, _Period, MODE_HIGH, InpSwingLookback, 1);
   int lo = iLowest (Sym, _Period, MODE_LOW,  InpSwingLookback, 1);
   if(hi < 0 || lo < 0) return;

   double swingHigh = iHigh(Sym, _Period, hi);
   double swingLow  = iLow (Sym, _Period, lo);

   if(InpMode == MODE_HIGH_PROB)
   {
      if(TouchCount(swingHigh, true)  < InpMinTouches) return;
      if(TouchCount(swingLow,  false) < InpMinTouches) return;
      if(!TrendFilterOK(swingHigh, true))  return; // only take longs aligned with trend
      if(!TrendFilterOK(swingLow,  false)) return; // only take shorts aligned with trend
   }

   double ask     = SymbolInfoDouble(Sym, SYMBOL_ASK);
   double bid     = SymbolInfoDouble(Sym, SYMBOL_BID);
   double shift   = P(InpShift_Points);
   double stopLvl = SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL) * Pt;

   double buyPrice  = MathMax(swingHigh, ask + shift);
   double sellPrice = MathMin(swingLow,  bid - shift);
   buyPrice  = MathMax(buyPrice,  ask + stopLvl + Pt);
   sellPrice = MathMin(sellPrice, bid - stopLvl - Pt);
   buyPrice  = NormalizeDouble(buyPrice,  _Digits);
   sellPrice = NormalizeDouble(sellPrice, _Digits);

   bool canExpire = ((SymbolInfoInteger(Sym, SYMBOL_EXPIRATION_MODE) & SYMBOL_EXPIRATION_SPECIFIED) != 0);
   ENUM_ORDER_TYPE_TIME tmode  = canExpire ? ORDER_TIME_SPECIFIED : ORDER_TIME_GTC;
   datetime              expiry = canExpire ? TimeCurrent() + (datetime)InpExpiryDays * 86400 : 0;

   double lot = CalcLot();
   if(lot <= 0.0) return;

   if(!HasNearbyOrder(ORDER_TYPE_BUY_STOP, buyPrice))
   {
      double sl = NormalizeDouble(buyPrice - P(InpSL_Points), _Digits);
      double tp = NormalizeDouble(buyPrice + P(InpTP_Points), _Digits);
      if(!trade.BuyStop(lot, buyPrice, Sym, sl, tp, tmode, expiry, "GBS breakout"))
         PrintFormat("BuyStop failed retcode=%d (%s) price=%.5f sl=%.5f tp=%.5f",
                      trade.ResultRetcode(), trade.ResultRetcodeDescription(), buyPrice, sl, tp);
   }
   if(!HasNearbyOrder(ORDER_TYPE_SELL_STOP, sellPrice))
   {
      double sl = NormalizeDouble(sellPrice + P(InpSL_Points), _Digits);
      double tp = NormalizeDouble(sellPrice - P(InpTP_Points), _Digits);
      if(!trade.SellStop(lot, sellPrice, Sym, sl, tp, tmode, expiry, "GBS breakout"))
         PrintFormat("SellStop failed retcode=%d (%s) price=%.5f sl=%.5f tp=%.5f",
                      trade.ResultRetcode(), trade.ResultRetcodeDescription(), sellPrice, sl, tp);
   }
}

//+------------------------------------------------------------------+
//| Count how many times price has approached a level (HIGH_PROB)    |
//+------------------------------------------------------------------+
int TouchCount(const double level, const bool isHigh)
{
   int touches = 0;
   double tol = P(InpShift_Points) * 0.5;
   for(int i = 1; i <= InpTouchLookback; i++)
   {
      double v = isHigh ? iHigh(Sym, _Period, i) : iLow(Sym, _Period, i);
      if(MathAbs(v - level) <= tol) touches++;
   }
   return touches;
}

//+------------------------------------------------------------------+
//| Only take breakouts aligned with the moving-average trend        |
//+------------------------------------------------------------------+
bool TrendFilterOK(const double level, const bool isBuySide)
{
   int maHandle = iMA(Sym, _Period, InpTrendMA_Period, 0, MODE_SMA, PRICE_CLOSE);
   if(maHandle == INVALID_HANDLE) return true; // fail-open if MA unavailable
   double buf[];
   if(CopyBuffer(maHandle, 0, 1, 1, buf) <= 0) return true;
   double ma = buf[0];
   IndicatorRelease(maHandle);

   return isBuySide ? (level >= ma) : (level <= ma);
}

//+------------------------------------------------------------------+
bool HasNearbyOrder(const ENUM_ORDER_TYPE type, const double price)
{
   double gap = P(InpOrderGap_Points);
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != Sym) continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;
      if((ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE) != type) continue;
      if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN) - price) < gap) return true;
   }
   return false;
}

//+------------------------------------------------------------------+
double CalcLot()
{
   double step = SymbolInfoDouble(Sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(Sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(Sym, SYMBOL_VOLUME_MAX);
   if(step <= 0.0) return 0.0;

   double lot;
   if(InpLotMode == LOT_FIXED)
   {
      lot = InpFixedLot;
   }
   else
   {
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      if(InpBalanceDiv <= 0.0) return 0.0;
      lot = (bal / InpBalanceDiv) * 0.01;
      lot = MathFloor(lot / step) * step;
   }
   return MathMax(vmin, MathMin(vmax, lot));
}

//+------------------------------------------------------------------+
int CountPositions()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == Sym && PositionGetInteger(POSITION_MAGIC) == InpMagic)
         n++;
   }
   return n;
}

//+------------------------------------------------------------------+
void CloseAllPositions()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Sym) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(!trade.PositionClose(ticket, InpMaxDeviation))
         PrintFormat("PositionClose failed ticket=%I64u retcode=%d (%s)",
                      ticket, trade.ResultRetcode(), trade.ResultRetcodeDescription());
   }
}

void CancelAllPendingOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != Sym) continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;
      trade.OrderDelete(ticket);
   }
}

//+------------------------------------------------------------------+
//| On fill: cancel the now-obsolete opposite pending order, and     |
//| start a cooldown timer if the closing trade was a loss.          |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                         const MqlTradeRequest &request,
                         const MqlTradeResult &result)
{
   if(trans.symbol != Sym) return;

   if(trans.type == TRADE_TRANSACTION_DEAL_ADD)
   {
      long dealEntry = 0;
      if(HistoryDealSelect(trans.deal))
      {
         dealEntry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
         if(HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagic) return;

         if(dealEntry == DEAL_ENTRY_IN)
         {
            // A pending order was triggered -> cancel the opposite side
            CancelAllPendingOrders();
         }
         else if(dealEntry == DEAL_ENTRY_OUT || dealEntry == DEAL_ENTRY_OUT_BY)
         {
            double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT)
                           + HistoryDealGetDouble(trans.deal, DEAL_SWAP)
                           + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
            if(profit < 0.0 && InpCooldownSeconds > 0)
               cooldownUntil = TimeCurrent() + InpCooldownSeconds;
         }
      }
   }
}
//+------------------------------------------------------------------+
