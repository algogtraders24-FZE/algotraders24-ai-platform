//+------------------------------------------------------------------+
//|                                                     XXXBTC.mq5   |
//|                        Copyright algotraders24.ai                  |
//|                        XXX BTC - Bitcoin Breakout System           |
//+------------------------------------------------------------------+
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property version   "1.00"
#property strict
#property description "XXX BTC - Powered by ALGOTRADERS24 AI"
#property description "24/7 Crypto Breakout System"

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

CTrade         trade;
CPositionInfo  posInfo;

//--- COLORS
color clrBG         = clrBlack;
color clrGoldColor  = clrOrange;
color clrText       = clrWhite;
color clrTextGreen  = clrLime;
color clrTextRed    = clrRed;
color clrPanelBG    = clrBlue;
color clrGrayBox    = clrGray;

//--- INPUTS
input group "=== LOT SIZE ==="
input int    InpSizingMode           = 0;
input double InpFixedLot             = 0.01;
input double InpRiskPercent          = 2.0;
input double InpMaxLot               = 0.0;
input bool   InpAutoLotGrowth        = false;
input double InpAutoLotBaseBalance   = 1000.0;
input double InpAutoLotBalanceStep   = 500.0;
input double InpAutoLotStepSize      = 0.01;

input group "=== TRADE MANAGEMENT (BTC POINTS) ==="
input bool   InpMoonLockEnabled      = true;
input double InpMoonLockStart        = 1.0;
input double InpMoonLockPercent      = 50.0;
input double InpStopLossPoints       = 1000.0;  // BTC points (~$1000 move)
input double InpTakeProfitPoints     = 3000.0;  // BTC points
input bool   InpAutoBreakeven        = true;
input double InpBE_TriggerPoints     = 400.0;
input double InpBE_LockPoints        = 100.0;
input bool   InpTimeStopEnabled      = true;
input int    InpTimeStopMinutes      = 60;
input bool   InpSmartTrailing        = true;
input double InpTrailStartPoints     = 800.0;
input double InpTrailStepPoints      = 400.0;

input group "=== MODULES ==="
input bool   InpEnableNova           = true;
input bool   InpEnableApex           = true;
input bool   InpEnableZenith         = true;
input bool   InpEnablePulse          = true;
input bool   InpEnableEclipse        = true;

input group "=== MTF TREND ==="
input bool   InpUseMTFTrend          = true;
input ENUM_TIMEFRAMES InpMTF_Timeframe = PERIOD_H1;
input int    InpFastEMA              = 50;
input int    InpSlowEMA              = 200;

input group "=== ONNX AI FILTER (BTC model baad mein train karein) ==="
input bool   InpUseONNX              = false;   // BTC model train hone ke baad true karein
input double InpAIScoreThreshold     = 0.80;
input string InpONNXFile             = "xxxbtc_filter.onnx";

input group "=== SHIELDS (CRYPTO = 24/7) ==="
input bool   InpWeekendShield        = false;   // BTC weekend par bhi chalta hai!
input int    InpFridayPauseHour      = 20;
input int    InpMondayResumeHour     = 5;
input bool   InpSpreadShieldEnabled  = true;
input int    InpMaxSpreadPoints      = 300;     // Broker ke hisaab se adjust karein

input group "=== PROP FIRM ==="
input bool   InpPropFirmMode         = false;
input double InpPropFirmMaxDrawdown  = 10.0;
input double InpPropFirmProfitTarget = 8.0;
input bool   InpDailyLossLimitEnabled= false;
input double InpMaxDailyLossPercent  = 5.0;

input group "=== GENERAL ==="
input ENUM_TIMEFRAMES InpTF          = PERIOD_M15;
input int    InpMagicNumber          = 33303;
input int    InpMaxTradesPerDay      = 10;
input double InpBreakoutBufferPoints = 50.0;
input bool   InpShowDashboard        = true;

//--- GLOBALS
int      handle_atr = INVALID_HANDLE, handle_rsi = INVALID_HANDLE, handle_fractals = INVALID_HANDLE;
int      handle_ema_fast = INVALID_HANDLE, handle_ema_slow = INVALID_HANDLE;
int      onnx_handle = INVALID_HANDLE;
int      g_ai_status = 0;
datetime g_lastBarTime = 0;
int      g_tradesToday = 0;
datetime g_todayStart = 0;
double   g_dailyStartEquity = 0.0;
double   g_peakEquity = 0.0;
bool     g_isPaused = false;
double   g_totalProfit = 0;
int      g_totalWins = 0;
int      g_totalLosses = 0;

