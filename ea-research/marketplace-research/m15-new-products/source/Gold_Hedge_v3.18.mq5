//+------------------------------------------------------------------+
//| ALGOTRADERS24 Gold Scalper                                       |
//| Version 3.18 - Real Position-ID trade log (instrumentation only, |
//| no trading-logic change from v3.17 "Hedge Fixed for Multiple     |
//| Positions"). Adds OnTradeTransaction logging of MT5's own real   |
//| DEAL_POSITION_ID for every real deal to a CSV file, so a         |
//| Strategy Tester report from this build can be paired exactly     |
//| (no FIFO/timestamp guessing) even when many same-direction       |
//| positions are open at once or partial closes occur.              |
//+------------------------------------------------------------------+
#property copyright "ALGOTRADERS24"
#property version   "3.18"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\SymbolInfo.mqh>
#include <Trade\AccountInfo.mqh>

CTrade         trade;
CPositionInfo  posInfo;
CSymbolInfo    symInfo;
CAccountInfo   accInfo;

//--- Real Position-ID trade log (v3.18) -- one row per real MT5 deal,
//    carrying MT5's own internal DEAL_POSITION_ID so post-processing can
//    pair every entry/exit exactly instead of guessing from price/time.
int g_posLogHandle = INVALID_HANDLE;

//--- Inputs
input group "=== Trading Settings ==="
input double   LotSize            = 0.01;
input bool     UseRiskPercent     = false;
input double   RiskPercent        = 1.0;
input int      MagicNumber        = 20260802;
input string   TradeComment       = "ALGOTRADERS24";

input group "=== Trade Direction ==="
enum ENUM_TRADE_DIR { DIR_BOTH=0, DIR_BUY=1, DIR_SELL=2 };
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
input double   FixedStopLoss      = 300;
input double   FixedTakeProfit    = 500;

input group "=== Trailing & Hidden ==="
input bool     UseTrailingStop    = true;
input int      TrailingStart      = 200;
input int      TrailingStep       = 100;
input bool     HiddenStopLoss     = false;
input bool     HiddenTakeProfit   = false;
input bool     HiddenTrailingStop = false;

input group "=== Advanced ==="
input bool     AggressiveMode     = false;
input int      MaxOpenPositions   = 10;
input bool     RecoveryMode       = false;
input double   RecoveryMultiplier = 1.5;
input int      MaxRecoveryLevel   = 3;

input group "=== Smart Hedge ==="
input bool     UseHedge               = true;
input double   HedgeTriggerLoss       = 100.0;   // Base for 0.01 lot (soft scaling)
input int      HedgeMagic             = 20260803;

input group "=== Force Close ==="
input bool     UseForceCloseProfit    = true;
input double   ForceCloseProfit       = 100.0;

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
input int      MaxSpread          = 600;

input group "=== STRICT CONTROL ==="
input int      CooldownBars       = 5;
input double   MinCandleBodyATR   = 0.3;

input group "=== Debug ==="
input bool     DebugMode          = true;

input group "=== Display ==="
input bool     ShowPanel          = true;

//--- Globals
int      handleSMA, handleFastSMA, handleSlowSMA, handleRSI, handleATR;
datetime lastBarTime        = 0;
datetime lastTradeBarTime   = 0;
double   dayStartBalance    = 0;
int      dailyTrades        = 0;
int      consecutiveLosses  = 0;
bool     hedgeActive        = false;

int      g_digits     = 2;
double   g_point      = 0.01;
double   g_tickSize   = 0.01;
int      g_stopsLevel = 0;

struct HiddenOrderData
{
   ulong  ticket;
   double hiddenSL;
   double hiddenTP;
   bool   trailActive;
};
HiddenOrderData hiddenOrders[];

//+------------------------------------------------------------------+
bool InitSymbolInfo()
{
   if(!symInfo.Name(_Symbol) || !symInfo.RefreshRates())
   {
      Print("ERROR: Cannot init symbol ", _Symbol);
      return false;
   }

   g_digits     = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   g_point      = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   g_tickSize   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   g_stopsLevel = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);

   if(g_point <= 0)    g_point    = MathPow(10.0, -g_digits);
   if(g_tickSize <= 0) g_tickSize = g_point;

   Print("ALGOTRADERS24 v3.17 | Hedge Fixed for Multiple Positions");
   return true;
}

