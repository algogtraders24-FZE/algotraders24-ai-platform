//+------------------------------------------------------------------+
//|                                          XXXUS30_Index_v1.14.mq5 |
//|                        Copyright algotraders24.ai                  |
//|   XXX US30 - fixed build of v1.01: every module keeps its own      |
//|   order, but each module has exactly ONE order/position at a time. |
//+------------------------------------------------------------------+
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property version   "1.14"
#property description "XXX US30 - Powered by ALGOTRADERS24 AI"
#property description "XXX US30: 3 modules (Nova, Apex, Zenith), one order per module. ONNX AI filter (optional). Unique canvas dashboard."

//--- AT24 licence gate: one key = one trading account, only for this product (Strategy Tester needs no key)
#define AT24_PRODUCT_ID "XXXUS30"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = ""; // AT24 licence key (from your AT24 purchase page)

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Canvas\Canvas.mqh>

#resource "xxxus30_filter_embedded.onnx" as uchar g_EmbeddedModel[]

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

enum ENUM_SIZING
  {
   SIZE_FIXED = 0,   // FIXED lot
   SIZE_RISK  = 1    // RISK % of balance
  };

//--- INPUTS (names and order of v1.01 kept, so old .set files still load)
input group "=== LOT SIZE ==="
input ENUM_SIZING InpSizingMode      = SIZE_FIXED;
input double InpFixedLot             = 0.01;
input double InpRiskPercent          = 2.0;
input double InpMaxLot               = 0.0;     // 0 = no extra cap (broker max still applies)
input bool   InpAutoLotGrowth        = false;
input double InpAutoLotBaseBalance   = 1000.0;
input double InpAutoLotBalanceStep   = 500.0;
input double InpAutoLotStepSize      = 0.01;

input group "=== TRADE MANAGEMENT (US30 POINTS) ==="
input bool   InpMoonLockEnabled      = true;
input double InpMoonLockStart        = 1.0;     // account currency
input double InpMoonLockPercent      = 50.0;
input double InpStopLossPoints       = 1200.0;
input double InpTakeProfitPoints     = 4000.0;
input bool   InpAutoBreakeven        = true;
input double InpBE_TriggerPoints     = 400.0;
input double InpBE_LockPoints        = 100.0;
input bool   InpTimeStopEnabled      = true;
input int    InpTimeStopMinutes      = 45;
input bool   InpSmartTrailing        = true;
input double InpTrailStartPoints     = 800.0;
input double InpTrailStepPoints      = 400.0;    // distance the stop follows the price at (as in v1.01)
input double InpTrailMinImprovePts   = 100.0;    // minimum stop improvement per modification (0 = every tick)

input group "=== MODULES (one order per module) ==="
input bool   InpEnableNova           = true;
input bool   InpEnableApex           = true;
input bool   InpEnableZenith         = true;
input int    InpMaxConcurrent        = 3;       // max orders + positions together (5 = every module may hold one)
input int    InpPendingBars          = 2;       // a pending order expires after this many bars of the entry timeframe
input bool   InpBuyLevelAddSpread    = true;    // BUY STOP triggers on the Ask but highs are Bid based: add the spread to every buy level
input int    InpMinLevelGapPoints    = 0;       // 0 = off. >0: skip an order whose price is within this many points of another order/position of the same direction (stops two modules stacking on one breakout)

input group "=== MTF TREND ==="
input bool   InpUseMTFTrend          = true;
input ENUM_TIMEFRAMES InpMTF_Timeframe = PERIOD_H1;
input int    InpFastEMA              = 50;
input int    InpSlowEMA              = 200;

input group "=== ONNX AI FILTER (US30 TRAINED) ==="
input bool   InpUseONNX              = true;
input double InpAIScoreThreshold     = 0.80;
input string InpONNXFile             = "xxxus30_filter.onnx";
input bool   InpRequireAI            = false;   // true = NO trade while the AI model is not loaded (false = fail-safe: trade without AI, as v1.01)

input group "=== SHIELDS ==="
input bool   InpWeekendShield        = true;
input int    InpFridayPauseHour      = 20;
input int    InpMondayResumeHour     = 5;
input bool   InpSpreadShieldEnabled  = true;
input int    InpMaxSpreadPoints      = 300;

input group "=== PROP FIRM ==="
input bool   InpPropFirmMode         = false;
input double InpPropFirmMaxDrawdown  = 10.0;    // % below the highest equity ever seen (kept across days)
input double InpPropFirmProfitTarget = 8.0;     // % above the balance the EA first started with
input bool   InpDailyLossLimitEnabled= false;
input double InpMaxDailyLossPercent  = 5.0;

input group "=== GENERAL ==="
input ENUM_TIMEFRAMES InpTF          = PERIOD_M15;
input int    InpMagicNumber          = 33302;
input int    InpMaxTradesPerDay      = 10;      // counts ENTRIES (a trade = 1), pending orders included
input double InpBreakoutBufferPoints = 50.0;
input int    InpSlippage             = 30;
input bool   InpShowDashboard        = true;
input bool   InpDashCompact          = false;   // true = small panel
input int    InpDashX                = 10;
input int    InpDashY                = 30;
input bool   InpDashInTester         = false;   // false = no panel in the Strategy Tester (faster backtests)

//--- GLOBALS
int      handle_atr = INVALID_HANDLE, handle_rsi = INVALID_HANDLE;
int      handle_ema_fast = INVALID_HANDLE, handle_ema_slow = INVALID_HANDLE;
long     onnx_handle = INVALID_HANDLE;
int      g_ai_status = 0;                 // 0 off, 1 ready, 2 failed
datetime g_lastBarTime = 0;
int      g_tradesToday = 0;
datetime g_todayStart = 0;
double   g_dailyStartEquity = 0.0;
double   g_peakEquity = 0.0;              // highest equity ever seen (persisted)
double   g_startBalance = 0.0;            // balance when the EA first ran (persisted)
bool     g_isPaused = false;
bool     g_dashOn = false;
int      g_totalWins = 0, g_totalLosses = 0;
double   g_grossProfit = 0.0, g_grossLoss = 0.0, g_totalProfit = 0.0;
datetime g_lastStats = 0;
int      g_lastN = 0;
datetime g_lastTime[5];
double   g_lastProfit[5];
string   g_lastSide[5];
string   g_lastMod[5];

struct MoonLockData { ulong ticket; double peakProfit; bool active; bool isBE; };
MoonLockData g_locks[];
string g_prefix = "XU30_";

const string MOD_NAME[3] = {"Nova", "Apex", "Zenith"};