struct MoonLockData { ulong ticket; double peakProfit; bool active; bool isBE; };
MoonLockData g_locks[];
string g_prefix = "XBTC_";

//+------------------------------------------------------------------+
int OnInit() {
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   
   handle_atr = iATR(_Symbol, InpTF, 14);
   handle_rsi = iRSI(_Symbol, InpTF, 14, PRICE_CLOSE);
   handle_fractals = iFractals(_Symbol, InpTF);
   
   if(InpUseMTFTrend) {
      handle_ema_fast = iMA(_Symbol, InpMTF_Timeframe, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);
      handle_ema_slow = iMA(_Symbol, InpMTF_Timeframe, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
   }
   
   g_ai_status = 0;
   if(InpUseONNX) {
      onnx_handle = OnnxCreate(InpONNXFile, ONNX_DEFAULT);
      if(onnx_handle == INVALID_HANDLE) {
         g_ai_status = 2;
         Print("WARNING: ONNX file not found: ", InpONNXFile, " | AI DISABLED (fail-safe)");
      } else {
         long in_shape[2]  = {1, 5};
         long out_shape[2] = {1, 1};
         OnnxSetInputShape(onnx_handle, 0, in_shape);
         OnnxSetOutputShape(onnx_handle, 0, out_shape);
         g_ai_status = 1;
         Print("ONNX AI Model Loaded: ", InpONNXFile);
      }
   }
   
   g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_peakEquity = g_dailyStartEquity;
   
   EventSetTimer(1);
   
   UpdateStatistics();
   if(InpShowDashboard) DrawFinalDashboard();
   ChartRedraw(0);
   
   Print("=== XXX BTC v1.00 Initialized ===");
   Print("Copyright algotraders24.ai | 24/7 Crypto Mode");
   
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   EventKillTimer();
   ObjectsDeleteAll(0, g_prefix);
   ChartRedraw(0);
   if(handle_atr != INVALID_HANDLE) IndicatorRelease(handle_atr);
   if(handle_rsi != INVALID_HANDLE) IndicatorRelease(handle_rsi);
   if(handle_fractals != INVALID_HANDLE) IndicatorRelease(handle_fractals);
   if(handle_ema_fast != INVALID_HANDLE) IndicatorRelease(handle_ema_fast);
   if(handle_ema_slow != INVALID_HANDLE) IndicatorRelease(handle_ema_slow);
   if(onnx_handle != INVALID_HANDLE) OnnxRelease(onnx_handle);
}

void OnTimer() {
   UpdateStatistics();
   if(InpShowDashboard) DrawFinalDashboard();
   ChartRedraw(0);
}

void OnTick() {
   CheckNewDay();
   ManageTradeExits();
   
   bool isBlocked = g_isPaused || IsWeekendBlocked() || IsSpreadBlocked() || CheckPropFirmLimits();
   
   if(isBlocked) {
      DeleteAllPendingOrders();
   } else {
      DeleteStalePendingOrders();
      if(IsNewBar()) PlaceBreakoutOrders();
   }
}

void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam) {
   if(id == CHARTEVENT_OBJECT_CLICK) {
      if(sparam == g_prefix+"BtnPause") {
         g_isPaused = !g_isPaused;
         ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
         ChartRedraw(0);
      }
      if(sparam == g_prefix+"BtnClose") {
         CloseAllPositions();
         ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
         ChartRedraw(0);
      }
   }
}

//+------------------------------------------------------------------+
//| ONNX AI SCORE (5 normalized features - same as US30 training)    |
//+------------------------------------------------------------------+
double GetAIScore(double dir) {
   if(!InpUseONNX || onnx_handle == INVALID_HANDLE) return 1.0;
   
   double close1 = iClose(_Symbol, InpTF, 1);
   double rsi = GetInd(handle_rsi, 0, 1);
   double atr = GetInd(handle_atr, 0, 1);
   
   if(close1 <= 0 || atr <= 0 || rsi <= 0) return 1.0;
   
   double momentum = iClose(_Symbol, InpTF, 1) - iClose(_Symbol, InpTF, 11);
   double dh = iHigh(_Symbol, InpTF, iHighest(_Symbol, InpTF, MODE_HIGH, 20, 1));
   double dl = iLow(_Symbol, InpTF, iLowest(_Symbol, InpTF, MODE_LOW, 20, 1));
   
   double dist = (dir > 0) ? (dh - close1) : (close1 - dl);
   
   float in[5];
   in[0] = (float)(rsi / 100.0);
   in[1] = (float)(atr / close1);
   in[2] = (float)(momentum / atr);
   in[3] = (float)(dist / atr);
   in[4] = (float)dir;
   
   float out[1];
   if(!OnnxRun(onnx_handle, ONNX_NO_CONVERSION, in, out)) {
      g_ai_status = 2;
      return 1.0;
   }
   
   return (double)out[0];
}