double NormalizePrice(double price) { return NormalizeDouble(price, g_digits); }
double PointsToPrice(double points) { return points * g_point; }

//+------------------------------------------------------------------+
bool IsAllowedSession()
{
   if(!UseSessionFilter) return true;

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int hour = dt.hour;
   bool allowed = false;

   if(TradeAsian)
   {
      if(AsianStartHour < AsianEndHour)
      { if(hour >= AsianStartHour && hour < AsianEndHour) allowed = true; }
      else { if(hour >= AsianStartHour || hour < AsianEndHour) allowed = true; }
   }
   if(TradeLondon)
   {
      if(LondonStartHour < LondonEndHour)
      { if(hour >= LondonStartHour && hour < LondonEndHour) allowed = true; }
      else { if(hour >= LondonStartHour || hour < LondonEndHour) allowed = true; }
   }
   if(TradeNewYork)
   {
      if(NYStartHour < NYEndHour)
      { if(hour >= NYStartHour && hour < NYEndHour) allowed = true; }
      else { if(hour >= NYStartHour || hour < NYEndHour) allowed = true; }
   }
   return allowed;
}

string GetCurrentSessionName()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int h = dt.hour;

   if(h >= AsianStartHour && h < AsianEndHour)   return "Asian";
   if(h >= LondonStartHour && h < LondonEndHour) return "London";
   if(h >= NYStartHour && h < NYEndHour)         return "New York";
   return "Off Session";
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(!InitSymbolInfo()) return INIT_FAILED;

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFillingBySymbol(_Symbol);

   handleSMA     = iMA(_Symbol, _Period, SMAPeriod, 0, MODE_SMA, PRICE_CLOSE);
   handleFastSMA = iMA(_Symbol, _Period, FastSMAPeriod, 0, MODE_SMA, PRICE_CLOSE);
   handleSlowSMA = iMA(_Symbol, _Period, SlowSMAPeriod, 0, MODE_SMA, PRICE_CLOSE);
   handleRSI     = iRSI(_Symbol, _Period, RSIPeriod, PRICE_CLOSE);
   handleATR     = iATR(_Symbol, _Period, ATR_Period);

   if(handleSMA == INVALID_HANDLE || handleFastSMA == INVALID_HANDLE ||
      handleSlowSMA == INVALID_HANDLE || handleRSI == INVALID_HANDLE ||
      handleATR == INVALID_HANDLE)
   {
      Print("ERROR: Indicators failed");
      return INIT_FAILED;
   }

   EventSetTimer(1);
   dayStartBalance = accInfo.Balance();

   string logName = "GoldHedge_PositionLog_" + IntegerToString(MagicNumber) + ".csv";
   g_posLogHandle = FileOpen(logName, FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_COMMON, ",");
   if(g_posLogHandle != INVALID_HANDLE)
   {
      FileWrite(g_posLogHandle, "DealTicket", "PositionID", "Time", "Symbol", "Type", "Entry", "Volume", "Price", "Profit", "Commission", "Swap", "Comment");
      FileFlush(g_posLogHandle);
   }
   else
      Print("WARNING: could not open position log file '", logName, "' (error ", GetLastError(), ") - trades will still execute normally, only the diagnostic log is affected.");

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(handleSMA);
   IndicatorRelease(handleFastSMA);
   IndicatorRelease(handleSlowSMA);
   IndicatorRelease(handleRSI);
   IndicatorRelease(handleATR);
   EventKillTimer();
   Comment("");
   if(g_posLogHandle != INVALID_HANDLE)
      FileClose(g_posLogHandle);
}