string GVPeak()   { return "XU30_PEAK_" + (string)AccountInfoInteger(ACCOUNT_LOGIN); }
string GVStart()  { return "XU30_START_" + (string)AccountInfoInteger(ACCOUNT_LOGIN); }
string GVMod(ulong ident) { return "XU30_M_" + (string)ident; }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(1);
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(InpSlippage);
   trade.SetTypeFillingBySymbol(_Symbol);

   handle_atr = iATR(_Symbol, InpTF, 14);
   handle_rsi = iRSI(_Symbol, InpTF, 14, PRICE_CLOSE);
   if(InpUseMTFTrend)
     {
      handle_ema_fast = iMA(_Symbol, InpMTF_Timeframe, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);
      handle_ema_slow = iMA(_Symbol, InpMTF_Timeframe, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
     }
   if(handle_atr == INVALID_HANDLE || handle_rsi == INVALID_HANDLE ||
      (InpUseMTFTrend && (handle_ema_fast == INVALID_HANDLE || handle_ema_slow == INVALID_HANDLE)))
     {
      Print("XXX US30: indicator handle failed");
      return INIT_FAILED;
     }
   if(InpStopLossPoints <= 0 || InpTakeProfitPoints <= 0 || InpFixedLot <= 0)
     {
      Print("XXX US30: stop loss, take profit and fixed lot must be > 0");
      return INIT_PARAMETERS_INCORRECT;
     }

   //--- ONNX model
   g_ai_status = 0;
   onnx_handle = INVALID_HANDLE;
   if(InpUseONNX)
     {
      onnx_handle = OnnxCreateFromBuffer(g_EmbeddedModel, ONNX_DEFAULT);                       // model built into this .ex5
      if(onnx_handle == INVALID_HANDLE) onnx_handle = OnnxCreate(InpONNXFile, ONNX_DEFAULT);   // else the file in MQL5\Files
      if(onnx_handle == INVALID_HANDLE)
        {
         g_ai_status = 2;
         Print("WARNING: ONNX file not found or invalid: ", InpONNXFile, InpRequireAI ? " - trading is BLOCKED (InpRequireAI = true)" : " - AI DISABLED (fail-safe: the EA trades without the AI filter)");
        }
      else
        {
         long in_shape[2]  = {1, 5};
         long out_shape[2] = {1, 1};
         if(!OnnxSetInputShape(onnx_handle, 0, in_shape) || !OnnxSetOutputShape(onnx_handle, 0, out_shape))
           {
            Print("WARNING: failed to set the ONNX shapes");
            OnnxRelease(onnx_handle);
            onnx_handle = INVALID_HANDLE;
            g_ai_status = 2;
           }
         else
           {
            g_ai_status = 1;
            Print("ONNX AI model loaded: ", InpONNXFile, " | threshold ", DoubleToString(InpAIScoreThreshold, 2));
           }
        }
     }

   g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_peakEquity = GlobalVariableCheck(GVPeak()) ? MathMax(GlobalVariableGet(GVPeak()), g_dailyStartEquity) : g_dailyStartEquity;
   g_startBalance = GlobalVariableCheck(GVStart()) ? GlobalVariableGet(GVStart()) : AccountInfoDouble(ACCOUNT_BALANCE);
   GlobalVariableSet(GVStart(), g_startBalance);
   GlobalVariableSet(GVPeak(), g_peakEquity);

   g_dashOn = InpShowDashboard && (!MQLInfoInteger(MQL_TESTER) || (InpDashInTester && MQLInfoInteger(MQL_VISUAL_MODE)));
   if(g_dashOn && !Dash_Init()) g_dashOn = false;

   Print("=== XXX US30 v1.14 started | ", _Symbol, " | digits ", (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS), " | point ", DoubleToString(SymbolInfoDouble(_Symbol, SYMBOL_POINT), 5),
         " | SL ", DoubleToString(InpStopLossPoints * SymbolInfoDouble(_Symbol, SYMBOL_POINT), 2), " price units | stops level ", SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL),
         " pts | spread ", SymbolInfoInteger(_Symbol, SYMBOL_SPREAD), " pts ===");
   return INIT_SUCCEEDED;
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   Dash_Deinit();
   EventKillTimer();
   ObjectsDeleteAll(0, g_prefix);
   ChartRedraw(0);
   if(handle_atr != INVALID_HANDLE)       IndicatorRelease(handle_atr);
   if(handle_rsi != INVALID_HANDLE)       IndicatorRelease(handle_rsi);
   if(handle_ema_fast != INVALID_HANDLE)  IndicatorRelease(handle_ema_fast);
   if(handle_ema_slow != INVALID_HANDLE)  IndicatorRelease(handle_ema_slow);
   if(onnx_handle != INVALID_HANDLE)      OnnxRelease(onnx_handle);
   onnx_handle = INVALID_HANDLE;
   Print("=== XXX US30 stopped ===");
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   AT24Gate_Timer(InpLicenseKey);
   if(!g_dashOn) return;
   Dash_Update();
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   CheckNewDay();
   ManageTradeExits();

   bool isBlocked = g_isPaused || !AT24Gate_Allowed() || IsWeekendBlocked() || IsSpreadBlocked() || CheckPropFirmLimits();
   if(isBlocked)
     {
      DeleteAllPendingOrders();
      return;
     }
   DeleteStalePendingOrders();
   if(IsNewBar()) PlaceBreakoutOrders();
  }

//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
  {
   if(id != CHARTEVENT_OBJECT_CLICK) return;
   if(sparam == g_prefix + "BtnPause")
     {
      g_isPaused = !g_isPaused;
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      ChartRedraw(0);
     }
   if(sparam == g_prefix + "BtnClose")
     {
      CloseAllPositions();
      ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
      ChartRedraw(0);
     }
  }

//+------------------------------------------------------------------+
//| ONNX AI SCORE - 5 features (identical to v1.01 / Python training)|
//+------------------------------------------------------------------+
double GetAIScore(double dir)
  {
   if(!InpUseONNX || onnx_handle == INVALID_HANDLE || g_ai_status != 1)
      return InpRequireAI ? 0.0 : 1.0;

   double close1 = iClose(_Symbol, InpTF, 1);
   double rsi = GetInd(handle_rsi, 0, 1);
   double atr = GetInd(handle_atr, 0, 1);
   if(close1 <= 0 || atr <= 0 || rsi <= 0)
      return InpRequireAI ? 0.0 : 1.0;

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
   if(!OnnxRun(onnx_handle, ONNX_NO_CONVERSION, in, out))
     {
      Print("ONNX inference failed - AI marked as failed");
      g_ai_status = 2;
      return InpRequireAI ? 0.0 : 1.0;
     }
   return (double)out[0];
  }

//+------------------------------------------------------------------+
//| HELPERS                                                          |
//+------------------------------------------------------------------+
double GetInd(int handle, int buffer, int shift)
  {
   double buf[]; ArraySetAsSeries(buf, true);
   return (CopyBuffer(handle, buffer, shift, 1, buf) > 0) ? buf[0] : 0;
  }

double MinStopDistance()
  {
   long stops  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freeze = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   return (double)MathMax(stops, freeze) * SymbolInfoDouble(_Symbol, SYMBOL_POINT);
  }

int LotDigits(double step)
  {
   int d = 0; double s = step;
   while(d < 8 && MathAbs(s - MathRound(s)) > 1e-9) { s *= 10.0; d++; }
   return d;
  }

bool IsTrendUp()
  {
   if(!InpUseMTFTrend) return true;
   double fast = GetInd(handle_ema_fast, 0, 1), slow = GetInd(handle_ema_slow, 0, 1);
   return (fast > slow && fast > 0 && slow > 0);
  }

bool IsTrendDown()
  {
   if(!InpUseMTFTrend) return true;
   double fast = GetInd(handle_ema_fast, 0, 1), slow = GetInd(handle_ema_slow, 0, 1);
   return (fast < slow && fast > 0 && slow > 0);
  }

bool IsWeekendBlocked()
  {
   if(!InpWeekendShield) return false;
   MqlDateTime dt; TimeCurrent(dt);
   if(dt.day_of_week == 0 || dt.day_of_week == 6) return true;
   if(dt.day_of_week == 5 && dt.hour >= InpFridayPauseHour) return true;
   if(dt.day_of_week == 1 && dt.hour < InpMondayResumeHour) return true;
   return false;
  }

bool IsSpreadBlocked()
  {
   if(!InpSpreadShieldEnabled) return false;
   return ((int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPoints);
  }

bool IsNewBar()
  {
   datetime t = iTime(_Symbol, InpTF, 0);
   if(t != g_lastBarTime) { g_lastBarTime = t; return true; }
   return false;
  }

void CheckNewDay()
  {
   datetime ts = iTime(_Symbol, PERIOD_D1, 0);
   if(ts > 0 && g_todayStart != ts)
     {
      g_todayStart = ts; g_tradesToday = 0;
      g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      g_isPaused = false;
     }
  }

//+------------------------------------------------------------------+
//| ORDER / POSITION BOOKKEEPING (per module)                        |
//+------------------------------------------------------------------+
int CountOurPositions()
  {
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber) c++;
   return c;
  }

int CountOurPendings()
  {
   int c = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && OrderGetInteger(ORDER_MAGIC) == (long)InpMagicNumber) c++;
     }
   return c;
  }

