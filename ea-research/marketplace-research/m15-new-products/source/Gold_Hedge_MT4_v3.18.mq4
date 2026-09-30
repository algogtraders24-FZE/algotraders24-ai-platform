//+------------------------------------------------------------------+
//| Gold Hedge Algotraders24 - MT4                                   |
//| Version 3.18 - MQL4 Market validation ready                      |
//+------------------------------------------------------------------+
#property copyright "ALGOTRADERS24"
#property version   "3.18"
#property strict
#property description "Trend-following EA for Gold with ATR SL/TP, trailing stop,"
#property description "smart hedge (hedging accounts), session filter and daily limits."

enum ENUM_TRADE_DIR { DIR_BOTH=0, DIR_BUY=1, DIR_SELL=2 };

//--- Inputs
input group "=== Trading Settings ==="
input double   LotSize            = 0.01;
input bool     UseRiskPercent     = false;
input double   RiskPercent        = 1.0;
input int      MagicNumber        = 20260802;
input string   TradeComment       = "ALGOTRADERS24";

input group "=== Trade Direction ==="
input ENUM_TRADE_DIR TradeDirection = DIR_BOTH;

input group "=== Indicator Settings ==="
input int      SMAPeriod          = 100;
input int      FastSMAPeriod      = 20;
input int      SlowSMAPeriod      = 50;
input int      RSIPeriod          = 14;
input double   RSIBuyLevel        = 55.0;
input double   RSISellLevel       = 45.0;

input group "=== Risk Management ==="
input bool     UseATR             = true;
input double   ATR_Multiplier_SL  = 1.5;
input double   ATR_Multiplier_TP  = 2.5;
input int      ATR_Period         = 14;
input double   FixedStopLoss      = 300;     // Fixed SL (points)
input double   FixedTakeProfit    = 500;     // Fixed TP (points)

input group "=== Trailing & Hidden ==="
input bool     UseTrailingStop    = true;
input int      TrailingStart      = 200;     // Profit to start trailing (points)
input int      TrailingStep       = 100;     // Trailing distance (points)
input bool     HiddenStopLoss     = false;
input bool     HiddenTakeProfit   = false;
input bool     HiddenTrailingStop = false;

input group "=== Advanced ==="
input bool     AggressiveMode     = false;
input int      MaxOpenPositions   = 10;
input bool     RecoveryMode       = false;
input double   RecoveryMultiplier = 1.5;
input int      MaxRecoveryLevel   = 3;

input group "=== Smart Hedge (hedging accounts only) ==="
input bool     UseHedge           = true;
input double   HedgeTriggerLoss   = 100.0;   // Loss for 0.05 lot basket (scales up)
input int      HedgeMagic         = 20260803;

input group "=== Force Close ==="
input bool     UseForceCloseProfit = true;
input double   ForceCloseProfit    = 100.0;

input group "=== Daily Limits ==="
input bool     UseDailyProfit     = true;
input double   DailyProfitTarget  = 50.0;
input bool     UseMaxDrawdown     = true;
input double   MaxDailyDrawdown   = 30.0;
input int      MaxDailyTrades     = 30;

input group "=== Trading Sessions (Broker Time) ==="
input bool     UseSessionFilter   = true;
input bool     TradeAsian         = true;
input int      AsianStartHour     = 0;
input int      AsianEndHour       = 8;
input bool     TradeLondon        = true;
input int      LondonStartHour    = 7;
input int      LondonEndHour      = 16;
input bool     TradeNewYork       = true;
input int      NYStartHour        = 12;
input int      NYEndHour          = 21;

input group "=== Spread ==="
input int      MaxSpread          = 600;     // Max spread (points)

input group "=== Entry Filter ==="
input int      CooldownBars       = 5;
input double   MinCandleBodyATR   = 0.3;

input group "=== Debug & Display ==="
input bool     DebugMode          = false;
input bool     ShowPanel          = true;

//--- Globals
datetime lastBarTime       = 0;
datetime lastTradeBarTime  = 0;
int      dailyTrades       = 0;
int      consecutiveLosses = 0;