//+------------------------------------------------------------------+
//| Real Position-ID trade log (v3.18) -- fires on every real deal   |
//| MT5 records (open, close, partial close) and writes MT5's own    |
//| internal DEAL_POSITION_ID alongside it. This is instrumentation  |
//| only: it reads real, already-recorded deal history via           |
//| HistoryDealGet*() and never influences trading logic or timing.  |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(g_posLogHandle == INVALID_HANDLE) return;
   if(!HistoryDealSelect(trans.deal)) return;

   long   positionId = HistoryDealGetInteger(trans.deal, DEAL_POSITION_ID);
   string symbol     = HistoryDealGetString(trans.deal, DEAL_SYMBOL);
   if(symbol != _Symbol) return;  // only this EA's own instrument's real deals

   ENUM_DEAL_TYPE  dType  = (ENUM_DEAL_TYPE)HistoryDealGetInteger(trans.deal, DEAL_TYPE);
   ENUM_DEAL_ENTRY dEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   datetime dTime   = (datetime)HistoryDealGetInteger(trans.deal, DEAL_TIME);
   double   dVolume = HistoryDealGetDouble(trans.deal, DEAL_VOLUME);
   double   dPrice  = HistoryDealGetDouble(trans.deal, DEAL_PRICE);
   double   dProfit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT);
   double   dComm   = HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
   double   dSwap   = HistoryDealGetDouble(trans.deal, DEAL_SWAP);
   string   dComment = HistoryDealGetString(trans.deal, DEAL_COMMENT);

   FileWrite(g_posLogHandle,
      IntegerToString(trans.deal), IntegerToString(positionId),
      TimeToString(dTime, TIME_DATE | TIME_SECONDS), symbol,
      EnumToString(dType), EnumToString(dEntry),
      DoubleToString(dVolume, 2), DoubleToString(dPrice, _Digits),
      DoubleToString(dProfit, 2), DoubleToString(dComm, 2), DoubleToString(dSwap, 2),
      dComment);
   FileFlush(g_posLogHandle);
}

//+------------------------------------------------------------------+
//| Improved Basket Info – only same direction positions             |
//+------------------------------------------------------------------+
bool GetSameDirectionBasket(double &totalLot, double &floatingProfit, long &direction)
{
   totalLot = 0;
   floatingProfit = 0;
   direction = -1;
   int buyCount = 0, sellCount = 0;
   double buyLot = 0, sellLot = 0;
   double buyFloat = 0, sellFloat = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != MagicNumber) continue;
      if(posInfo.Symbol() != _Symbol) continue;

      double vol = posInfo.Volume();
      double prf = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();

      if(posInfo.PositionType() == POSITION_TYPE_BUY)
      {
         buyCount++;
         buyLot += vol;
         buyFloat += prf;
      }
      else
      {
         sellCount++;
         sellLot += vol;
         sellFloat += prf;
      }
   }

   // Sirf tab hedge jab ek hi direction me positions hon
   if(buyCount > 0 && sellCount == 0)
   {
      totalLot = buyLot;
      floatingProfit = buyFloat;
      direction = POSITION_TYPE_BUY;
      return true;
   }
   if(sellCount > 0 && buyCount == 0)
   {
      totalLot = sellLot;
      floatingProfit = sellFloat;
      direction = POSITION_TYPE_SELL;
      return true;
   }

   return false; // mixed direction → no hedge
}

//+------------------------------------------------------------------+
//| Force Close All in Profit                                        |
//+------------------------------------------------------------------+
void CheckForceCloseAll()
{
   if(!UseForceCloseProfit) return;

   double totalFloating = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol() != _Symbol) continue;

      if(posInfo.Magic() == MagicNumber || posInfo.Magic() == HedgeMagic)
         totalFloating += posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
   }

   if(totalFloating >= ForceCloseProfit)
   {
      Print(">>> FORCE CLOSE ALL | Profit = $", DoubleToString(totalFloating, 2));

      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         if(!posInfo.SelectByIndex(i)) continue;
         if(posInfo.Symbol() != _Symbol) continue;

         if(posInfo.Magic() == MagicNumber || posInfo.Magic() == HedgeMagic)
            trade.PositionClose(posInfo.Ticket());
      }

      hedgeActive = false;
      ArrayResize(hiddenOrders, 0);
   }
}

