//+------------------------------------------------------------------+
//|                    Gold_OOB_Scalper_Updated.mq5                 |
//|          OOB Gold M1 Scalper - Safe Trailing Stop Fix            |
//+------------------------------------------------------------------+
#property copyright "OOB R&D 2.0 - Updated Fix"
#property version   "8.00"
#property strict
#property description "Gold M1 OOB Scalper: HA + ADX + Broker Safe Trailing"

//--- Standard libraries
#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Trade\OrderInfo.mqh>

//--- Objects
CTrade         g_trade;
CPositionInfo  g_posInfo;
COrderInfo     g_orderInfo;

//--- EA magic number
const long g_magicNumber = 20260924;

//+------------------------------------------------------------------+
//| Inputs                                                           |
//+------------------------------------------------------------------+
input group "═══ 1. TRADE EXECUTION ═══"
input double   InpLotSize           = 0.01;
input int      InpStopLossPoints    = 400;
input int      InpPendingOffsetPts  = 30;
input int      InpMaxSpreadPoints   = 80;

input group "═══ 2. TRAILING STOP ═══"
input bool     InpUseTrailing       = true;
input int      InpTrailingStartPts  = 50;
input int      InpTrailingStopPts   = 40;
input int      InpTrailingStepPts   = 20;

input group "═══ 3. SESSION FILTER ═══"
input bool     InpUseSessionFilter  = true;
input int      InpLondonStart       = 10;
input int      InpLondonEnd         = 18;
input int      InpNYStart           = 13;
input int      InpNYEnd             = 21;

input group "═══ 4. OOB TREND LOGIC ═══"
input int      InpADX_Period        = 14;
input double   InpADX_MinTrend      = 22.0;
input int      InpHA_Lookback       = 3;
input int      InpSwing_Lookback    = 8;

//+------------------------------------------------------------------+
//| Global variables                                                 |
//+------------------------------------------------------------------+
int g_handle_adx = INVALID_HANDLE;

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpLotSize <= 0.0)
   {
      Print("ERROR: Lot size must be greater than zero.");
      return INIT_PARAMETERS_INCORRECT;
   }

   if(InpStopLossPoints <= 0 ||
      InpPendingOffsetPts < 0 ||
      InpTrailingStartPts < 0 ||
      InpTrailingStopPts <= 0 ||
      InpTrailingStepPts <= 0 ||
      InpHA_Lookback < 2 ||
      InpSwing_Lookback < 2)
   {
      Print("ERROR: Invalid input parameters.");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_handle_adx = iADX(_Symbol, PERIOD_M1, InpADX_Period);

   if(g_handle_adx == INVALID_HANDLE)
   {
      Print("ERROR: ADX handle creation failed. Error=", GetLastError());
      return INIT_FAILED;
   }

   g_trade.SetExpertMagicNumber(g_magicNumber);
   g_trade.SetDeviationInPoints(30);

   // Broker/symbol ke supported filling mode ko automatically choose karega
   g_trade.SetTypeFillingBySymbol(_Symbol);

   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);

   Print("Gold OOB Scalper initialized successfully.");
   Print("Symbol=", _Symbol,
         " | Digits=", (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS),
         " | Point=", DoubleToString(point, 5),
         " | StopsLevel=",
         (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL),
         " | FreezeLevel=",
         (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL));

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(g_handle_adx != INVALID_HANDLE)
      IndicatorRelease(g_handle_adx);
}

//+------------------------------------------------------------------+
//| Expert tick                                                      |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      return;

   // Open position hai toh sirf trailing manage hoga.
   // Session aur spread filter trailing par apply nahi hoga.
   int openPositions = CountOpenPositions();

   if(openPositions > 0)
   {
      if(InpUseTrailing)
         ManageTrailingStop();

      return;
   }

   // Session close hai toh existing pending orders bhi delete karo.
   // Isse session ke bahar accidentally order trigger nahi hoga.
   if(InpUseSessionFilter && !IsSessionActive())
   {
      DeletePending(ORDER_TYPE_BUY_STOP);
      DeletePending(ORDER_TYPE_SELL_STOP);
      return;
   }

   // New entry ke liye spread check
   int spreadPoints = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);

   if(spreadPoints > InpMaxSpreadPoints)
      return;

   // Trend nikaal kar pending order manage karo
   int trend = GetOOBTrend();
   ManagePendingOrders(trend);
}