// true while this module has a pending order OR an open position (so it can never hold two)
bool ModuleActive(int m)
  {
   string name = MOD_NAME[m];
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0 || OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != (long)InpMagicNumber) continue;
      if(StringFind(OrderGetString(ORDER_COMMENT), name) == 0) return true;
     }
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i) || posInfo.Symbol() != _Symbol || posInfo.Magic() != InpMagicNumber) continue;
      ulong ident = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      if(GlobalVariableCheck(GVMod(ident)))
        { if((int)GlobalVariableGet(GVMod(ident)) == m) return true; }
      else if(StringFind(posInfo.Comment(), name) == 0) return true;
     }
   return false;
  }

// "Nova", "Apex" ... of an open position (for the dashboard)
string PositionModuleName(ulong ident, string comment)
  {
   if(GlobalVariableCheck(GVMod(ident))) { int m = (int)GlobalVariableGet(GVMod(ident)); if(m >= 0 && m < 3) return MOD_NAME[m]; }
   return comment;
  }

int CountTodayEntries()
  {
   if(!HistorySelect(g_todayStart, TimeCurrent() + 86400)) return 0;
   int c = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      if(HistoryDealGetInteger(t, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;              // a trade counts once (entry), not twice
      if(HistoryDealGetInteger(t, DEAL_MAGIC) != (long)InpMagicNumber || HistoryDealGetString(t, DEAL_SYMBOL) != _Symbol) continue;
      c++;
     }
   return c;
  }

void DeleteStalePendingOrders()
  {
   long life = (long)InpPendingBars * PeriodSeconds(InpTF) + 30;
   datetime now = TimeCurrent();
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0 || OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != (long)InpMagicNumber) continue;
      if(now - (datetime)OrderGetInteger(ORDER_TIME_SETUP) > life) trade.OrderDelete(t);
     }
  }

void DeleteAllPendingOrders()
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && OrderGetInteger(ORDER_MAGIC) == (long)InpMagicNumber) trade.OrderDelete(t);
     }
  }

void CloseAllPositions()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber) trade.PositionClose(posInfo.Ticket());
  }

//+------------------------------------------------------------------+
//| LOT                                                              |
//+------------------------------------------------------------------+
double CalculateLotSize()
  {
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0) step = 0.01;
   double lot = InpFixedLot;

   if(InpSizingMode == SIZE_RISK)
     {
      double riskMoney = AccountInfoDouble(ACCOUNT_BALANCE) * (InpRiskPercent / 100.0);
      double slDist = InpStopLossPoints * SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      double tv = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE), ts = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(ts > 0 && tv > 0 && slDist > 0) lot = riskMoney / ((slDist / ts) * tv);
     }
   else if(InpAutoLotGrowth)
     {
      double growth = AccountInfoDouble(ACCOUNT_BALANCE) - InpAutoLotBaseBalance;
      if(growth > 0 && InpAutoLotBalanceStep > 0) lot += (int)MathFloor(growth / InpAutoLotBalanceStep) * InpAutoLotStepSize;
     }
   if(InpMaxLot > 0) lot = MathMin(lot, InpMaxLot);
   lot = MathFloor(lot / step + 1e-9) * step;
   if(lot < minLot) lot = minLot;
   lot = MathMin(lot, maxLot);
   return NormalizeDouble(lot, LotDigits(step));
  }

//+------------------------------------------------------------------+
//| ENTRY - three modules, each with its own single order             |
//+------------------------------------------------------------------+
// entry levels of module m: buyLevel / sellLevel (0 = module has no level)
void ModuleLevels(int m, double buffer, double &buyLevel, double &sellLevel)
  {
   buyLevel = 0; sellLevel = 0;
   if(m == 0)        // Nova: yesterday's high / low
     {
      double h = iHigh(_Symbol, PERIOD_D1, 1), l = iLow(_Symbol, PERIOD_D1, 1);
      if(h > 0 && l > 0) { buyLevel = h + buffer; sellLevel = l - buffer; }
     }
   else if(m == 1 || m == 2)   // Apex (12 bars) / Zenith (20 bars)
     {
      int bars = (m == 1) ? 12 : 20;
      double h = iHigh(_Symbol, InpTF, iHighest(_Symbol, InpTF, MODE_HIGH, bars, 1));
      double l = iLow(_Symbol, InpTF, iLowest(_Symbol, InpTF, MODE_LOW, bars, 1));
      if(h > 0 && l > 0) { buyLevel = h + buffer; sellLevel = l - buffer; }
     }
  }

bool ModuleEnabled(int m)
  {
   if(m == 0) return InpEnableNova;
   if(m == 1) return InpEnableApex;
   return InpEnableZenith;
  }

// another order / position of ours in the same direction sits within InpMinLevelGapPoints of this price
bool LevelTaken(bool buy, double price)
  {
   double gap = InpMinLevelGapPoints * SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong tk = OrderGetTicket(i);
      if(tk == 0 || OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != (long)InpMagicNumber) continue;
      ENUM_ORDER_TYPE ty = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      if((buy && ty != ORDER_TYPE_BUY_STOP) || (!buy && ty != ORDER_TYPE_SELL_STOP)) continue;
      if(MathAbs(OrderGetDouble(ORDER_PRICE_OPEN) - price) <= gap) return true;
     }
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i) || posInfo.Symbol() != _Symbol || posInfo.Magic() != InpMagicNumber) continue;
      if((posInfo.PositionType() == POSITION_TYPE_BUY) != buy) continue;
      if(MathAbs(posInfo.PriceOpen() - price) <= gap) return true;
     }
   return false;
  }

void PlaceBreakoutOrders()
  {
   int entriesPlusPending = CountTodayEntries() + CountOurPendings();
   g_tradesToday = CountTodayEntries();
   if(entriesPlusPending >= InpMaxTradesPerDay) return;

   double atr = GetInd(handle_atr, 0, 1);
   if(atr <= 0) return;
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double buffer = InpBreakoutBufferPoints * point;
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double minD = MinStopDistance() + 10 * point;

   bool trendUp = IsTrendUp(), trendDown = IsTrendDown();
   double aiBuy = GetAIScore(1.0), aiSell = GetAIScore(-1.0);        // once per bar
   bool buyOK = trendUp && aiBuy >= InpAIScoreThreshold;
   bool sellOK = trendDown && aiSell >= InpAIScoreThreshold;
   if(!buyOK && !sellOK) return;

   int total = CountOurPositions() + CountOurPendings();
   for(int m = 0; m < 3; m++)
     {
      if(!ModuleEnabled(m)) continue;
      if(total >= InpMaxConcurrent) break;
      if(entriesPlusPending >= InpMaxTradesPerDay) break;
      if(ModuleActive(m)) continue;                                   // this module already holds its one order / position

      double bl, sl;
      ModuleLevels(m, buffer, bl, sl);
      if(InpBuyLevelAddSpread && bl > 0) bl += (ask - bid);
      bool buyValid  = buyOK  && bl > 0 && bl > ask + minD;
      bool sellValid = sellOK && sl > 0 && sl < bid - minD;
      if(!buyValid && !sellValid) continue;

      bool pickBuy;
      if(buyValid && sellValid) pickBuy = (aiBuy > aiSell) || (aiBuy == aiSell && (bl - ask) <= (bid - sl));   // trend filter OFF: one side only
      else pickBuy = buyValid;

      if(InpMinLevelGapPoints > 0 && LevelTaken(pickBuy, pickBuy ? bl : sl)) continue;
      if(PlaceOrder(m, pickBuy, pickBuy ? bl : sl))
        {
         total++;
         entriesPlusPending++;
        }
     }
  }