int      g_digits   = 2;
double   g_point    = 0.01;
double   g_tickSize = 0.01;
int      g_slippage = 50;

int      hedgeFails    = 0;
datetime lastHedgeTry  = 0;

int      g_histTotal   = -1;
datetime g_cacheDay    = 0;
double   g_closedToday = 0;

struct HiddenOrderData
{
   int    ticket;
   double hiddenSL;
   double hiddenTP;
   bool   trailActive;
};
HiddenOrderData hiddenOrders[];

//+------------------------------------------------------------------+
//| Price / volume helpers                                           |
//+------------------------------------------------------------------+
double NormalizePrice(double price)
{
   if(g_tickSize > 0) price = MathRound(price / g_tickSize) * g_tickSize;
   return NormalizeDouble(price, g_digits);
}
double PointsToPrice(double points) { return points * g_point; }
double StopsDist()  { return MarketInfo(Symbol(), MODE_STOPLEVEL)   * g_point; }
double FreezeDist() { return MarketInfo(Symbol(), MODE_FREEZELEVEL) * g_point; }
double SafeGap()    { return StopsDist() + MathMax(2 * g_point, 2 * g_tickSize); }

double NormalizeLot(double lot)
{
   double minL = MarketInfo(Symbol(), MODE_MINLOT);
   double maxL = MarketInfo(Symbol(), MODE_MAXLOT);
   double step = MarketInfo(Symbol(), MODE_LOTSTEP);
   if(step <= 0) step = (minL > 0) ? minL : 0.01;

   lot = MathFloor(lot / step + 1e-9) * step;
   if(lot < minL) lot = minL;
   if(lot > maxL) lot = maxL;
   int d = (int)MathMax(0, MathCeil(-MathLog10(step) - 1e-9));
   return NormalizeDouble(lot, d);
}

//+------------------------------------------------------------------+
//| Market validation checks                                         |
//+------------------------------------------------------------------+
bool CheckMoney(int type, double lot)
{
   ResetLastError();
   double fm  = AccountFreeMarginCheck(Symbol(), type, lot);
   int    err = GetLastError();
   if(fm <= 0 || err == 134)
   {
      if(DebugMode) Print("Not enough money for ", DoubleToString(lot, 2), " lot");
      return false;
   }
   return true;
}

bool CheckStopsOK(int type, double sl, double tp)
{
   double d = StopsDist();
   if(type == OP_BUY)
      return (sl == 0 || Bid - sl > d) && (tp == 0 || tp - Bid > d);
   return (sl == 0 || sl - Ask > d) && (tp == 0 || Ask - tp > d);
}

bool CanOpen(int type, double lot, double sl, double tp)
{
   if(!IsTradeAllowed()) return false;
   if(MarketInfo(Symbol(), MODE_TRADEALLOWED) == 0) return false;

   double minL = MarketInfo(Symbol(), MODE_MINLOT);
   double maxL = MarketInfo(Symbol(), MODE_MAXLOT);
   if(lot < minL || lot > maxL) return false;

   if(!CheckMoney(type, lot)) return false;
   if(!CheckStopsOK(type, sl, tp))
   {
      if(DebugMode) Print("Invalid SL/TP skipped");
      return false;
   }
   return true;
}

// Push SL/TP outside the broker stops level
void AdjustStops(int type, double &sl, double &tp)
{
   double gap = SafeGap();
   if(type == OP_BUY)
   {
      if(Bid - sl < gap) sl = Bid - gap;
      if(tp - Bid < gap) tp = Bid + gap;
   }
   else
   {
      if(sl - Ask < gap) sl = Ask + gap;
      if(Ask - tp < gap) tp = Ask - gap;
   }
   sl = NormalizePrice(sl);
   tp = NormalizePrice(tp);
}

//+------------------------------------------------------------------+
//| Sessions                                                         |
//+------------------------------------------------------------------+
bool InRange(int h, int from, int to)
{
   if(from < to) return (h >= from && h < to);
   return (h >= from || h < to);
}