//+------------------------------------------------------------------+
//| Smart Hedge – Fixed for many positions                           |
//+------------------------------------------------------------------+
void CheckAndOpenHedge()
{
   if(!UseHedge || !AggressiveMode || hedgeActive) return;

   double totalLot = 0;
   double floating = 0;
   long   dir = -1;

   if(!GetSameDirectionBasket(totalLot, floating, dir)) return;
   if(totalLot <= 0) return;

   // Soft Dynamic Trigger (zyada realistic)
   // 0.01 lot → base, phir dheere-dheere badhe
   double dynamicTrigger = HedgeTriggerLoss * MathMax(1.0, totalLot / 0.05);

   if(DebugMode)
      Print("Hedge Check | Lot=", totalLot, " Float=", floating, " Trigger=", dynamicTrigger);

   if(floating > -dynamicTrigger) return;

   // SL/TP
   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(handleATR, 0, 0, 3, atr) < 3) return;

   double slPoints = UseATR ? (atr[0] / g_point * ATR_Multiplier_SL) : FixedStopLoss;
   double tpPoints = UseATR ? (atr[0] / g_point * ATR_Multiplier_TP) : FixedTakeProfit;

   double price = (dir == POSITION_TYPE_BUY) ? symInfo.Bid() : symInfo.Ask();
   price = NormalizePrice(price);

   double slPrice, tpPrice;
   if(dir == POSITION_TYPE_BUY)
   {
      slPrice = NormalizePrice(price + PointsToPrice(slPoints));
      tpPrice = NormalizePrice(price - PointsToPrice(tpPoints));
   }
   else
   {
      slPrice = NormalizePrice(price - PointsToPrice(slPoints));
      tpPrice = NormalizePrice(price + PointsToPrice(tpPoints));
   }

   trade.SetExpertMagicNumber(HedgeMagic);

   bool ok = false;
   if(dir == POSITION_TYPE_BUY)
      ok = trade.Sell(totalLot, _Symbol, price, slPrice, tpPrice, "Hedge");
   else
      ok = trade.Buy(totalLot, _Symbol, price, slPrice, tpPrice, "Hedge");

   trade.SetExpertMagicNumber(MagicNumber);

   if(ok)
   {
      hedgeActive = true;
      Print(">>> HEDGE OPENED | Lot=", totalLot, " | Trigger=$", DoubleToString(dynamicTrigger,1),
            " | Floating was $", DoubleToString(floating,1));
   }
   else
   {
      Print("HEDGE FAILED: ", trade.ResultRetcode(), " - ", trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(!symInfo.RefreshRates()) return;

   CheckDailyReset();
   if(CheckDailyLimits()) return;

   if(!IsAllowedSession()) return;
   if((long)symInfo.Spread() > MaxSpread) return;

   ManageHiddenOrdersAndTrailing();

   // Pehle Hedge check, phir Force Close
   CheckAndOpenHedge();
   CheckForceCloseAll();

   int currentOpen = CountOpenPositions();

   if(!AggressiveMode && currentOpen > 0) return;
   if(AggressiveMode && currentOpen >= MaxOpenPositions) return;

   if(hedgeActive) return;
   if(dailyTrades >= MaxDailyTrades) return;

   if(CooldownBars > 0 && lastTradeBarTime > 0)
   {
      int barsPassed = iBarShift(_Symbol, _Period, lastTradeBarTime);
      if(barsPassed < CooldownBars) return;
   }

   datetime barTime = iTime(_Symbol, _Period, 0);
   if(barTime == lastBarTime) return;
   lastBarTime = barTime;

   ExecuteEntryLogic();
}

//+------------------------------------------------------------------+
void OnTimer()
{
   if(!ShowPanel) return;

   double closed   = GetClosedProfitToday();
   double floating = accInfo.Equity() - accInfo.Balance();
   double total    = closed + floating;

   double totalLot = 0, floatP = 0;
   long dir = -1;
   GetSameDirectionBasket(totalLot, floatP, dir);

   double dynTrigger = (totalLot > 0) ? HedgeTriggerLoss * MathMax(1.0, totalLot / 0.05) : HedgeTriggerLoss;

   string s = "";
   s += "═══════════════════════════════════\n";
   s += " ALGOTRADERS24 GOLD SCALPER v3.17\n";
   s += "═══════════════════════════════════\n";
   s += " Daily P/L: $" + DoubleToString(total, 2) + "\n";
   s += " Open Pos: " + IntegerToString(CountOpenPositions()) + " / " + IntegerToString(MaxOpenPositions) + "\n";
   s += " Open Lot: " + DoubleToString(totalLot, 2) + "\n";
   s += " Hedge Trigger: $" + DoubleToString(dynTrigger, 1) + "\n";
   s += " Hedge Active: " + (hedgeActive ? "YES" : "NO") + "\n";
   s += " Force Close At: $" + DoubleToString(ForceCloseProfit, 1) + "\n";
   s += " Session: " + GetCurrentSessionName() + "\n";
   s += "═══════════════════════════════════\n";
   Comment(s);
}

//+------------------------------------------------------------------+
void ExecuteEntryLogic()
{
   double sma[], fast[], slow[], rsi[], atr[];
   ArraySetAsSeries(sma, true);
   ArraySetAsSeries(fast, true);
   ArraySetAsSeries(slow, true);
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(atr, true);

   if(CopyBuffer(handleSMA, 0, 0, 5, sma) < 5) return;
   if(CopyBuffer(handleFastSMA, 0, 0, 5, fast) < 5) return;
   if(CopyBuffer(handleSlowSMA, 0, 0, 5, slow) < 5) return;
   if(CopyBuffer(handleRSI, 0, 0, 5, rsi) < 5) return;
   if(CopyBuffer(handleATR, 0, 0, 5, atr) < 5) return;

   double close1 = iClose(_Symbol, _Period, 1);
   double open1  = iOpen(_Symbol, _Period, 1);
   double high1  = iHigh(_Symbol, _Period, 1);
   double low1   = iLow(_Symbol, _Period, 1);
   double close2 = iClose(_Symbol, _Period, 2);

   double body = MathAbs(close1 - open1);
   if(atr[1] > 0 && body < atr[1] * MinCandleBodyATR) return;

   double slPoints = UseATR ? (atr[1] / g_point * ATR_Multiplier_SL) : FixedStopLoss;
   double tpPoints = UseATR ? (atr[1] / g_point * ATR_Multiplier_TP) : FixedTakeProfit;

   double lot = CalculateLotSize(slPoints);
   if(lot < SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN)) return;

   bool buySignal  = false;
   bool sellSignal = false;

   if(TradeDirection != DIR_SELL)
   {
      if(close1 > sma[1] && fast[1] > slow[1] &&
         (fast[1] - slow[1]) > atr[1] * 0.15 &&
         rsi[1] > RSIBuyLevel && close1 > open1 && close1 > close2 &&
         close1 > high1 - (high1 - low1) * 0.3)
         buySignal = true;
   }

   if(TradeDirection != DIR_BUY)
   {
      if(close1 < sma[1] && fast[1] < slow[1] &&
         (slow[1] - fast[1]) > atr[1] * 0.15 &&
         rsi[1] < RSISellLevel && close1 < open1 && close1 < close2 &&
         close1 < low1 + (high1 - low1) * 0.3)
         sellSignal = true;
   }

   if(buySignal && sellSignal) return;

   if(buySignal)  OpenTrade(ORDER_TYPE_BUY,  lot, slPoints, tpPoints);
   else if(sellSignal) OpenTrade(ORDER_TYPE_SELL, lot, slPoints, tpPoints);
}