bool PlaceOrder(int m, bool buy, double price)
  {
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   double slDist = InpStopLossPoints * point, tpDist = InpTakeProfitPoints * point;
   if(slDist < MinStopDistance() || tpDist < MinStopDistance())
     {
      Print(MOD_NAME[m], ": SL/TP closer than the broker stops level - skipped");
      return false;
     }
   price = NormalizeDouble(price, digits);
   double sl = NormalizeDouble(buy ? price - slDist : price + slDist, digits);
   double tp = NormalizeDouble(buy ? price + tpDist : price - tpDist, digits);
   double lot = CalculateLotSize();
   if(lot <= 0) return false;

   double need = 0.0;
   if(OrderCalcMargin(buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, lot, price, need) && need > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9)
     {
      Print(MOD_NAME[m], ": not enough free margin - skipped");
      return false;
     }

   ENUM_ORDER_TYPE_TIME tt = ORDER_TIME_GTC; datetime exp = 0;
   if((SymbolInfoInteger(_Symbol, SYMBOL_EXPIRATION_MODE) & SYMBOL_EXPIRATION_SPECIFIED) != 0)
     { tt = ORDER_TIME_SPECIFIED; exp = (datetime)(TimeCurrent() + (long)InpPendingBars * PeriodSeconds(InpTF)); }

   string tag = MOD_NAME[m] + (buy ? "_Buy" : "_Sell");
   bool ok = buy ? trade.BuyStop(lot, price, _Symbol, sl, tp, tt, exp, tag) : trade.SellStop(lot, price, _Symbol, sl, tp, tt, exp, tag);
   if(ok)
     {
      GlobalVariableSet(GVMod(trade.ResultOrder()), m);               // position identifier == order ticket -> remembers the module
      Print(tag, " | lot ", DoubleToString(lot, 2), " @ ", DoubleToString(price, digits), " SL ", DoubleToString(sl, digits), " TP ", DoubleToString(tp, digits));
     }
   else Print(tag, " FAILED rc=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription());
   return ok;
  }

//+------------------------------------------------------------------+
//| TRADE MANAGEMENT                                                 |
//+------------------------------------------------------------------+
int FindLock(ulong t) { for(int i = 0; i < ArraySize(g_locks); i++) if(g_locks[i].ticket == t) return i; return -1; }
int AddLock(ulong t) { int s = ArraySize(g_locks); ArrayResize(g_locks, s + 1); g_locks[s].ticket = t; g_locks[s].peakProfit = 0; g_locks[s].active = false; g_locks[s].isBE = false; return s; }
void RemoveLock(int idx) { int s = ArraySize(g_locks); if(idx < 0 || idx >= s) return; for(int i = idx; i < s - 1; i++) g_locks[i] = g_locks[i + 1]; ArrayResize(g_locks, s - 1); }

void PurgeClosedLocks()
  {
   for(int i = ArraySize(g_locks) - 1; i >= 0; i--)
      if(!PositionSelectByTicket(g_locks[i].ticket)) RemoveLock(i);
  }

void ManageTradeExits()
  {
   PurgeClosedLocks();
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double minD = MinStopDistance();
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID), ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol() != _Symbol || posInfo.Magic() != InpMagicNumber) continue;

      ulong ticket = posInfo.Ticket();
      int idx = FindLock(ticket);
      if(idx == -1) idx = AddLock(ticket);

      double openPrice = posInfo.PriceOpen(), currentSL = posInfo.StopLoss(), currentTP = posInfo.TakeProfit();
      bool buy = (posInfo.PositionType() == POSITION_TYPE_BUY);
      double price = buy ? bid : ask;
      double profit = posInfo.Profit() + posInfo.Swap() + posInfo.Commission();

      // TIME STOP (a losing trade older than N minutes)
      if(InpTimeStopEnabled)
        {
         int minutesOpen = (int)((TimeCurrent() - (datetime)posInfo.Time()) / 60);
         if(minutesOpen >= InpTimeStopMinutes && profit < 0)
           {
            trade.PositionClose(ticket);
            RemoveLock(idx);
            continue;
           }
        }

      double newSL = currentSL;
      // BREAK-EVEN
      if(InpAutoBreakeven && !g_locks[idx].isBE)
        {
         double trig = InpBE_TriggerPoints * point, lockD = InpBE_LockPoints * point;
         if(buy ? (price - openPrice >= trig) : (openPrice - price >= trig))
           {
            double be = NormalizeDouble(buy ? openPrice + lockD : openPrice - lockD, digits);
            if(buy ? (be > newSL && be <= bid - minD) : ((be < newSL || newSL == 0) && be >= ask + minD))
              { newSL = be; g_locks[idx].isBE = true; }
           }
        }
      // TRAILING
      if(InpSmartTrailing && (buy ? (price - openPrice >= InpTrailStartPoints * point) : (openPrice - price >= InpTrailStartPoints * point)))
        {
         double tr = NormalizeDouble(buy ? price - InpTrailStepPoints * point : price + InpTrailStepPoints * point, digits);
         double gain = InpTrailMinImprovePts * point;
         if(buy ? (tr > newSL + gain && tr <= bid - minD) : ((tr < newSL - gain || newSL == 0) && tr >= ask + minD)) newSL = tr;
        }
      if(newSL != currentSL)
        {
         if(!trade.PositionModify(ticket, newSL, currentTP)) { Print("modify failed rc=", trade.ResultRetcode(), " ", trade.ResultRetcodeDescription()); g_locks[idx].isBE = (newSL == currentSL) ? g_locks[idx].isBE : false; }
        }

      // MOONLOCK (profit in account currency: after "Start", close when profit falls to X% of its peak)
      if(InpMoonLockEnabled)
        {
         if(!g_locks[idx].active && profit >= InpMoonLockStart) { g_locks[idx].active = true; g_locks[idx].peakProfit = profit; }
         if(g_locks[idx].active && profit > g_locks[idx].peakProfit) g_locks[idx].peakProfit = profit;
         if(g_locks[idx].active && profit <= g_locks[idx].peakProfit * (InpMoonLockPercent / 100.0) && profit > 0)
           {
            trade.PositionClose(ticket);
            RemoveLock(idx);
           }
        }
     }
  }

//+------------------------------------------------------------------+
bool CheckPropFirmLimits()
  {
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(eq > g_peakEquity) { g_peakEquity = eq; GlobalVariableSet(GVPeak(), g_peakEquity); }

   if(InpPropFirmMode)
     {
      if(g_startBalance > 0 && (eq - g_startBalance) >= g_startBalance * (InpPropFirmProfitTarget / 100.0))
        { CloseAllPositions(); DeleteAllPendingOrders(); g_isPaused = true; return true; }
      if((g_peakEquity - eq) >= g_peakEquity * (InpPropFirmMaxDrawdown / 100.0))
        { CloseAllPositions(); DeleteAllPendingOrders(); g_isPaused = true; return true; }
     }
   else if(InpDailyLossLimitEnabled)
     {
      if((g_dailyStartEquity - eq) >= g_dailyStartEquity * (InpMaxDailyLossPercent / 100.0))
        { CloseAllPositions(); DeleteAllPendingOrders(); g_isPaused = true; return true; }
     }
   if(InpPropFirmMode && InpDailyLossLimitEnabled && (g_dailyStartEquity - eq) >= g_dailyStartEquity * (InpMaxDailyLossPercent / 100.0))
     { CloseAllPositions(); DeleteAllPendingOrders(); g_isPaused = true; return true; }
   return false;
  }

//+------------------------------------------------------------------+
//| STATISTICS (closed deals of this EA)                             |
//+------------------------------------------------------------------+
void UpdateStatistics()
  {
   datetime nowL = TimeLocal();
   if(g_lastStats != 0 && nowL - g_lastStats < 5) return;
   g_lastStats = nowL;
   if(!HistorySelect(0, TimeCurrent() + 86400)) return;
   g_totalWins = 0; g_totalLosses = 0; g_grossProfit = 0; g_grossLoss = 0; g_totalProfit = 0; g_lastN = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      long en = HistoryDealGetInteger(t, DEAL_ENTRY);
      if(en != DEAL_ENTRY_OUT && en != DEAL_ENTRY_INOUT && en != DEAL_ENTRY_OUT_BY) continue;
      if(HistoryDealGetInteger(t, DEAL_MAGIC) != (long)InpMagicNumber || HistoryDealGetString(t, DEAL_SYMBOL) != _Symbol) continue;
      double pr = HistoryDealGetDouble(t, DEAL_PROFIT) + HistoryDealGetDouble(t, DEAL_SWAP) + HistoryDealGetDouble(t, DEAL_COMMISSION);
      g_totalProfit += pr;
      if(pr > 0) { g_totalWins++; g_grossProfit += pr; }
      else if(pr < 0) { g_totalLosses++; g_grossLoss += pr; }
      if(g_lastN < 5)
        {
         g_lastTime[g_lastN] = (datetime)HistoryDealGetInteger(t, DEAL_TIME);
         g_lastProfit[g_lastN] = pr;
         g_lastSide[g_lastN] = (HistoryDealGetInteger(t, DEAL_TYPE) == DEAL_TYPE_SELL) ? "B" : "S";
         ulong pid = (ulong)HistoryDealGetInteger(t, DEAL_POSITION_ID);
         g_lastMod[g_lastN] = (GlobalVariableCheck(GVMod(pid)) && (int)GlobalVariableGet(GVMod(pid)) < 3) ? MOD_NAME[(int)GlobalVariableGet(GVMod(pid))] : "-";   // the closing deal is the opposite of the position
         g_lastN++;
        }
     }
  }