//+------------------------------------------------------------------+
void DrawFinalDashboard() {
   int xLeft = 10, yTop = 10, wLeft = 300;
   
   CreateRect(g_prefix+"Header", xLeft, yTop, wLeft, 55, clrPanelBG, clrGoldColor);
   SetLabel(g_prefix+"Brand", xLeft+10, yTop+8, "ALGOTRADERS24 AI", clrText, 12, "Arial Bold");
   SetLabel(g_prefix+"Sub", xLeft+10, yTop+22, "XXX BTC v1.00 | 24/7", clrGoldColor, 9, "Arial");
   SetLabel(g_prefix+"Status", xLeft+10, yTop+38, g_isPaused ? "PAUSED" : "ACTIVE", g_isPaused ? clrTextRed : clrTextGreen, 10, "Arial Bold");
   
   int yStats = yTop + 70;
   CreateRect(g_prefix+"StatsBG", xLeft, yStats, wLeft, 85, clrBG, clrGrayBox);
   
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double dailyPL = equity - g_dailyStartEquity;
   double dailyPLPercent = (g_dailyStartEquity > 0) ? (dailyPL / g_dailyStartEquity * 100) : 0;
   double dd = g_peakEquity > 0 ? ((g_peakEquity - equity) / g_peakEquity * 100) : 0;
   
   long spread_long = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   int spread_int = (int)spread_long;
   
   SetLabel(g_prefix+"Balance", xLeft+10, yStats+8, "BAL: $"+DoubleToString(balance, 2), clrText, 9, "Arial Bold");
   SetLabel(g_prefix+"Equity", xLeft+150, yStats+8, "EQ: $"+DoubleToString(equity, 2), clrText, 9, "Arial Bold");
   
   color plColor = (dailyPL >= 0) ? clrTextGreen : clrTextRed;
   SetLabel(g_prefix+"PL", xLeft+10, yStats+24, "P/L: $"+DoubleToString(dailyPL, 2), plColor, 9, "Arial Bold");
   SetLabel(g_prefix+"PLPercent", xLeft+150, yStats+24, "("+DoubleToString(dailyPLPercent, 2)+"%)", plColor, 8, "Arial");
   
   SetLabel(g_prefix+"DD", xLeft+10, yStats+40, "DD: "+DoubleToString(dd, 2)+"%", clrOrange, 9, "Arial Bold");
   SetLabel(g_prefix+"Spread", xLeft+10, yStats+56, "SPREAD: "+IntegerToString(spread_int)+" pts", clrText, 8, "Arial");
   SetLabel(g_prefix+"Risk", xLeft+150, yStats+56, "RISK: "+DoubleToString(InpRiskPercent, 2)+"%", clrGoldColor, 8, "Arial");
   
   int yPerf = yStats + 95;
   CreateRect(g_prefix+"PerfBG", xLeft, yPerf, wLeft, 65, clrBG, clrGrayBox);
   SetLabel(g_prefix+"PerfTitle", xLeft+10, yPerf+8, "PERFORMANCE", clrBlue, 8, "Arial Bold");
   
   int totalTrades = g_totalWins + g_totalLosses;
   double winRate = (totalTrades > 0) ? (g_totalWins * 100.0 / totalTrades) : 0;
   double profitFactor = (g_totalLosses != 0) ? (g_totalProfit / (g_totalLosses * -1)) : 0;
   
   SetLabel(g_prefix+"WinRate", xLeft+10, yPerf+24, "WIN: "+DoubleToString(winRate, 1)+"%", clrTextGreen, 8, "Arial Bold");
   SetLabel(g_prefix+"Trades", xLeft+10, yPerf+38, "TRADES: "+IntegerToString(totalTrades), clrText, 8, "Arial Bold");
   SetLabel(g_prefix+"PF", xLeft+150, yPerf+24, "PF: "+DoubleToString(profitFactor, 2), clrGoldColor, 8, "Arial Bold");
   SetLabel(g_prefix+"Wins", xLeft+150, yPerf+38, "W:"+IntegerToString(g_totalWins)+" L:"+IntegerToString(g_totalLosses), clrTextGreen, 7, "Arial");
   
   int yModules = yPerf + 75;
   CreateRect(g_prefix+"ModulesBG", xLeft, yModules, wLeft, 95, clrBG, clrGrayBox);
   SetLabel(g_prefix+"ModulesTitle", xLeft+10, yModules+8, "MODULES", clrBlue, 8, "Arial Bold");
   
   CreateModuleRowCompact("Nova", InpEnableNova, yModules+22, xLeft);
   CreateModuleRowCompact("Apex", InpEnableApex, yModules+37, xLeft);
   CreateModuleRowCompact("Zenith", InpEnableZenith, yModules+52, xLeft);
   CreateModuleRowCompact("Pulse", InpEnablePulse, yModules+67, xLeft);
   CreateModuleRowCompact("Eclipse", InpEnableEclipse, yModules+82, xLeft);
   
   int yShields = yModules + 105;
   CreateRect(g_prefix+"ShieldsBG", xLeft, yShields, wLeft, 50, clrBG, clrGrayBox);
   SetLabel(g_prefix+"ShieldsTitle", xLeft+10, yShields+8, "SHIELDS", clrBlue, 8, "Arial Bold");
   
   string propStatus = InpPropFirmMode ? "ON" : "OFF";
   color propColor = InpPropFirmMode ? clrTextGreen : clrTextRed;
   SetLabel(g_prefix+"Prop", xLeft+10, yShields+24, "PROP: "+propStatus, propColor, 7, "Arial");
   SetLabel(g_prefix+"Weekend", xLeft+70, yShields+24, "WKND: "+(InpWeekendShield ? "ON" : "OFF"), InpWeekendShield ? clrTextGreen : clrGray, 7, "Arial");
   SetLabel(g_prefix+"SpreadShield", xLeft+140, yShields+24, "SPRD: "+(InpSpreadShieldEnabled ? "ON" : "OFF"), InpSpreadShieldEnabled ? clrTextGreen : clrTextRed, 7, "Arial");
   
   string aiTxt = (g_ai_status == 1) ? "READY" : ((g_ai_status == 2) ? "FAIL" : "OFF");
   color aiClr = (g_ai_status == 1) ? clrTextGreen : ((g_ai_status == 2) ? clrTextRed : clrGray);
   SetLabel(g_prefix+"AI", xLeft+210, yShields+24, "AI: "+aiTxt, aiClr, 7, "Arial Bold");
   
   int yButtons = yShields + 60;
   CreateButton(g_prefix+"BtnPause", xLeft+10, yButtons, 140, 28, g_isPaused ? "RESUME" : "PAUSE", clrText, g_isPaused ? clrGreen : clrRed);
   CreateButton(g_prefix+"BtnClose", xLeft+155, yButtons, 140, 28, "CLOSE ALL", clrText, clrOrange);
   
   SetLabel(g_prefix+"Footer", xLeft+10, yButtons+32, "algotraders24.ai | BTC v1.00", clrGoldColor, 7, "Arial");
   
   int yTrades = yButtons + 50;
   CreateRect(g_prefix+"TradesBG", xLeft, yTrades, wLeft, 100, clrBG, clrGrayBox);
   SetLabel(g_prefix+"TradesTitle", xLeft+10, yTrades+8, "LAST 5 TRADES", clrBlue, 8, "Arial Bold");
   
   int tradeNum = 1;
   int yTrade = yTrades + 22;
   
   for(int i = HistoryDealsTotal() - 1; i >= 0 && tradeNum <= 5; i--) {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket > 0 && HistoryDealGetInteger(ticket, DEAL_MAGIC) == (long)InpMagicNumber && HistoryDealGetString(ticket, DEAL_SYMBOL) == _Symbol) {
         datetime closeTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
         long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
         
         string side = (dealType == DEAL_TYPE_BUY) ? "B" : "S";
         color profitColor = (profit >= 0) ? clrTextGreen : clrTextRed;
         string grade = GetTradeGrade(profit);
         
         SetLabel(g_prefix+"TNum"+IntegerToString(tradeNum), xLeft+10, yTrade, IntegerToString(tradeNum), clrText, 7, "Arial");
         SetLabel(g_prefix+"TSide"+IntegerToString(tradeNum), xLeft+28, yTrade, side, side == "B" ? clrTextGreen : clrTextRed, 7, "Arial Bold");
         SetLabel(g_prefix+"TProfit"+IntegerToString(tradeNum), xLeft+55, yTrade, "$"+DoubleToString(profit, 2), profitColor, 8, "Arial Bold");
         SetLabel(g_prefix+"TGrade"+IntegerToString(tradeNum), xLeft+130, yTrade, grade, clrGoldColor, 7, "Arial");
         SetLabel(g_prefix+"TTime"+IntegerToString(tradeNum), xLeft+170, yTrade, TimeToString(closeTime, TIME_DATE|TIME_MINUTES), clrGray, 7, "Arial");
         
         yTrade += 18;
         tradeNum++;
      }
   }
   
   ChartRedraw(0);
}