bool IsAllowedSession()
{
   if(!UseSessionFilter) return true;
   int h = TimeHour(TimeCurrent());

   if(TradeAsian   && InRange(h, AsianStartHour,  AsianEndHour))  return true;
   if(TradeLondon  && InRange(h, LondonStartHour, LondonEndHour)) return true;
   if(TradeNewYork && InRange(h, NYStartHour,     NYEndHour))     return true;
   return false;
}

string GetCurrentSessionName()
{
   int h = TimeHour(TimeCurrent());
   if(InRange(h, AsianStartHour,  AsianEndHour))  return "Asian";
   if(InRange(h, LondonStartHour, LondonEndHour)) return "London";
   if(InRange(h, NYStartHour,     NYEndHour))     return "New York";
   return "Off Session";
}

//+------------------------------------------------------------------+
int OnInit()
{
   g_digits   = Digits;
   g_point    = Point;
   g_tickSize = MarketInfo(Symbol(), MODE_TICKSIZE);
   if(g_point <= 0)    g_point    = MathPow(10.0, -g_digits);
   if(g_tickSize <= 0) g_tickSize = g_point;

   if(LotSize <= 0 || RiskPercent <= 0 || SMAPeriod <= 0 || FastSMAPeriod <= 0 ||
      SlowSMAPeriod <= 0 || RSIPeriod <= 0 || ATR_Period <= 0 || MaxOpenPositions <= 0)
   {
      Print("ERROR: Invalid input parameters");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(ShowPanel && !IsTesting() && !IsOptimization())
      EventSetTimer(1);

   Print("Gold Hedge Algotraders24 v3.18 (MT4) started on ", Symbol());
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

//+------------------------------------------------------------------+
//| Positions                                                        |
//+------------------------------------------------------------------+
bool SelectMine(int idx, int magic)
{
   if(!OrderSelect(idx, SELECT_BY_POS, MODE_TRADES)) return false;
   if(OrderSymbol() != Symbol() || OrderMagicNumber() != magic) return false;
   return (OrderType() == OP_BUY || OrderType() == OP_SELL);
}

int CountOpenPositions()
{
   int cnt = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(SelectMine(i, MagicNumber)) cnt++;
   return cnt;
}

bool HedgeExists()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
      if(SelectMine(i, HedgeMagic)) return true;
   return false;
}

// Basket info - only when all positions are in one direction
bool GetSameDirectionBasket(double &totalLot, double &floatingProfit, int &direction)
{
   totalLot = 0; floatingProfit = 0; direction = -1;
   int    buyCount = 0, sellCount = 0;
   double buyLot = 0, sellLot = 0, buyFloat = 0, sellFloat = 0;

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!SelectMine(i, MagicNumber)) continue;
      double vol = OrderLots();
      double prf = OrderProfit() + OrderSwap() + OrderCommission();

      if(OrderType() == OP_BUY)
      { buyCount++;  buyLot  += vol; buyFloat  += prf; }
      else
      { sellCount++; sellLot += vol; sellFloat += prf; }
   }

   if(buyCount > 0 && sellCount == 0)
   { totalLot = buyLot;  floatingProfit = buyFloat;  direction = OP_BUY;  return true; }
   if(sellCount > 0 && buyCount == 0)
   { totalLot = sellLot; floatingProfit = sellFloat; direction = OP_SELL; return true; }
   return false;
}

bool ClosePosition(int ticket)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET)) return false;
   if(OrderCloseTime() != 0) return true;
   RefreshRates();
   double price = (OrderType() == OP_BUY) ? Bid : Ask;
   bool ok = OrderClose(ticket, OrderLots(), NormalizePrice(price), g_slippage, clrNONE);
   if(!ok) Print("Close failed: error ", GetLastError());
   return ok;
}

int SendOrder(int type, double lot, double price, double sl, double tp, string cmt, int magic)
{
   color c = (type == OP_BUY) ? clrLime : clrRed;
   int t = OrderSend(Symbol(), type, lot, NormalizePrice(price), g_slippage, sl, tp, cmt, magic, 0, c);
   if(t < 0) Print("Order failed: error ", GetLastError());
   return t;
}