//+------------------------------------------------------------------+
//| DASHBOARD - "Module Lanes" (canvas, read-only; OFF in backtests)  |
//+------------------------------------------------------------------+
struct Lane
  {
   int    m;
   string name;
   string state;
   uint   clr;
   bool   enabled, buy, hasPos, hasOrder;
   double level, dist, distFrac, floating, lot, rNow, openP;
  };

CCanvas   g_cv;
int       g_dw = 0, g_dh = 0, g_nLanes = 0;
double    g_eqS[180];
int       g_eqN = 0;
datetime  g_lastEqS = 0, g_lastAI = 0;
double    g_aiBuy = 0.0, g_aiSell = 0.0;

uint AR(int r, int gg, int b, int a = 255) { return ((uint)a << 24) | ((uint)r << 16) | ((uint)gg << 8) | (uint)b; }

uint MixC(uint c1, uint c2, double t)
  {
   if(t < 0) t = 0;
   if(t > 1) t = 1;
   int a  = (int)(((c1 >> 24) & 0xFF) * (1 - t) + ((c2 >> 24) & 0xFF) * t);
   int r  = (int)(((c1 >> 16) & 0xFF) * (1 - t) + ((c2 >> 16) & 0xFF) * t);
   int gg = (int)(((c1 >> 8) & 0xFF) * (1 - t) + ((c2 >> 8) & 0xFF) * t);
   int b  = (int)((c1 & 0xFF) * (1 - t) + (c2 & 0xFF) * t);
   return AR(r, gg, b, a);
  }

string Num(double v, int d = 2)
  {
   string s = DoubleToString(MathAbs(v), d);
   int dot = StringFind(s, ".");
   string ip = (dot < 0) ? s : StringSubstr(s, 0, dot);
   string fp = (dot < 0) ? "" : StringSubstr(s, dot);
   string out = "";
   int n = StringLen(ip);
   for(int i = 0; i < n; i++)
     {
      out += StringSubstr(ip, i, 1);
      int rem = n - 1 - i;
      if(rem > 0 && rem % 3 == 0) out += ",";
     }
   return (v < 0 ? "-" : "") + out + fp;
  }

string Sgn(double v, int d = 2) { return (v >= 0 ? "+" : "") + Num(v, d); }
uint PnlClr(double v) { return v > 0 ? AR(70, 230, 140) : (v < 0 ? AR(255, 85, 105) : AR(228, 236, 255)); }

void VGrad(int x, int y, int w, int h, uint c1, uint c2)
  {
   for(int i = 0; i < h; i++)
      g_cv.FillRectangle(x, y + i, x + w - 1, y + i, MixC(c1, c2, h > 1 ? (double)i / (h - 1) : 0.0));
  }

void HGrad(int x, int y, int w, int h, uint c1, uint c2)
  {
   for(int i = 0; i < w; i++)
      g_cv.FillRectangle(x + i, y, x + i, y + h - 1, MixC(c1, c2, w > 1 ? (double)i / (w - 1) : 0.0));
  }

void Tx(int x, int y, string s, uint clr, int pt, bool bold = true, uint align = TA_LEFT | TA_TOP, uint sh = 0xFF000000)
  {
   g_cv.FontSet("Segoe UI", -pt * 10, bold ? FW_BOLD : FW_NORMAL);
   g_cv.TextOut(x + 1, y + 1, s, sh, align);
   g_cv.TextOut(x, y, s, clr, align);
  }

void Card3D(int x, int y, int w, int h, uint accent)
  {
   g_cv.FillRectangle(x + 5, y + 6, x + w + 4, y + h + 5, AR(0, 0, 0, 60));
   g_cv.FillRectangle(x + 3, y + 4, x + w + 2, y + h + 3, AR(0, 0, 0, 100));
   VGrad(x, y, w, h, AR(26, 38, 66), AR(11, 17, 32));
   g_cv.FillRectangle(x, y, x + w - 1, y + 1, AR(78, 100, 150));
   g_cv.FillRectangle(x, y, x, y + h - 1, AR(58, 76, 118));
   g_cv.FillRectangle(x, y + h - 2, x + w - 1, y + h - 1, AR(3, 5, 10));
   g_cv.FillRectangle(x + w - 1, y, x + w - 1, y + h - 1, AR(5, 8, 15));
   g_cv.FillRectangle(x, y + 2, x + 3, y + h - 3, accent);
  }

void Poly4(int x0, int y0, int x1, int y1, int x2, int y2, int x3, int y3, uint clr)
  {
   int px[4]; int py[4];
   px[0] = x0; py[0] = y0; px[1] = x1; py[1] = y1; px[2] = x2; py[2] = y2; px[3] = x3; py[3] = y3;
   g_cv.FillPolygon(px, py, clr);
  }

void Chip(int x, int y, int w, string s, uint bg, uint fg)
  {
   g_cv.FillRectangle(x, y, x + w - 1, y + 15, bg);
   Tx(x + w / 2, y + 2, s, fg, 8, true, TA_CENTER | TA_TOP, bg);
  }

// glowing lamp used by the three entry gates
void Lamp(int cx, int cy, uint clr)
  {
   g_cv.FillCircle(cx, cy, 10, MixC(AR(8, 12, 22), clr, 0.35));
   g_cv.FillCircle(cx, cy, 7, clr);
   g_cv.FillCircle(cx - 2, cy - 2, 2, AR(255, 255, 255));
  }

void Bar(int x, int y, int w, int h, double frac, uint c1, uint c2)
  {
   if(frac < 0) frac = 0;
   if(frac > 1) frac = 1;
   g_cv.FillRectangle(x, y, x + w - 1, y + h - 1, AR(4, 7, 14));
   if(frac > 0) VGrad(x, y, MathMax(1, (int)(w * frac)), h, c1, c2);
   g_cv.FillRectangle(x, y, x + w - 1, y, AR(40, 54, 86));
  }

uint ModClr(int m)
  {
   if(m == 0) return AR(25, 230, 193);    // Nova
   if(m == 1) return AR(70, 160, 255);    // Apex
   return AR(255, 196, 64);               // Zenith
  }

//--- live data ----------------------------------------------------------
string ShieldReason()
  {
   if(g_isPaused) return "PAUSED";
   if(IsWeekendBlocked()) return "WEEKEND";
   if(IsSpreadBlocked()) return "SPREAD";
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(InpDailyLossLimitEnabled && g_dailyStartEquity > 0 && (g_dailyStartEquity - eq) >= g_dailyStartEquity * (InpMaxDailyLossPercent / 100.0)) return "DAILY LOSS";
   if(InpPropFirmMode && (g_peakEquity - eq) >= g_peakEquity * (InpPropFirmMaxDrawdown / 100.0)) return "PROP DD";
   if(CountTodayEntries() + CountOurPendings() >= InpMaxTradesPerDay) return "DAILY LIMIT";
   return "";
  }