void CreateModuleRowCompact(string moduleName, bool enabled, int yPos, int xPos) {
   string status = enabled ? "ON" : "OFF";
   color statusColor = enabled ? clrTextGreen : clrTextRed;
   SetLabel(g_prefix+"Mod"+moduleName, xPos+10, yPos, moduleName+": "+status, statusColor, 7, "Arial");
}

string GetTradeGrade(double profit) {
   if(profit >= 10.0) return "S+ BEST";
   if(profit >= 5.0) return "A+ EXC";
   if(profit >= 2.0) return "A GOOD";
   if(profit >= 0) return "B NORM";
   if(profit >= -2.0) return "C POOR";
   return "D LOSS";
}

void CreateRect(string name, int x, int y, int w, int h, color bgColor, color borderColor) {
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bgColor);
   ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, name, OBJPROP_COLOR, borderColor);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void SetLabel(string name, int x, int y, string text, color clr, int size, string font) {
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, size);
   ObjectSetString(0, name, OBJPROP_FONT, font);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void CreateButton(string name, int x, int y, int w, int h, string text, color txtColor, color bgColor) {
   if(ObjectFind(0, name) < 0) ObjectCreate(0, name, OBJ_BUTTON, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, txtColor);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bgColor);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, 8);
   ObjectSetString(0, name, OBJPROP_FONT, "Arial Bold");
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void UpdateStatistics() {
   g_totalWins = 0;
   g_totalLosses = 0;
   g_totalProfit = 0;
   
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--) {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket > 0 && HistoryDealGetInteger(ticket, DEAL_MAGIC) == (long)InpMagicNumber && HistoryDealGetString(ticket, DEAL_SYMBOL) == _Symbol) {
         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);
         g_totalProfit += profit;
         if(profit > 0) g_totalWins++;
         else if(profit < 0) g_totalLosses++;
      }
   }
}