//+------------------------------------------------------------------+
//| OOB trend detection: ADX + Heikin Ashi                          |
//+------------------------------------------------------------------+
int GetOOBTrend()
{
   if(BarsCalculated(g_handle_adx) < InpADX_Period)
      return 0;

   double adxMain[];
   ArraySetAsSeries(adxMain, true);

   if(CopyBuffer(g_handle_adx, 0, 1, 1, adxMain) != 1)
      return 0;

   // ADX weak hai toh no trade
   if(adxMain[0] < InpADX_MinTrend)
      return 0;

   MqlRates rates[];
   ArraySetAsSeries(rates, true);

   // Lookback candles + 1 seed candle
   int requiredBars = InpHA_Lookback + 1;

   if(CopyRates(_Symbol, PERIOD_M1, 1, requiredBars, rates) != requiredBars)
      return 0;

   int greenCount = 0;
   int redCount   = 0;

   // Array series mode mein:
   // index 0 = newest closed candle
   // index InpHA_Lookback = oldest candle
   // HA ko oldest se newest calculate karna zaroori hai.
   double previousHAOpen =
      (rates[InpHA_Lookback].open + rates[InpHA_Lookback].close) / 2.0;

   double previousHAClose =
      (rates[InpHA_Lookback].open +
       rates[InpHA_Lookback].high +
       rates[InpHA_Lookback].low +
       rates[InpHA_Lookback].close) / 4.0;

   for(int i = InpHA_Lookback - 1; i >= 0; i--)
   {
      double haClose =
         (rates[i].open +
          rates[i].high +
          rates[i].low +
          rates[i].close) / 4.0;

      double haOpen = (previousHAOpen + previousHAClose) / 2.0;

      if(haClose > haOpen)
         greenCount++;
      else if(haClose < haOpen)
         redCount++;

      previousHAOpen  = haOpen;
      previousHAClose = haClose;
   }

   // Minimum lookback-1 same-colored HA candles
   if(greenCount >= InpHA_Lookback - 1)
      return 1;

   if(redCount >= InpHA_Lookback - 1)
      return -1;

   return 0;
}

//+------------------------------------------------------------------+
//| Manage pending Buy Stop / Sell Stop orders                       |
//+------------------------------------------------------------------+
void ManagePendingOrders(const int trend)
{
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int digits   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   if(point <= 0.0)
      return;

   MqlTick tick;

   if(!SymbolInfoTick(_Symbol, tick))
      return;

   bool hasBuyStop  = HasPending(ORDER_TYPE_BUY_STOP);
   bool hasSellStop = HasPending(ORDER_TYPE_SELL_STOP);

   MqlRates rates[];
   ArraySetAsSeries(rates, true);

   if(CopyRates(_Symbol, PERIOD_M1, 1, InpSwing_Lookback, rates)
      != InpSwing_Lookback)
   {
      return;
   }

   double swingHigh = rates[0].high;
   double swingLow  = rates[0].low;

   for(int i = 1; i < InpSwing_Lookback; i++)
   {
      if(rates[i].high > swingHigh)
         swingHigh = rates[i].high;

      if(rates[i].low < swingLow)
         swingLow = rates[i].low;
   }

   int stopsLevelPts =
      (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);

   // Rounding/broker validation safety buffer
   int safeDistancePts = stopsLevelPts + 2;

   //===============================================================
   // Bullish trend: only Buy Stop
   //===============================================================
   if(trend == 1)
   {
      if(hasSellStop)
         DeletePending(ORDER_TYPE_SELL_STOP);

      if(!hasBuyStop)
      {
         double entry =
            swingHigh + (InpPendingOffsetPts * point);

         // Buy Stop must be above current Ask and broker stop distance
         double minBuyStopPrice =
            tick.ask + (safeDistancePts * point);

         if(entry < minBuyStopPrice)
            entry = minBuyStopPrice;

         entry = NormalizeDouble(entry, digits);

         double sl =
            entry - (InpStopLossPoints * point);

         sl = NormalizeDouble(sl, digits);

         ResetLastError();

         if(!g_trade.BuyStop(
            InpLotSize,
            entry,
            _Symbol,
            sl,
            0.0,
            ORDER_TIME_GTC,
            0,
            "OOB_BUY"))
         {
            Print("BUY STOP FAILED | Entry=",
                  DoubleToString(entry, digits),
                  " | SL=", DoubleToString(sl, digits),
                  " | Retcode=", g_trade.ResultRetcode(),
                  " | Description=",
                  g_trade.ResultRetcodeDescription(),
                  " | Error=", GetLastError());
         }
      }
   }

   //===============================================================
   // Bearish trend: only Sell Stop
   //===============================================================
   else if(trend == -1)
   {
      if(hasBuyStop)
         DeletePending(ORDER_TYPE_BUY_STOP);

      if(!hasSellStop)
      {
         double entry =
            swingLow - (InpPendingOffsetPts * point);

         // Sell Stop must be below current Bid and broker stop distance
         double maxSellStopPrice =
            tick.bid - (safeDistancePts * point);

         if(entry > maxSellStopPrice)
            entry = maxSellStopPrice;

         entry = NormalizeDouble(entry, digits);

         double sl =
            entry + (InpStopLossPoints * point);

         sl = NormalizeDouble(sl, digits);

         ResetLastError();

         if(!g_trade.SellStop(
            InpLotSize,
            entry,
            _Symbol,
            sl,
            0.0,
            ORDER_TIME_GTC,
            0,
            "OOB_SELL"))
         {
            Print("SELL STOP FAILED | Entry=",
                  DoubleToString(entry, digits),
                  " | SL=", DoubleToString(sl, digits),
                  " | Retcode=", g_trade.ResultRetcode(),
                  " | Description=",
                  g_trade.ResultRetcodeDescription(),
                  " | Error=", GetLastError());
         }
      }
   }

   //===============================================================
   // No trend: remove all EA pending orders
   //===============================================================
   else
   {
      if(hasBuyStop)
         DeletePending(ORDER_TYPE_BUY_STOP);

      if(hasSellStop)
         DeletePending(ORDER_TYPE_SELL_STOP);
   }
}