//+------------------------------------------------------------------+
//| Force close all in profit                                        |
//+------------------------------------------------------------------+
void CheckForceCloseAll()
{
   if(!UseForceCloseProfit) return;

   double totalFloating = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(SelectMine(i, MagicNumber) || SelectMine(i, HedgeMagic))
         totalFloating += OrderProfit() + OrderSwap() + OrderCommission();
   }
   if(totalFloating < ForceCloseProfit) return;

   Print("Force close all | Profit = ", DoubleToString(totalFloating, 2));
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(SelectMine(i, MagicNumber) || SelectMine(i, HedgeMagic))
         ClosePosition(OrderTicket());
   }
   ArrayResize(hiddenOrders, 0);
}

//+------------------------------------------------------------------+
//| Smart hedge                                                      |
//+------------------------------------------------------------------+
void CheckAndOpenHedge()
{
   if(!UseHedge || !AggressiveMode || HedgeExists()) return;
   if(hedgeFails >= 3) return;                              // broker does not allow hedging
   if(TimeCurrent() - lastHedgeTry < 60) return;

   double totalLot = 0, floating = 0;
   int    dir = -1;
   if(!GetSameDirectionBasket(totalLot, floating, dir) || totalLot <= 0) return;

   double trigger = HedgeTriggerLoss * MathMax(1.0, totalLot / 0.05);
   if(floating > -trigger) return;

   double atr = iATR(NULL, 0, ATR_Period, 0);
   if(UseATR && atr <= 0) return;

   double slPts = UseATR ? (atr / g_point * ATR_Multiplier_SL) : FixedStopLoss;
   double tpPts = UseATR ? (atr / g_point * ATR_Multiplier_TP) : FixedTakeProfit;

   RefreshRates();
   int    htype = (dir == OP_BUY) ? OP_SELL : OP_BUY;
   double price = (htype == OP_SELL) ? Bid : Ask;
   double sl, tp;
   if(htype == OP_SELL)
   { sl = price + PointsToPrice(slPts); tp = price - PointsToPrice(tpPts); }
   else
   { sl = price - PointsToPrice(slPts); tp = price + PointsToPrice(tpPts); }
   AdjustStops(htype, sl, tp);

   double lot = NormalizeLot(totalLot);
   if(!CanOpen(htype, lot, sl, tp)) return;

   lastHedgeTry = TimeCurrent();
   int t = SendOrder(htype, lot, price, sl, tp, "Hedge", HedgeMagic);
   if(t > 0)
   {
      hedgeFails = 0;
      Print("Hedge opened | Lot=", DoubleToString(lot, 2), " | Floating=", DoubleToString(floating, 2));
   }
   else hedgeFails++;
}

//+------------------------------------------------------------------+
void OnTick()
{
   RefreshRates();
   CheckDailyReset();

   // Management always runs (not blocked by filters)
   ManageHiddenOrders();
   ManageTrailing();
   CheckForceCloseAll();

   if(ShowPanel && IsTesting() && IsVisualMode()) UpdatePanel();

   if(CheckDailyLimits()) return;
   if((int)MarketInfo(Symbol(), MODE_SPREAD) > MaxSpread) return;

   CheckAndOpenHedge();

   if(!IsAllowedSession()) return;

   int currentOpen = CountOpenPositions();
   if(!AggressiveMode && currentOpen > 0) return;
   if(AggressiveMode && currentOpen >= MaxOpenPositions) return;
   if(HedgeExists()) return;
   if(dailyTrades >= MaxDailyTrades) return;

   if(CooldownBars > 0 && lastTradeBarTime > 0)
      if(iBarShift(Symbol(), 0, lastTradeBarTime) < CooldownBars) return;

   datetime barTime = iTime(Symbol(), 0, 0);
   if(barTime == 0 || barTime == lastBarTime) return;
   lastBarTime = barTime;

   ExecuteEntryLogic();
}

//+------------------------------------------------------------------+
void OnTimer()
{
   if(ShowPanel) UpdatePanel();
}