void ManageTradeExits() {
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol() != _Symbol || posInfo.Magic() != InpMagicNumber) continue;
      
      ulong ticket = posInfo.Ticket();
      int idx = FindLock(ticket);
      if(idx == -1) idx = AddLock(ticket);
      
      double openPrice = posInfo.PriceOpen();
      double currentSL = posInfo.StopLoss();
      double currentTP = posInfo.TakeProfit();
      double currentPrice = posInfo.PriceCurrent();
      double profit = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();
      
      long digits_long = SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
      int digits = (int)digits_long;
      
      if(InpTimeStopEnabled) {
         long posTime = PositionGetInteger(POSITION_TIME);
         int minutesOpen = (int)((TimeCurrent() - posTime) / 60);
         if(minutesOpen >= InpTimeStopMinutes && profit < 0) {
            trade.PositionClose(ticket);
            RemoveLock(idx);
            continue;
         }
      }
      
      if(InpAutoBreakeven && !g_locks[idx].isBE) {
         double triggerDist = InpBE_TriggerPoints * point;
         double lockDist = InpBE_LockPoints * point;
         
         if(posInfo.PositionType() == POSITION_TYPE_BUY) {
            if((currentPrice - openPrice) >= triggerDist) {
               double newSL = NormalizeDouble(openPrice + lockDist, digits);
               if(newSL > currentSL && newSL < currentPrice) {
                  trade.PositionModify(ticket, newSL, currentTP);
                  g_locks[idx].isBE = true;
               }
            }
         } else {
            if((openPrice - currentPrice) >= triggerDist) {
               double newSL = NormalizeDouble(openPrice - lockDist, digits);
               if((newSL < currentSL || currentSL == 0) && newSL > currentPrice) {
                  trade.PositionModify(ticket, newSL, currentTP);
                  g_locks[idx].isBE = true;
               }
            }
         }
      }
      
      if(InpSmartTrailing) {
         double trailStartDist = InpTrailStartPoints * point;
         double trailStepDist = InpTrailStepPoints * point;
         
         if(posInfo.PositionType() == POSITION_TYPE_BUY) {
            if((currentPrice - openPrice) >= trailStartDist) {
               double newSL = NormalizeDouble(currentPrice - trailStepDist, digits);
               if(newSL > currentSL) trade.PositionModify(ticket, newSL, currentTP);
            }
         } else {
            if((openPrice - currentPrice) >= trailStartDist) {
               double newSL = NormalizeDouble(currentPrice + trailStepDist, digits);
               if(newSL < currentSL || currentSL == 0) trade.PositionModify(ticket, newSL, currentTP);
            }
         }
      }
      
      if(InpMoonLockEnabled) {
         if(!g_locks[idx].active && profit >= InpMoonLockStart) {
            g_locks[idx].active = true;
            g_locks[idx].peakProfit = profit;
         }
         if(g_locks[idx].active && profit > g_locks[idx].peakProfit) {
            g_locks[idx].peakProfit = profit;
         }
         if(g_locks[idx].active && profit <= g_locks[idx].peakProfit * (InpMoonLockPercent / 100.0) && profit > 0) {
            trade.PositionClose(ticket);
            RemoveLock(idx);
         }
      }
   }
}