void BuildLane(int m, Lane &L, double atr, bool trendUp, bool trendDown, double ask, double bid, bool aiOkBuy, bool aiOkSell, string shield)
  {
   ZeroMemory(L);
   L.m = m; L.name = MOD_NAME[m]; L.enabled = ModuleEnabled(m); L.clr = ModClr(m);
   if(!L.enabled) { L.state = "OFF"; return; }
   string name = L.name;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      if(!posInfo.SelectByIndex(i) || posInfo.Symbol() != _Symbol || posInfo.Magic() != InpMagicNumber) continue;
      ulong ident = (ulong)PositionGetInteger(POSITION_IDENTIFIER);
      bool mine = GlobalVariableCheck(GVMod(ident)) ? ((int)GlobalVariableGet(GVMod(ident)) == m) : (StringFind(posInfo.Comment(), name) == 0);
      if(!mine) continue;
      L.hasPos = true; L.buy = (posInfo.PositionType() == POSITION_TYPE_BUY); L.lot = posInfo.Volume(); L.openP = posInfo.PriceOpen();
      L.floating = posInfo.Profit() + posInfo.Swap();
      double slD = InpStopLossPoints * SymbolInfoDouble(_Symbol, SYMBOL_POINT);
      double px = L.buy ? bid : ask;
      L.rNow = slD > 0 ? (L.buy ? px - L.openP : L.openP - px) / slD : 0;
     }
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong t = OrderGetTicket(i);
      if(t == 0 || OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != (long)InpMagicNumber) continue;
      if(StringFind(OrderGetString(ORDER_COMMENT), name) != 0) continue;
      L.hasOrder = true; L.level = OrderGetDouble(ORDER_PRICE_OPEN);
      L.buy = (OrderGetInteger(ORDER_TYPE) == ORDER_TYPE_BUY_STOP);
     }
   if(L.hasPos) { L.state = "TRADE"; L.clr = (L.floating >= 0) ? AR(70, 230, 140) : AR(255, 85, 105); return; }

   double bl, sl;
   ModuleLevels(m, InpBreakoutBufferPoints * SymbolInfoDouble(_Symbol, SYMBOL_POINT), bl, sl);
   if(InpBuyLevelAddSpread && bl > 0) bl += (ask - bid);
   if(!L.hasOrder)
     {
      bool pickBuy = (trendUp && !trendDown) ? true : ((trendDown && !trendUp) ? false : ((bl - ask) <= (bid - sl)));
      L.buy = pickBuy; L.level = pickBuy ? bl : sl;
     }
   L.dist = L.buy ? (L.level - ask) : (bid - L.level);
   L.distFrac = (atr > 0) ? 1.0 - MathMax(0.0, MathMin(1.0, L.dist / (atr * 2.0))) : 0.0;
   if(L.hasOrder) { L.state = "ORDER"; return; }
   bool dirOK = L.buy ? (trendUp && aiOkBuy) : (trendDown && aiOkSell);
   if(!dirOK || shield != "") { L.state = "WAIT"; return; }
   if(L.dist <= 0) { L.state = "PASSED"; return; }
   L.state = "ARMED";
  }

void Dash_Sample()
  {
   datetime nowL = TimeLocal();
   if(g_eqN > 0 && nowL - g_lastEqS < 20) return;
   g_lastEqS = nowL;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
   if(g_eqN == 180) { for(int i = 1; i < 180; i++) g_eqS[i - 1] = g_eqS[i]; g_eqS[179] = eq; }
   else g_eqS[g_eqN++] = eq;
  }

void Spark(int x, int y, int w, int h, uint accent)
  {
   if(g_eqN < 2) { Tx(x + w / 2, y + h / 2 - 7, "collecting...", AR(140, 158, 196), 9, false, TA_CENTER | TA_TOP); return; }
   double mn = DBL_MAX, mx = -DBL_MAX;
   for(int i = 0; i < g_eqN; i++) { mn = MathMin(mn, g_eqS[i]); mx = MathMax(mx, g_eqS[i]); }
   if(mx - mn < 1e-9) mx = mn + 1.0;
   uint fill = MixC(AR(14, 20, 38), accent, 0.30);
   int ppx = 0, ppy = 0;
   for(int i = 0; i < g_eqN; i++)
     {
      int px = x + (int)((double)i / (g_eqN - 1) * (w - 1));
      int py = y + h - 1 - (int)((g_eqS[i] - mn) / (mx - mn) * (h - 1));
      g_cv.FillRectangle(px, py, px, y + h - 1, fill);
      if(i > 0) { g_cv.Line(ppx, ppy, px, py, accent); g_cv.Line(ppx, ppy + 1, px, py + 1, accent); }
      ppx = px; ppy = py;
     }
  }

void DrawGate(int x, int y, int w, int h, string title, string val, string sub, uint lampClr)
  {
   Card3D(x, y, w, h, lampClr);
   Lamp(x + 22, y + h / 2, lampClr);
   Tx(x + 40, y + 6, title, AR(140, 158, 196), 8, false);
   Tx(x + 40, y + 20, val, AR(236, 242, 255), 10, true);
   Tx(x + 40, y + 40, sub, AR(140, 158, 196), 8, false);
  }

void DrawLane(int x, int y, int w, int h, const Lane &L, double atr)
  {
   uint dim = AR(140, 158, 196), white = AR(236, 242, 255);
   g_cv.FillRectangle(x, y, x + w - 1, y + h - 1, AR(18, 27, 48));
   g_cv.FillRectangle(x, y + h - 1, x + w - 1, y + h - 1, AR(40, 54, 86));
   Chip(x + 6, y + 6, 64, L.name, ModClr(L.m), AR(4, 12, 20));
   uint sc = AR(70, 80, 110), sf = AR(214, 224, 250);
   if(L.state == "ARMED") { sc = AR(25, 230, 193); sf = AR(3, 43, 37); }
   else if(L.state == "ORDER") { sc = AR(255, 196, 64); sf = AR(58, 38, 0); }
   else if(L.state == "TRADE") { sc = L.clr; sf = AR(4, 12, 20); }
   else if(L.state == "WAIT" || L.state == "PASSED") { sc = AR(120, 100, 60); sf = AR(255, 230, 170); }
   Chip(x + 76, y + 6, 64, L.state, sc, sf);
   int bx = x + w - 112;
   if(!L.enabled) { Tx(x + 150, y + 8, "module switched OFF in the inputs", dim, 8, false); return; }
   if(L.hasPos)
     {
      Tx(x + 150, y + 3, (L.buy ? "BUY " : "SELL ") + DoubleToString(L.lot, 2) + "  " + Sgn(L.floating), PnlClr(L.floating), 10, true);
      Tx(x + 150, y + 21, "open " + Num(L.openP, 2) + " | " + Sgn(L.rNow, 2) + "R", dim, 8, false);
      Bar(bx, y + 12, 100, 10, (L.rNow + 1.0) / 4.3, L.rNow >= 0 ? AR(25, 235, 196) : AR(255, 80, 130), L.rNow >= 0 ? AR(10, 150, 125) : AR(190, 40, 90));
      g_cv.FillRectangle(bx + (int)(100 * (1.0 / 4.3)), y + 9, bx + (int)(100 * (1.0 / 4.3)) + 1, y + 25, white);   // entry marker
      return;
     }
   Tx(x + 150, y + 3, (L.buy ? "BUY STOP " : "SELL STOP ") + (L.level > 0 ? Num(L.level, 2) : "-"), white, 10, true);
   string d = (L.level > 0) ? (L.dist > 0 ? DoubleToString(L.dist, 1) + " pts to trigger" : "level already passed") : "no level yet";
   Tx(x + 150, y + 21, d + (atr > 0 ? "  |  ATR " + DoubleToString(atr, 1) : ""), dim, 8, false);
   Bar(bx, y + 12, 100, 10, L.distFrac, L.state == "ORDER" ? AR(255, 210, 90) : AR(25, 235, 196), L.state == "ORDER" ? AR(190, 130, 20) : AR(10, 150, 125));
  }