void UpdatePanel()
{
   double total = GetClosedProfitToday() + (AccountEquity() - AccountBalance());
   double totalLot = 0, floatP = 0;
   int    dir = -1;
   GetSameDirectionBasket(totalLot, floatP, dir);
   double dynTrigger = HedgeTriggerLoss * MathMax(1.0, totalLot / 0.05);

   string s = "";
   s += "===================================\n";
   s += " GOLD HEDGE ALGOTRADERS24 v3.18\n";
   s += "===================================\n";
   s += " Daily P/L: " + DoubleToString(total, 2) + "\n";
   s += " Open Pos: " + IntegerToString(CountOpenPositions()) + " / " + IntegerToString(MaxOpenPositions) + "\n";
   s += " Open Lot: " + DoubleToString(totalLot, 2) + "\n";
   s += " Hedge Trigger: " + DoubleToString(dynTrigger, 1) + "\n";
   s += " Hedge Active: " + (HedgeExists() ? "YES" : "NO") + "\n";
   s += " Force Close At: " + DoubleToString(ForceCloseProfit, 1) + "\n";
   s += " Session: " + GetCurrentSessionName() + "\n";
   s += "===================================\n";
   Comment(s);
}

//+------------------------------------------------------------------+
void ExecuteEntryLogic()
{
   if(Bars < SMAPeriod + 10) return;

   double sma  = iMA(NULL, 0, SMAPeriod,     0, MODE_SMA, PRICE_CLOSE, 1);
   double fast = iMA(NULL, 0, FastSMAPeriod, 0, MODE_SMA, PRICE_CLOSE, 1);
   double slow = iMA(NULL, 0, SlowSMAPeriod, 0, MODE_SMA, PRICE_CLOSE, 1);
   double rsi  = iRSI(NULL, 0, RSIPeriod, PRICE_CLOSE, 1);
   double atr  = iATR(NULL, 0, ATR_Period, 1);

   double close1 = iClose(Symbol(), 0, 1);
   double open1  = iOpen(Symbol(), 0, 1);
   double high1  = iHigh(Symbol(), 0, 1);
   double low1   = iLow(Symbol(), 0, 1);
   double close2 = iClose(Symbol(), 0, 2);
   if(close1 == 0 || close2 == 0 || atr <= 0 || sma == 0) return;

   if(MathAbs(close1 - open1) < atr * MinCandleBodyATR) return;

   double slPts = UseATR ? (atr / g_point * ATR_Multiplier_SL) : FixedStopLoss;
   double tpPts = UseATR ? (atr / g_point * ATR_Multiplier_TP) : FixedTakeProfit;
   double lot   = CalculateLotSize(slPts);

   bool buySignal = false, sellSignal = false;

   if(TradeDirection != DIR_SELL &&
      close1 > sma && fast > slow && (fast - slow) > atr * 0.15 &&
      rsi > RSIBuyLevel && close1 > open1 && close1 > close2 &&
      close1 > high1 - (high1 - low1) * 0.3)
      buySignal = true;

   if(TradeDirection != DIR_BUY &&
      close1 < sma && fast < slow && (slow - fast) > atr * 0.15 &&
      rsi < RSISellLevel && close1 < open1 && close1 < close2 &&
      close1 < low1 + (high1 - low1) * 0.3)
      sellSignal = true;

   if(buySignal == sellSignal) return;
   OpenTrade(buySignal ? OP_BUY : OP_SELL, lot, slPts, tpPts);
}