//+------------------------------------------------------------------+
void OpenTrade(ENUM_ORDER_TYPE type, double lot, double slPts, double tpPts)
{
   if(!AggressiveMode && CountOpenPositions() > 0) return;
   if(AggressiveMode && CountOpenPositions() >= MaxOpenPositions) return;

   double price = (type == ORDER_TYPE_BUY) ? symInfo.Ask() : symInfo.Bid();
   price = NormalizePrice(price);

   double slPrice = 0.0, tpPrice = 0.0;
   double minDist = PointsToPrice(MathMax(g_stopsLevel, 10));

   if(type == ORDER_TYPE_BUY)
      slPrice = NormalizePrice(price - PointsToPrice(slPts));
   else
      slPrice = NormalizePrice(price + PointsToPrice(slPts));

   if(type == ORDER_TYPE_BUY && (price - slPrice) < minDist)
      slPrice = NormalizePrice(price - minDist);
   if(type == ORDER_TYPE_SELL && (slPrice - price) < minDist)
      slPrice = NormalizePrice(price + minDist);

   if(type == ORDER_TYPE_BUY)
      tpPrice = NormalizePrice(price + PointsToPrice(tpPts));
   else
      tpPrice = NormalizePrice(price - PointsToPrice(tpPts));

   double slToSend = HiddenStopLoss   ? 0.0 : slPrice;
   double tpToSend = HiddenTakeProfit ? 0.0 : tpPrice;

   bool ok = false;
   if(type == ORDER_TYPE_BUY)
      ok = trade.Buy(lot, _Symbol, price, slToSend, tpToSend, TradeComment);
   else
      ok = trade.Sell(lot, _Symbol, price, slToSend, tpToSend, TradeComment);

   if(!ok)
   {
      Print("TRADE FAILED: ", trade.ResultRetcode());
      return;
   }

   dailyTrades++;
   lastTradeBarTime = iTime(_Symbol, _Period, 0);
   Print(">>> TRADE OPENED: ", EnumToString(type), " lot=", lot);

   ulong ticket = 0;
   ulong order  = trade.ResultOrder();

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i) && posInfo.Magic() == MagicNumber && posInfo.Symbol() == _Symbol)
      {
         if(posInfo.Ticket() == order || posInfo.Identifier() == order || ticket == 0)
            ticket = posInfo.Ticket();
      }
   }

   if(ticket > 0 && (HiddenStopLoss || HiddenTakeProfit || HiddenTrailingStop))
   {
      int n = ArraySize(hiddenOrders);
      ArrayResize(hiddenOrders, n + 1);
      hiddenOrders[n].ticket = ticket;
      hiddenOrders[n].hiddenSL = slPrice;
      hiddenOrders[n].hiddenTP = tpPrice;
      hiddenOrders[n].trailActive = false;
   }
}