//+------------------------------------------------------------------+
//| Safe trailing stop - works independent of session/spread         |
//+------------------------------------------------------------------+
void ManageTrailingStop()
{
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int digits   = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);

   if(point <= 0.0)
      return;

   MqlTick tick;

   if(!SymbolInfoTick(_Symbol, tick))
   {
      Print("TRAIL ERROR: Cannot get tick. Error=", GetLastError());
      return;
   }

   // Broker restrictions
   int stopsLevelPts =
      (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);

   int freezeLevelPts =
      (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);

   // Broker limits + 2 point buffer
   int safeDistancePts =
      (int)MathMax(stopsLevelPts, freezeLevelPts) + 2;

   // Trailing distance cannot be lower than broker minimum distance
   int effectiveTrailingStopPts =
      (int)MathMax(InpTrailingStopPts, safeDistancePts);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);

      if(ticket == 0)
         continue;

      // IMPORTANT: Correct ticket based selection
      if(!g_posInfo.SelectByTicket(ticket))
      {
         Print("TRAIL ERROR: Position selection failed. Ticket=",
               ticket, " Error=", GetLastError());
         continue;
      }

      if(g_posInfo.Symbol() != _Symbol)
         continue;

      if(g_posInfo.Magic() != g_magicNumber)
         continue;

      double openPrice = g_posInfo.PriceOpen();
      double currentSL = g_posInfo.StopLoss();
      double currentTP = g_posInfo.TakeProfit();

      ENUM_POSITION_TYPE positionType =
         (ENUM_POSITION_TYPE)g_posInfo.PositionType();

      double newSL = 0.0;
      bool modifySL = false;

      //=============================================================
      // BUY POSITION TRAILING
      //=============================================================
      if(positionType == POSITION_TYPE_BUY)
      {
         double profitPoints =
            (tick.bid - openPrice) / point;

         if(profitPoints < InpTrailingStartPts)
            continue;

         // Expected trailing SL
         newSL =
            tick.bid - (effectiveTrailingStopPts * point);

         // Once trailing starts, do not allow loss:
         // minimum desired SL = entry + 1 point
         double breakevenSL = openPrice + point;

         if(newSL < breakevenSL)
            newSL = breakevenSL;

         // Maximum allowed SL based on current Bid and broker rules
         double maxAllowedSL =
            tick.bid - (safeDistancePts * point);

         if(newSL > maxAllowedSL)
            newSL = maxAllowedSL;

         newSL = NormalizeDouble(newSL, digits);

         // A trailing SL should protect at least a tiny profit
         if(newSL <= openPrice)
            continue;

         // Move SL only upward and only by trailing step
         if(currentSL == 0.0 ||
            newSL >= currentSL + (InpTrailingStepPts * point))
         {
            modifySL = true;
         }
      }

      //=============================================================
      // SELL POSITION TRAILING
      //=============================================================
      else if(positionType == POSITION_TYPE_SELL)
      {
         double profitPoints =
            (openPrice - tick.ask) / point;

         if(profitPoints < InpTrailingStartPts)
            continue;

         // Expected trailing SL
         newSL =
            tick.ask + (effectiveTrailingStopPts * point);

         // Once trailing starts, do not allow loss:
         // maximum desired SL = entry - 1 point
         double breakevenSL = openPrice - point;

         if(newSL > breakevenSL)
            newSL = breakevenSL;

         // Minimum allowed SL based on current Ask and broker rules
         double minAllowedSL =
            tick.ask + (safeDistancePts * point);

         if(newSL < minAllowedSL)
            newSL = minAllowedSL;

         newSL = NormalizeDouble(newSL, digits);

         // A trailing SL should protect at least a tiny profit
         if(newSL >= openPrice)
            continue;

         // Sell side: lower SL is better.
         if(currentSL == 0.0 ||
            newSL <= currentSL - (InpTrailingStepPts * point))
         {
            modifySL = true;
         }
      }

      if(!modifySL)
         continue;

      ResetLastError();

      bool result = g_trade.PositionModify(ticket, newSL, currentTP);

      // PositionModify's return boolean alone is not enough:
      // ResultRetcode shows actual trade-server response.
      if(!result)
      {
         Print("TRAIL FAILED | Ticket=", ticket,
               " | Type=", EnumToString(positionType),
               " | CurrentSL=", DoubleToString(currentSL, digits),
               " | NewSL=", DoubleToString(newSL, digits),
               " | Retcode=", g_trade.ResultRetcode(),
               " | Description=",
               g_trade.ResultRetcodeDescription(),
               " | Error=", GetLastError(),
               " | StopsLevel=", stopsLevelPts,
               " | FreezeLevel=", freezeLevelPts);
      }
      else
      {
         Print("TRAIL UPDATED | Ticket=", ticket,
               " | Type=", EnumToString(positionType),
               " | OldSL=", DoubleToString(currentSL, digits),
               " | NewSL=", DoubleToString(newSL, digits),
               " | Retcode=", g_trade.ResultRetcode(),
               " | Description=",
               g_trade.ResultRetcodeDescription());
      }
   }
}