//+------------------------------------------------------------------+
void OpenTrade(int type, double lot, double slPts, double tpPts)
{
   RefreshRates();
   double price = (type == OP_BUY) ? Ask : Bid;
   double sl, tp;
   if(type == OP_BUY)
   { sl = price - PointsToPrice(slPts); tp = price + PointsToPrice(tpPts); }
   else
   { sl = price + PointsToPrice(slPts); tp = price - PointsToPrice(tpPts); }
   AdjustStops(type, sl, tp);

   double slSend = HiddenStopLoss   ? 0.0 : sl;
   double tpSend = HiddenTakeProfit ? 0.0 : tp;

   if(!CanOpen(type, lot, slSend, tpSend)) return;

   int ticket = SendOrder(type, lot, price, slSend, tpSend, TradeComment, MagicNumber);
   if(ticket < 0) return;

   dailyTrades++;
   lastTradeBarTime = iTime(Symbol(), 0, 0);
   if(DebugMode) Print("Trade opened: ", (type == OP_BUY ? "BUY" : "SELL"), " lot=", DoubleToString(lot, 2));

   if(!(HiddenStopLoss || HiddenTakeProfit || HiddenTrailingStop)) return;

   int n = ArraySize(hiddenOrders);
   ArrayResize(hiddenOrders, n + 1);
   hiddenOrders[n].ticket      = ticket;
   hiddenOrders[n].hiddenSL    = sl;
   hiddenOrders[n].hiddenTP    = tp;
   hiddenOrders[n].trailActive = false;
}

//+------------------------------------------------------------------+
//| Normal (server-side) trailing stop                               |
//+------------------------------------------------------------------+
void ManageTrailing()
{
   if(!UseTrailingStop || HiddenTrailingStop || HiddenStopLoss) return;

   double start  = PointsToPrice(TrailingStart);
   double dist   = MathMax(PointsToPrice(TrailingStep), SafeGap());
   double freeze = FreezeDist();

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!SelectMine(i, MagicNumber)) continue;

      double open = OrderOpenPrice();
      double sl   = OrderStopLoss();
      double tp   = OrderTakeProfit();
      double newSL;

      if(OrderType() == OP_BUY)
      {
         if(Bid - open < start) continue;
         newSL = NormalizePrice(Bid - dist);
         if(sl != 0 && newSL <= sl + g_tickSize / 2) continue;
         if((sl != 0 && Bid - sl <= freeze) || (tp != 0 && tp - Bid <= freeze)) continue;
      }
      else
      {
         if(open - Ask < start) continue;
         newSL = NormalizePrice(Ask + dist);
         if(sl != 0 && newSL >= sl - g_tickSize / 2) continue;
         if((sl != 0 && sl - Ask <= freeze) || (tp != 0 && Ask - tp <= freeze)) continue;
      }

      if(!OrderModify(OrderTicket(), open, newSL, tp, 0, clrNONE))
         Print("Trailing modify failed: error ", GetLastError());
   }
}

//+------------------------------------------------------------------+
//| Hidden SL / TP / trailing                                        |
//+------------------------------------------------------------------+
void RemoveHidden(int idx)
{
   int n = ArraySize(hiddenOrders);
   for(int k = idx; k < n - 1; k++) hiddenOrders[k] = hiddenOrders[k + 1];
   ArrayResize(hiddenOrders, n - 1);
}

void ManageHiddenOrders()
{
   bool hiddenTrail = UseTrailingStop && (HiddenTrailingStop || HiddenStopLoss);
   bool checkSL     = HiddenStopLoss || HiddenTrailingStop;

   for(int i = ArraySize(hiddenOrders) - 1; i >= 0; i--)
   {
      int ticket = hiddenOrders[i].ticket;
      if(!OrderSelect(ticket, SELECT_BY_TICKET) || OrderCloseTime() != 0 || OrderSymbol() != Symbol())
      { RemoveHidden(i); continue; }

      double open    = OrderOpenPrice();
      int    posType = OrderType();
      double curSL   = hiddenOrders[i].hiddenSL;
      double curTP   = hiddenOrders[i].hiddenTP;

      if(hiddenTrail)
      {
         double trailStart = PointsToPrice(TrailingStart);
         double trailDist  = PointsToPrice(TrailingStep);

         if(posType == OP_BUY)
         {
            if((Bid - open) >= trailStart) hiddenOrders[i].trailActive = true;
            if(hiddenOrders[i].trailActive)
            {
               double newSL = NormalizePrice(Bid - trailDist);
               if(curSL == 0 || newSL > curSL) curSL = newSL;
            }
         }
         else
         {
            if((open - Ask) >= trailStart) hiddenOrders[i].trailActive = true;
            if(hiddenOrders[i].trailActive)
            {
               double newSL = NormalizePrice(Ask + trailDist);
               if(curSL == 0 || newSL < curSL) curSL = newSL;
            }
         }
         hiddenOrders[i].hiddenSL = curSL;
      }

      bool closeTrade = false;
      if(checkSL && curSL != 0)
      {
         if(posType == OP_BUY  && Bid <= curSL) closeTrade = true;
         if(posType == OP_SELL && Ask >= curSL) closeTrade = true;
      }
      if(HiddenTakeProfit && curTP != 0)
      {
         if(posType == OP_BUY  && Bid >= curTP) closeTrade = true;
         if(posType == OP_SELL && Ask <= curTP) closeTrade = true;
      }

      if(closeTrade)
      {
         if(ClosePosition(ticket)) RemoveHidden(i);
      }
   }
}