bool CheckPropFirmLimits() {
   double currentEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_peakEquity = MathMax(g_peakEquity, currentEquity);
   
   if(InpPropFirmMode) {
      double profitTargetAmount = g_dailyStartEquity * (InpPropFirmProfitTarget / 100.0);
      if((currentEquity - g_dailyStartEquity) >= profitTargetAmount) {
         CloseAllPositions(); DeleteAllPendingOrders(); g_isPaused = true; return true;
      }
      double maxDDAmount = g_peakEquity * (InpPropFirmMaxDrawdown / 100.0);
      if((g_peakEquity - currentEquity) >= maxDDAmount) {
         CloseAllPositions(); DeleteAllPendingOrders(); g_isPaused = true; return true;
      }
   }
   else if(InpDailyLossLimitEnabled) {
      double maxLossAmount = g_dailyStartEquity * (InpMaxDailyLossPercent / 100.0);
      if((g_dailyStartEquity - currentEquity) >= maxLossAmount) {
         CloseAllPositions(); DeleteAllPendingOrders(); g_isPaused = true; return true;
      }
   }
   return false;
}

void CloseAllPositions() {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(posInfo.SelectByIndex(i)) {
         if(posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber) {
            trade.PositionClose(posInfo.Ticket());
         }
      }
   }
}

bool IsTrendUp() {
   if(!InpUseMTFTrend) return true;
   double fast = GetInd(handle_ema_fast, 0, 1);
   double slow = GetInd(handle_ema_slow, 0, 1);
   return (fast > slow && fast > 0 && slow > 0);
}

bool IsTrendDown() {
   if(!InpUseMTFTrend) return true;
   double fast = GetInd(handle_ema_fast, 0, 1);
   double slow = GetInd(handle_ema_slow, 0, 1);
   return (fast < slow && fast > 0 && slow > 0);
}