//+------------------------------------------------------------------+
void ManageHiddenOrdersAndTrailing()
{
   for(int i = ArraySize(hiddenOrders) - 1; i >= 0; i--)
   {
      ulong ticket = hiddenOrders[i].ticket;
      if(!posInfo.SelectByTicket(ticket) || posInfo.Symbol() != _Symbol)
      {
         for(int k = i; k < ArraySize(hiddenOrders)-1; k++)
            hiddenOrders[k] = hiddenOrders[k+1];
         ArrayResize(hiddenOrders, ArraySize(hiddenOrders)-1);
         continue;
      }

      double bid = symInfo.Bid();
      double ask = symInfo.Ask();
      double openPrice = posInfo.PriceOpen();
      long posType = posInfo.PositionType();
      double curSL = hiddenOrders[i].hiddenSL;
      double curTP = hiddenOrders[i].hiddenTP;

      if(HiddenTrailingStop && UseTrailingStop)
      {
         double trailStart = PointsToPrice(TrailingStart);
         double trailStep  = PointsToPrice(TrailingStep);

         if(posType == POSITION_TYPE_BUY)
         {
            if(!hiddenOrders[i].trailActive && (bid - openPrice) >= trailStart)
            {
               hiddenOrders[i].trailActive = true;
               double newSL = NormalizePrice(bid - trailStep);
               if(newSL > curSL) curSL = newSL;
            }
            if(hiddenOrders[i].trailActive)
            {
               double newSL = NormalizePrice(bid - trailStep);
               if(newSL > curSL) curSL = newSL;
            }
         }
         else
         {
            if(!hiddenOrders[i].trailActive && (openPrice - ask) >= trailStart)
            {
               hiddenOrders[i].trailActive = true;
               double newSL = NormalizePrice(ask + trailStep);
               if(curSL == 0 || newSL < curSL) curSL = newSL;
            }
            if(hiddenOrders[i].trailActive)
            {
               double newSL = NormalizePrice(ask + trailStep);
               if(curSL == 0 || newSL < curSL) curSL = newSL;
            }
         }
         hiddenOrders[i].hiddenSL = curSL;
      }

      bool closeTrade = false;
      if(HiddenStopLoss && curSL != 0)
      {
         if(posType == POSITION_TYPE_BUY && bid <= curSL) closeTrade = true;
         if(posType == POSITION_TYPE_SELL && ask >= curSL) closeTrade = true;
      }
      if(HiddenTakeProfit && curTP != 0)
      {
         if(posType == POSITION_TYPE_BUY && bid >= curTP) closeTrade = true;
         if(posType == POSITION_TYPE_SELL && ask <= curTP) closeTrade = true;
      }

      if(closeTrade)
      {
         trade.PositionClose(ticket);
         for(int k = i; k < ArraySize(hiddenOrders)-1; k++)
            hiddenOrders[k] = hiddenOrders[k+1];
         ArrayResize(hiddenOrders, ArraySize(hiddenOrders)-1);
      }
   }
}