//+------------------------------------------------------------------+
double CalculateLotSize(double slPoints)
{
   double lot = LotSize;

   if(UseRiskPercent && slPoints > 0)
   {
      double riskMoney = AccountBalance() * RiskPercent / 100.0;
      double tickVal   = MarketInfo(Symbol(), MODE_TICKVALUE);
      double tickSz    = MarketInfo(Symbol(), MODE_TICKSIZE);
      if(tickVal > 0 && tickSz > 0)
      {
         double ticks = (slPoints * g_point) / tickSz;
         if(ticks > 0) lot = riskMoney / (ticks * tickVal);
      }
   }

   if(RecoveryMode && consecutiveLosses > 0 && consecutiveLosses <= MaxRecoveryLevel)
      lot = lot * MathPow(RecoveryMultiplier, consecutiveLosses);

   return NormalizeLot(lot);
}

//+------------------------------------------------------------------+
//| Daily limits                                                     |
//+------------------------------------------------------------------+
datetime DayStart()
{
   datetime t = TimeCurrent();
   return t - (t % 86400);
}

void CheckDailyReset()
{
   static datetime lastReset = 0;
   datetime today = DayStart();
   if(today != lastReset)
   {
      lastReset   = today;
      dailyTrades = 0;
   }
}

bool CheckDailyLimits()
{
   double total = GetClosedProfitToday() + (AccountEquity() - AccountBalance());
   if(UseDailyProfit && total >= DailyProfitTarget) return true;
   if(UseMaxDrawdown && total <= -MaxDailyDrawdown) return true;
   return false;
}

// Closed profit today (cached, recalculated only when history changes).
// Also updates the consecutive-loss counter used by Recovery Mode.
double GetClosedProfitToday()
{
   datetime ds    = DayStart();
   int      total = OrdersHistoryTotal();
   if(total == g_histTotal && ds == g_cacheDay) return g_closedToday;

   g_histTotal = total;
   g_cacheDay  = ds;

   double   profit = 0;
   datetime ct[];
   double   pr[];
   int      n = 0;

   for(int i = total - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderCloseTime() < ds) continue;
      if(OrderSymbol() != Symbol()) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;

      int mg = OrderMagicNumber();
      if(mg != MagicNumber && mg != HedgeMagic) continue;

      double p = OrderProfit() + OrderSwap() + OrderCommission();
      profit += p;

      if(mg == MagicNumber)
      {
         ArrayResize(ct, n + 1);
         ArrayResize(pr, n + 1);
         ct[n] = OrderCloseTime();
         pr[n] = OrderProfit() + OrderSwap();
         n++;
      }
   }
   g_closedToday = profit;

   if(RecoveryMode)
   {
      int  losses = 0;
      bool used[];
      ArrayResize(used, n);
      for(int k = 0; k < n; k++) used[k] = false;

      for(int k = 0; k < n; k++)
      {
         int best = -1;
         for(int j = 0; j < n; j++)
            if(!used[j] && (best < 0 || ct[j] > ct[best])) best = j;
         if(best < 0) break;
         used[best] = true;
         if(pr[best] < 0) losses++;
         else break;
      }
      consecutiveLosses = losses;
   }
   return g_closedToday;
}
//+------------------------------------------------------------------+