void Dash_DrawBig(const Lane &lanes[], double atr, bool trendUp, bool trendDown, double fast, double slow, string shield)
  {
   int pw = g_dw - 6, ph = g_dh - 6, x0 = 10, cw = pw - 20, y = 10;
   uint blue = AR(70, 160, 255), gold = AR(255, 196, 64), teal = AR(25, 230, 193), green = AR(70, 230, 140), red = AR(255, 85, 105);
   uint white = AR(236, 242, 255), dim = AR(140, 158, 196), amber = AR(255, 160, 40);
   g_cv.FillRectangle(6, 7, g_dw - 1, g_dh - 1, AR(0, 0, 0, 80));
   VGrad(0, 0, pw, ph, AR(16, 24, 44), AR(7, 11, 22));
   g_cv.Rectangle(0, 0, pw - 1, ph - 1, AR(42, 58, 96));

   // header
   HGrad(x0, y, cw, 54, AR(12, 44, 96), AR(40, 22, 70));
   HGrad(x0, y + 51, cw, 3, AR(70, 160, 255), AR(255, 196, 64));
   Tx(x0 + 12, y + 4, "XXX US30", white, 17, true, TA_LEFT | TA_TOP, AR(10, 60, 140));
   Tx(x0 + 12, y + 34, "ALGOTRADERS24 AI | " + _Symbol + " " + EnumToString((ENUM_TIMEFRAMES)InpTF) + " | v1.14 | magic " + (string)InpMagicNumber, AR(150, 180, 230), 8, false);
   bool tradeOn = TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) && MQLInfoInteger(MQL_TRADE_ALLOWED);
   Chip(x0 + cw - 190, y + 6, 88, g_isPaused ? "PAUSED" : "ACTIVE", g_isPaused ? red : green, AR(4, 12, 20));
   Chip(x0 + cw - 96, y + 6, 88, tradeOn ? "ALGO ON" : "ALGO OFF", tradeOn ? teal : red, AR(4, 12, 20));
   Tx(x0 + cw - 10, y + 30, TimeToString(TimeCurrent(), TIME_SECONDS), blue, 11, true, TA_RIGHT | TA_TOP);
   y += 54 + 8;

   // gates: trend | AI | shields
   int gw = (cw - 16) / 3, gh = 62;
   string tv, ts; uint tc;
   if(!InpUseMTFTrend) { tv = "FILTER OFF"; ts = "both directions"; tc = amber; }
   else if(trendUp)    { tv = "H1 UPTREND"; ts = "EMA gap +" + DoubleToString((fast - slow), 1) + " pts"; tc = green; }
   else if(trendDown)  { tv = "H1 DOWNTREND"; ts = "EMA gap " + DoubleToString((fast - slow), 1) + " pts"; tc = red; }
   else                { tv = "FLAT"; ts = "no trade"; tc = amber; }
   DrawGate(x0, y, gw, gh, "GATE 1 | TREND", tv, ts, tc);
   string av, as; uint ac;
   if(!InpUseONNX || g_ai_status == 0) { av = "AI OFF"; as = "not used"; ac = AR(110, 124, 160); }
   else if(g_ai_status == 2)           { av = InpRequireAI ? "NO MODEL" : "AI FAILED"; as = InpRequireAI ? "trading blocked" : "trades without AI"; ac = InpRequireAI ? red : amber; }
   else
     {
      bool ok = (trendUp && g_aiBuy >= InpAIScoreThreshold) || (trendDown && g_aiSell >= InpAIScoreThreshold) || (!InpUseMTFTrend && (g_aiBuy >= InpAIScoreThreshold || g_aiSell >= InpAIScoreThreshold));
      av = "B " + DoubleToString(g_aiBuy, 2) + "  S " + DoubleToString(g_aiSell, 2); as = "need " + DoubleToString(InpAIScoreThreshold, 2); ac = ok ? green : amber;
     }
   DrawGate(x0 + gw + 8, y, gw, gh, "GATE 2 | AI SCORE", av, as, ac);
   int spr = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   string sv = (shield == "") ? "ALL CLEAR" : shield; uint sc2 = (shield == "") ? green : red;
   DrawGate(x0 + 2 * (gw + 8), y, gw, gh, "GATE 3 | SHIELDS", sv, "spread " + DoubleToString(spr * SymbolInfoDouble(_Symbol, SYMBOL_POINT), 2) + " / " + DoubleToString(InpMaxSpreadPoints * SymbolInfoDouble(_Symbol, SYMBOL_POINT), 1) + " pts", sc2);
   y += gh + 8;

   // module lanes
   int laneH = 42, lh = 24 + g_nLanes * laneH;
   Card3D(x0, y, cw, lh, blue);
   Tx(x0 + 12, y + 5, "MODULE LANES | one order per module | max " + (string)InpMaxConcurrent + " together", dim, 8, false);
   int ly = y + 22;
   for(int i = 0; i < g_nLanes; i++) { DrawLane(x0 + 6, ly, cw - 12, laneH, lanes[i], atr); ly += laneH; }
   y += lh + 8;

   // equity + stats
   int hw = (cw - 8) / 2, rh = 118;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY), bal = AccountInfoDouble(ACCOUNT_BALANCE);
   double dayPL = eq - g_dailyStartEquity, dd = g_peakEquity > 0 ? (g_peakEquity - eq) / g_peakEquity * 100.0 : 0.0;
   Card3D(x0, y, hw, rh, teal);
   Tx(x0 + 12, y + 5, "EQUITY | last hour", dim, 8, false);
   Tx(x0 + hw - 10, y + 4, Num(eq, 2), white, 11, true, TA_RIGHT | TA_TOP);
   Spark(x0 + 12, y + 28, hw - 24, rh - 62, teal);
   Tx(x0 + 12, y + rh - 28, "balance " + Num(bal, 2), dim, 8, false);
   Tx(x0 + 12, y + rh - 14, "peak " + Num(g_peakEquity, 2) + " | DD " + DoubleToString(dd, 2) + "%", dd > 5 ? amber : dim, 8, false);
   int sx = x0 + hw + 8;
   Card3D(sx, y, hw, rh, PnlClr(dayPL));
   Tx(sx + 12, y + 5, "TODAY", dim, 8, false);
   Tx(sx + 12, y + 19, Sgn(dayPL), PnlClr(dayPL), 15, true);
   int totalTrades = g_totalWins + g_totalLosses;
   double wr = totalTrades > 0 ? g_totalWins * 100.0 / totalTrades : 0.0;
   double pf = g_grossLoss < 0 ? g_grossProfit / (-g_grossLoss) : (g_grossProfit > 0 ? 99.0 : 0.0);
   int entries = CountTodayEntries();
   Tx(sx + 12, y + 46, "entries today " + (string)entries + " / " + (string)InpMaxTradesPerDay, dim, 8, false);
   Bar(sx + 12, y + 62, hw - 24, 7, (double)entries / MathMax(1, InpMaxTradesPerDay), AR(255, 210, 90), AR(190, 130, 20));
   Tx(sx + 12, y + 76, "ALL TIME  " + (string)totalTrades + " trades | win " + DoubleToString(wr, 0) + "%", dim, 8, false);
   Tx(sx + 12, y + 92, "PF " + DoubleToString(pf, 2) + " | net " + Sgn(g_totalProfit), PnlClr(g_totalProfit), 9, true);
   y += rh + 8;

   // last 5 trades
   int th = 24 + 5 * 17 + 4;
   Card3D(x0, y, cw, th, gold);
   Tx(x0 + 12, y + 5, "LAST 5 TRADES", dim, 8, false);
   for(int k = 0; k < 5; k++)
     {
      int ry = y + 22 + k * 17;
      if(k >= g_lastN) { Tx(x0 + 14, ry, "-", AR(80, 96, 130), 8, false); continue; }
      Chip(x0 + 12, ry, 22, g_lastSide[k], g_lastSide[k] == "B" ? AR(25, 200, 150) : AR(235, 80, 120), AR(4, 12, 20));
      Tx(x0 + 42, ry, g_lastMod[k], white, 8, true);
      Tx(x0 + 120, ry, Sgn(g_lastProfit[k]), PnlClr(g_lastProfit[k]), 9, true);
      Bar(x0 + 200, ry + 2, 120, 9, MathMin(1.0, MathAbs(g_lastProfit[k]) / 40.0), g_lastProfit[k] >= 0 ? AR(25, 235, 196) : AR(255, 80, 130), g_lastProfit[k] >= 0 ? AR(10, 150, 125) : AR(190, 40, 90));
      Tx(x0 + cw - 10, ry, TimeToString(g_lastTime[k], TIME_DATE | TIME_MINUTES), dim, 8, false, TA_RIGHT | TA_TOP);
     }
   y += th + 8;

   // footer: the two real buttons sit on this card
   Card3D(x0, y, cw, 34, AR(110, 130, 180));
  }