bool IsWeekendBlocked() {
   if(!InpWeekendShield) return false;
   MqlDateTime dt; TimeCurrent(dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return true;
   if(dt.day_of_week == 5 && dt.hour >= InpFridayPauseHour) return true;
   if(dt.day_of_week == 1 && dt.hour < InpMondayResumeHour) return true;
   return false;
}

bool IsSpreadBlocked() {
   if(!InpSpreadShieldEnabled) return false;
   long raw_spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   int spread_val = (int)raw_spread;
   return (spread_val > InpMaxSpreadPoints);
}

void PlaceBreakoutOrders() {
   g_tradesToday = CountTodayTrades();
   if(g_tradesToday >= InpMaxTradesPerDay) return;
   
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   
   long digits_long = SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   long stopLevel_long = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   int digits = (int)digits_long;
   int stopLevel = (int)stopLevel_long;
   double minDist = (stopLevel + 10) * point;
   
   double slDist = InpStopLossPoints * point;
   double tpDist = InpTakeProfitPoints * point;
   double buffer = InpBreakoutBufferPoints * point;
   
   double atr_val = GetInd(handle_atr, 0, 1);
   if(atr_val <= 0) return;
   
   double lot = CalculateLotSize();
   
   bool trendUp = IsTrendUp();
   bool trendDown = IsTrendDown();
   
   double aiBuy = GetAIScore(1.0);
   double aiSell = GetAIScore(-1.0);
   
   if(InpEnableNova) {
      double h = iHigh(_Symbol, PERIOD_D1, 1), l = iLow(_Symbol, PERIOD_D1, 1);
      if(h>0 && l>0) {
         if(trendUp && aiBuy >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_BUY_STOP, h+buffer, slDist, tpDist, "Nova_Buy", digits, minDist, lot);
         if(trendDown && aiSell >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_SELL_STOP, l-buffer, slDist, tpDist, "Nova_Sell", digits, minDist, lot);
      }
   }
   
   if(InpEnableApex) {
      double h = iHigh(_Symbol, InpTF, iHighest(_Symbol, InpTF, MODE_HIGH, 12, 1));
      double l = iLow(_Symbol, InpTF, iLowest(_Symbol, InpTF, MODE_LOW, 12, 1));
      if(h>0 && l>0) {
         if(trendUp && aiBuy >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_BUY_STOP, h+buffer, slDist, tpDist, "Apex_Buy", digits, minDist, lot);
         if(trendDown && aiSell >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_SELL_STOP, l-buffer, slDist, tpDist, "Apex_Sell", digits, minDist, lot);
      }
   }
   
   if(InpEnableZenith) {
      double h = iHigh(_Symbol, InpTF, iHighest(_Symbol, InpTF, MODE_HIGH, 20, 1));
      double l = iLow(_Symbol, InpTF, iLowest(_Symbol, InpTF, MODE_LOW, 20, 1));
      if(h>0 && l>0) {
         if(trendUp && aiBuy >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_BUY_STOP, h+buffer, slDist, tpDist, "Zenith_Buy", digits, minDist, lot);
         if(trendDown && aiSell >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_SELL_STOP, l-buffer, slDist, tpDist, "Zenith_Sell", digits, minDist, lot);
      }
   }
   
   if(InpEnablePulse) {
      double lc = iClose(_Symbol, InpTF, 1);
      double pu = lc + (atr_val*0.5), pd = lc - (atr_val*0.5);
      if(trendUp && aiBuy >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_BUY_STOP, pu, slDist, tpDist, "Pulse_Buy", digits, minDist, lot);
      if(trendDown && aiSell >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_SELL_STOP, pd, slDist, tpDist, "Pulse_Sell", digits, minDist, lot);
   }
   
   if(InpEnableEclipse) {
      double h = GetInd(handle_fractals, 0, 2), l = GetInd(handle_fractals, 1, 2);
      if(h>0 && l>0) {
         if(trendUp && aiBuy >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_BUY_STOP, h+buffer, slDist, tpDist, "Eclipse_Buy", digits, minDist, lot);
         if(trendDown && aiSell >= InpAIScoreThreshold) PlacePending(ORDER_TYPE_SELL_STOP, l-buffer, slDist, tpDist, "Eclipse_Sell", digits, minDist, lot);
      }
   }
}

void PlacePending(ENUM_ORDER_TYPE type, double price, double slDist, double tpDist, string moduleName, int digits, double minDist, double lot) {
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(type == ORDER_TYPE_BUY_STOP && price <= ask + minDist) return;
   if(type == ORDER_TYPE_SELL_STOP && price >= bid - minDist) return;
   
   price = NormalizeDouble(price, digits);
   double sl = (type == ORDER_TYPE_BUY_STOP) ? NormalizeDouble(price - slDist, digits) : NormalizeDouble(price + slDist, digits);
   double tp = (type == ORDER_TYPE_BUY_STOP) ? NormalizeDouble(price + tpDist, digits) : NormalizeDouble(price - tpDist, digits);
   
   if(type == ORDER_TYPE_BUY_STOP) trade.BuyStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, moduleName);
   else trade.SellStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, moduleName);
}