//+------------------------------------------------------------------+
//| Check active session                                             |
//+------------------------------------------------------------------+
bool IsSessionActive()
{
   MqlDateTime currentTime;
   TimeToStruct(TimeCurrent(), currentTime);

   bool londonActive =
      (currentTime.hour >= InpLondonStart &&
       currentTime.hour < InpLondonEnd);

   bool newYorkActive =
      (currentTime.hour >= InpNYStart &&
       currentTime.hour < InpNYEnd);

   return (londonActive || newYorkActive);
}

//+------------------------------------------------------------------+
//| Count EA positions only                                          |
//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int count = 0;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);

      if(ticket == 0)
         continue;

      if(!g_posInfo.SelectByTicket(ticket))
         continue;

      if(g_posInfo.Symbol() == _Symbol &&
         g_posInfo.Magic() == g_magicNumber)
      {
         count++;
      }
   }

   return count;
}

//+------------------------------------------------------------------+
//| Check whether a pending order of requested type exists           |
//+------------------------------------------------------------------+
bool HasPending(const ENUM_ORDER_TYPE orderType)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);

      if(ticket == 0)
         continue;

      if(!g_orderInfo.Select(ticket))
         continue;

      if(g_orderInfo.Symbol() != _Symbol)
         continue;

      if(g_orderInfo.Magic() != g_magicNumber)
         continue;

      if(g_orderInfo.OrderType() == orderType)
         return true;
   }

   return false;
}

//+------------------------------------------------------------------+
//| Delete EA pending orders of requested type                       |
//+------------------------------------------------------------------+
void DeletePending(const ENUM_ORDER_TYPE orderType)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);

      if(ticket == 0)
         continue;

      if(!g_orderInfo.Select(ticket))
         continue;

      if(g_orderInfo.Symbol() != _Symbol)
         continue;

      if(g_orderInfo.Magic() != g_magicNumber)
         continue;

      if(g_orderInfo.OrderType() != orderType)
         continue;

      ResetLastError();

      if(!g_trade.OrderDelete(ticket))
      {
         Print("ORDER DELETE FAILED | Ticket=", ticket,
               " | Retcode=", g_trade.ResultRetcode(),
               " | Description=",
               g_trade.ResultRetcodeDescription(),
               " | Error=", GetLastError());
      }
      else
      {
         Print("Pending order deleted. Ticket=", ticket);
      }
   }
}
//+------------------------------------------------------------------+