void Dash_DrawSmall(const Lane &lanes[], double atr, bool trendUp, bool trendDown, string shield)
  {
   int pw = g_dw - 6, ph = g_dh - 6, x0 = 10, cw = pw - 20, y = 10;
   uint blue = AR(70, 160, 255), green = AR(70, 230, 140), red = AR(255, 85, 105), amber = AR(255, 160, 40), white = AR(236, 242, 255), dim = AR(140, 158, 196);
   g_cv.FillRectangle(6, 7, g_dw - 1, g_dh - 1, AR(0, 0, 0, 80));
   VGrad(0, 0, pw, ph, AR(16, 24, 44), AR(7, 11, 22));
   g_cv.Rectangle(0, 0, pw - 1, ph - 1, AR(42, 58, 96));
   HGrad(x0, y, cw, 38, AR(12, 44, 96), AR(40, 22, 70));
   HGrad(x0, y + 35, cw, 3, AR(70, 160, 255), AR(255, 196, 64));
   Tx(x0 + 10, y + 4, "XXX US30", white, 12, true, TA_LEFT | TA_TOP, AR(10, 60, 140));
   Chip(x0 + cw - 78, y + 8, 70, g_isPaused ? "PAUSED" : "ACTIVE", g_isPaused ? red : green, AR(4, 12, 20));
   y += 38 + 8;
   double eq = AccountInfoDouble(ACCOUNT_EQUITY), dayPL = eq - g_dailyStartEquity;
   Card3D(x0, y, cw, 52, PnlClr(dayPL));
   Tx(x0 + 12, y + 5, "EQUITY | TODAY", dim, 8, false);
   Tx(x0 + 12, y + 20, Num(eq, 2) + "   " + Sgn(dayPL), PnlClr(dayPL), 12, true);
   Tx(x0 + cw - 10, y + 6, shield == "" ? (trendUp ? "TREND UP" : (trendDown ? "TREND DOWN" : "FLAT")) : shield, shield == "" ? (trendUp ? green : (trendDown ? red : amber)) : red, 8, true, TA_RIGHT | TA_TOP);
   y += 52 + 8;
   int lh = 22 + g_nLanes * 30;
   Card3D(x0, y, cw, lh, blue);
   Tx(x0 + 12, y + 4, "MODULES", dim, 8, false);
   int ly = y + 20;
   for(int i = 0; i < g_nLanes; i++)
     {
      Chip(x0 + 10, ly + 5, 60, lanes[i].name, ModClr(lanes[i].m), AR(4, 12, 20));
      uint sc = (lanes[i].state == "ARMED") ? AR(25, 230, 193) : ((lanes[i].state == "TRADE" || lanes[i].state == "ORDER") ? AR(255, 196, 64) : AR(70, 80, 110));
      Chip(x0 + 76, ly + 5, 56, lanes[i].state, sc, AR(4, 12, 20));
      string d = lanes[i].hasPos ? Sgn(lanes[i].floating) : (lanes[i].level > 0 ? Num(lanes[i].level, 2) : "-");
      Tx(x0 + cw - 10, ly + 6, d, lanes[i].hasPos ? PnlClr(lanes[i].floating) : white, 9, true, TA_RIGHT | TA_TOP);
      ly += 30;
     }
   y += lh + 8;
   Card3D(x0, y, cw, 34, AR(110, 130, 180));
  }

void Dash_Update()
  {
   if(!g_dashOn) return;
   UpdateStatistics();
   Dash_Sample();

   double atr = GetInd(handle_atr, 0, 1);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK), bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double fast = InpUseMTFTrend ? GetInd(handle_ema_fast, 0, 1) : 0, slow = InpUseMTFTrend ? GetInd(handle_ema_slow, 0, 1) : 0;
   bool trendUp = IsTrendUp(), trendDown = IsTrendDown();
   if(!InpUseMTFTrend) { trendUp = false; trendDown = false; }
   datetime nowL = TimeLocal();
   if(g_lastAI == 0 || nowL - g_lastAI >= 5)
     {
      g_lastAI = nowL;
      if(InpUseONNX && g_ai_status == 1) { g_aiBuy = GetAIScore(1.0); g_aiSell = GetAIScore(-1.0); }
     }
   bool aiOkBuy  = (!InpUseONNX || g_ai_status != 1) ? !(InpRequireAI && InpUseONNX) : (g_aiBuy >= InpAIScoreThreshold);
   bool aiOkSell = (!InpUseONNX || g_ai_status != 1) ? !(InpRequireAI && InpUseONNX) : (g_aiSell >= InpAIScoreThreshold);
   string shield = ShieldReason();
   bool noFilter = !InpUseMTFTrend;

   Lane lanes[3];
   int n = 0;
   for(int m = 0; m < 3; m++)
     {
      BuildLane(m, lanes[n], atr, noFilter ? true : trendUp, noFilter ? true : trendDown, ask, bid, aiOkBuy, aiOkSell, shield);
      n++;
     }
   g_nLanes = n;

   g_cv.Erase(0);
   if(InpDashCompact) Dash_DrawSmall(lanes, atr, trendUp, trendDown, shield);
   else Dash_DrawBig(lanes, atr, trendUp, trendDown, fast, slow, shield);
   g_cv.Update();

   ObjectSetString(0, g_prefix + "BtnPause", OBJPROP_TEXT, g_isPaused ? "RESUME" : "PAUSE");
   ObjectSetInteger(0, g_prefix + "BtnPause", OBJPROP_BGCOLOR, g_isPaused ? clrGreen : clrFireBrick);
   ChartRedraw(0);
  }

void CreateButton(string name, int x, int y, int w, int h, string text, color txtColor, color bgColor)
  {
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
bool Dash_Init()
  {
   int nl = 3;
   g_nLanes = nl;
   g_dw = InpDashCompact ? 306 : 526;
   g_dh = InpDashCompact ? (10 + 38 + 8 + 52 + 8 + (22 + nl * 30) + 8 + 34 + 16) : (10 + 54 + 8 + 62 + 8 + (24 + nl * 42) + 8 + 118 + 8 + (24 + 5 * 17 + 4) + 8 + 34 + 16);
   string nm = g_prefix + "CANVAS";
   if(!g_cv.CreateBitmapLabel(0, 0, nm, InpDashX, InpDashY, g_dw, g_dh, COLOR_FORMAT_ARGB_NORMALIZE)) { Print("Dashboard canvas failed, err ", GetLastError()); return false; }
   ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   int by = InpDashY + g_dh - 6 - 14 - 34 + 2;
   int bw = (g_dw - 6 - 20 - 8) / 2;
   CreateButton(g_prefix + "BtnPause", InpDashX + 10, by + 4, bw - 6, 26, g_isPaused ? "RESUME" : "PAUSE", clrWhite, g_isPaused ? clrGreen : clrFireBrick);
   CreateButton(g_prefix + "BtnClose", InpDashX + 10 + bw + 6, by + 4, bw - 6, 26, "CLOSE ALL", clrWhite, clrDarkOrange);
   ObjectSetInteger(0, g_prefix + "BtnPause", OBJPROP_ZORDER, 10);
   ObjectSetInteger(0, g_prefix + "BtnClose", OBJPROP_ZORDER, 10);
   EventSetTimer(1);
   UpdateStatistics();
   Dash_Update();
   return true;
  }

void Dash_Deinit()
  {
   if(!g_dashOn) return;
   g_cv.Destroy();
  }