//+------------------------------------------------------------------+
double CalculateLotSize(double slPoints)
{
   double lot = LotSize;

   if(UseRiskPercent && slPoints > 0)
   {
      double riskMoney = accInfo.Balance() * RiskPercent / 100.0;
      double tickVal   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSz    = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tickVal > 0 && tickSz > 0)
      {
         double ticks = (slPoints * g_point) / tickSz;
         if(ticks > 0) lot = riskMoney / (ticks * tickVal);
      }
   }

   if(RecoveryMode && consecutiveLosses > 0 && consecutiveLosses <= MaxRecoveryLevel)
      lot = LotSize * MathPow(RecoveryMultiplier, consecutiveLosses);

   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;

   lot = MathFloor(lot / step) * step;
   return MathMax(minLot, MathMin(maxLot, lot));
}

//+------------------------------------------------------------------+
void CheckDailyReset()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime today = StructToTime(dt);

   static datetime lastReset = 0;
   if(today != lastReset)
   {
      lastReset = today;
      dayStartBalance = accInfo.Balance();
      dailyTrades = 0;
      consecutiveLosses = 0;
      hedgeActive = false;
   }
}

bool CheckDailyLimits()
{
   double closed   = GetClosedProfitToday();
   double floating = accInfo.Equity() - accInfo.Balance();
   double total    = closed + floating;

   if(UseDailyProfit && total >= DailyProfitTarget) return true;
   if(UseMaxDrawdown && total <= -MaxDailyDrawdown) return true;
   return false;
}

double GetClosedProfitToday()
{
   double profit = 0;
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime start = StructToTime(dt);

   if(!HistorySelect(start, TimeCurrent())) return 0;

   for(int i = HistoryDealsTotal()-1; i >= 0; i--)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      if(HistoryDealGetInteger(t, DEAL_MAGIC) == MagicNumber &&
         HistoryDealGetString(t, DEAL_SYMBOL) == _Symbol &&
         HistoryDealGetInteger(t, DEAL_ENTRY) == DEAL_ENTRY_OUT)
      {
         profit += HistoryDealGetDouble(t, DEAL_PROFIT)
                 + HistoryDealGetDouble(t, DEAL_SWAP)
                 + HistoryDealGetDouble(t, DEAL_COMMISSION);
      }
   }
   return profit;
}

void OnTrade()
{
   if(!RecoveryMode) return;
   if(!HistorySelect(0, TimeCurrent())) return;
   int total = HistoryDealsTotal();
   if(total <= 0) return;

   ulong last = HistoryDealGetTicket(total-1);
   if(last == 0) return;

   if(HistoryDealGetInteger(last, DEAL_MAGIC) == MagicNumber &&
      HistoryDealGetInteger(last, DEAL_ENTRY) == DEAL_ENTRY_OUT)
   {
      double p = HistoryDealGetDouble(last, DEAL_PROFIT) + HistoryDealGetDouble(last, DEAL_SWAP);
      consecutiveLosses = (p < 0) ? consecutiveLosses + 1 : 0;
   }
}

int CountOpenPositions()
{
   int cnt = 0;
   for(int i = PositionsTotal()-1; i >= 0; i--)
   {
      if(posInfo.SelectByIndex(i) &&
         posInfo.Magic() == MagicNumber &&
         posInfo.Symbol() == _Symbol)
         cnt++;
   }
   return cnt;
}
//+------------------------------------------------------------------+