double CalculateLotSize() {
   if(InpSizingMode == 1) {
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double risk_amount = balance * (InpRiskPercent / 100.0);
      double sl_distance_price = InpStopLossPoints * SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      double tick_value = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tick_size = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tick_size == 0 || tick_value == 0) return InpFixedLot;
      double lot = risk_amount / ((sl_distance_price / tick_size) * tick_value);
      if(InpMaxLot > 0 && lot > InpMaxLot) lot = InpMaxLot;
      double lot_step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      lot = MathFloor(lot / lot_step) * lot_step;
      double min_lot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      return (lot < min_lot) ? min_lot : lot;
   } else {
      double base_lot = InpFixedLot;
      if(InpAutoLotGrowth) {
         double growth_amount = AccountInfoDouble(ACCOUNT_BALANCE) - InpAutoLotBaseBalance;
         if(growth_amount > 0) {
            int steps = (int)MathFloor(growth_amount / InpAutoLotBalanceStep);
            base_lot += (steps * InpAutoLotStepSize);
         }
      }
      if(InpMaxLot > 0 && base_lot > InpMaxLot) base_lot = InpMaxLot;
      return base_lot;
   }
}

double GetInd(int handle, int buffer, int shift) {
   double buf[]; ArraySetAsSeries(buf, true);
   return (CopyBuffer(handle, buffer, shift, 1, buf) > 0) ? buf[0] : 0;
}

void DeleteStalePendingOrders() {
   datetime now = TimeCurrent();
   for(int i=OrdersTotal()-1; i>=0; i--) {
      ulong t = OrderGetTicket(i);
      if(t>0 && OrderGetString(ORDER_SYMBOL)==_Symbol && OrderGetInteger(ORDER_MAGIC)==(long)InpMagicNumber) {
         if(now - (datetime)OrderGetInteger(ORDER_TIME_SETUP) > 1800) trade.OrderDelete(t);
      }
   }
}

void DeleteAllPendingOrders() {
   for(int i=OrdersTotal()-1; i>=0; i--) {
      ulong t = OrderGetTicket(i);
      if(t>0 && OrderGetString(ORDER_SYMBOL)==_Symbol && OrderGetInteger(ORDER_MAGIC)==(long)InpMagicNumber) trade.OrderDelete(t);
   }
}

int CountTodayTrades() {
   int c=0;
   for(int i=HistoryDealsTotal()-1; i>=0; i--) {
      ulong t = HistoryDealGetTicket(i);
      if(t>0 && HistoryDealGetInteger(t,DEAL_MAGIC)==(long)InpMagicNumber && HistoryDealGetString(t,DEAL_SYMBOL)==_Symbol) {
         if((datetime)HistoryDealGetInteger(t,DEAL_TIME) >= g_todayStart) c++;
      }
   }
   return c;
}

void CheckNewDay() {
   MqlDateTime dt; TimeCurrent(dt);
   string dateStr = StringFormat("%04d.%02d.%02d 00:00:00", dt.year, dt.mon, dt.day);
   datetime ts = StringToTime(dateStr);
   
   if(TimeCurrent() >= ts && g_todayStart != ts) {
      g_todayStart = ts; g_tradesToday = 0;
      g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      g_peakEquity = g_dailyStartEquity; g_isPaused = false;
   }
}

bool IsNewBar() {
   datetime t = iTime(_Symbol, InpTF, 0);
   if(t != g_lastBarTime) { g_lastBarTime = t; return true; }
   return false;
}

int FindLock(ulong t) { for(int i=0;i<ArraySize(g_locks);i++) if(g_locks[i].ticket==t) return i; return -1; }
int AddLock(ulong t) { int s=ArraySize(g_locks); ArrayResize(g_locks,s+1); g_locks[s].ticket=t; g_locks[s].peakProfit=0; g_locks[s].active=false; g_locks[s].isBE=false; return s; }
void RemoveLock(int idx) { int s=ArraySize(g_locks); if(idx<0||idx>=s) return; for(int i=idx;i<s-1;i++) g_locks[i]=g_locks[i+1]; ArrayResize(g_locks,s-1); }
//+------------------------------------------------------------------+