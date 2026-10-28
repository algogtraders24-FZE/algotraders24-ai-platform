//+------------------------------------------------------------------+
//|                                                     XXXBTC.mq5   |
//|                        Copyright algotraders24.ai                  |
//|                        XXX BTC - Bitcoin Breakout System           |
//+------------------------------------------------------------------+
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property version   "1.02"
#property strict
#property description "XXX BTC - Powered by ALGOTRADERS24 AI"
#property description "24/7 Crypto Breakout System"

//--- AI model is built into this .ex5 (no model files to copy). See OnInit for the load order.
#resource "xxxbtc_filter_embedded.onnx" as uchar g_EmbeddedModel[]

//--- AT24 licence gate: one key = one trading account, only for this product (Strategy Tester needs no key)
#define AT24_PRODUCT_ID "XXXBTC"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = ""; // AT24 licence key (from your AT24 purchase page)

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>
#include <Canvas\Canvas.mqh>

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
input int    InpDashX                = 10;
input int    InpDashY                = 30;
input bool   InpDashInTester         = false;   // false = no panel in the Strategy Tester (faster backtests)

//--- GLOBALS
int      handle_atr = INVALID_HANDLE, handle_rsi = INVALID_HANDLE, handle_fractals = INVALID_HANDLE;
int      handle_ema_fast = INVALID_HANDLE, handle_ema_slow = INVALID_HANDLE;
long     onnx_handle = INVALID_HANDLE;
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
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
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
   
   //--- MODEL LOAD. The trained model is embedded in this .ex5 (g_EmbeddedModel). A model file named in
   //--- InpONNXFile that exists in MQL5\Files is still used first (original behaviour); if it is missing or
   //--- cannot be opened, the embedded copy is used - the model weights are identical.
   g_ai_status = 0;
   onnx_handle = INVALID_HANDLE;
   string g_aiSource = "";

   if(InpUseONNX) {
      if(StringLen(InpONNXFile) > 0 && FileIsExist(InpONNXFile)) {
         onnx_handle = OnnxCreate(InpONNXFile, ONNX_DEFAULT);
         if(onnx_handle != INVALID_HANDLE) g_aiSource = "file " + InpONNXFile;
      }
      if(onnx_handle == INVALID_HANDLE) {
         onnx_handle = OnnxCreateFromBuffer(g_EmbeddedModel, ONNX_DEFAULT);
         if(onnx_handle != INVALID_HANDLE) g_aiSource = "embedded model";
      }
      if(onnx_handle == INVALID_HANDLE) {
         g_ai_status = 2;
         Print("WARNING: ONNX model could not be loaded (file '", InpONNXFile, "' and embedded copy both failed, error ", GetLastError(), ")");
         Print("AI DISABLED (fail-safe mode) - EA will work without AI filter");
      } else {
         long in_shape[2]  = {1, 5};
         long out_shape[2] = {1, 1};
         if(!OnnxSetInputShape(onnx_handle, 0, in_shape)) {
            Print("WARNING: Failed to set ONNX input shape");
            OnnxRelease(onnx_handle);
            onnx_handle = INVALID_HANDLE;
            g_ai_status = 2;
         } else if(!OnnxSetOutputShape(onnx_handle, 0, out_shape)) {
            Print("WARNING: Failed to set ONNX output shape");
            OnnxRelease(onnx_handle);
            onnx_handle = INVALID_HANDLE;
            g_ai_status = 2;
         } else {
            g_ai_status = 1;
            Print("ONNX AI Model Loaded Successfully (", g_aiSource, ") | Threshold: ", InpAIScoreThreshold, " | Features: 5 | Output: Score [0-1]");
         }
      }
   } else {
      Print("ONNX AI Filter DISABLED (InpUseONNX=false)");
   }
   
   g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_peakEquity = g_dailyStartEquity;
   
   EventSetTimer(1);
   
   g_dashOn = InpShowDashboard && (!MQLInfoInteger(MQL_TESTER) || (InpDashInTester && MQLInfoInteger(MQL_VISUAL_MODE)));
   if(g_dashOn && !Dash_Init()) g_dashOn = false;
   UpdateStatistics();
   if(g_dashOn) DrawFinalDashboard();
   ChartRedraw(0);
   
   Print("=== XXX BTC v1.02 Initialized ===");
   Print("Copyright algotraders24.ai | 24/7 Crypto Mode");
   
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) {
   Dash_Deinit();
   EventKillTimer();
   ChartRedraw(0);
   if(handle_atr != INVALID_HANDLE) IndicatorRelease(handle_atr);
   if(handle_rsi != INVALID_HANDLE) IndicatorRelease(handle_rsi);
   if(handle_fractals != INVALID_HANDLE) IndicatorRelease(handle_fractals);
   if(handle_ema_fast != INVALID_HANDLE) IndicatorRelease(handle_ema_fast);
   if(handle_ema_slow != INVALID_HANDLE) IndicatorRelease(handle_ema_slow);
   if(onnx_handle != INVALID_HANDLE) OnnxRelease(onnx_handle);
}

void OnTimer() {
   AT24Gate_Timer(InpLicenseKey);
   if(g_dashOn) { UpdateStatistics(); DrawFinalDashboard(); }
}

void OnTick() {
   CheckNewDay();
   ManageTradeExits();
   
   bool isBlocked = g_isPaused || !AT24Gate_Allowed() || IsWeekendBlocked() || IsSpreadBlocked() || CheckPropFirmLimits();
   
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
//+------------------------------------------------------------------+
//| DASHBOARD (canvas). Refreshed once per second from OnTimer.       |
//| Never shown in the Strategy Tester unless InpDashInTester + visual.|
//+------------------------------------------------------------------+
CCanvas cvs;
bool    g_dashOn = false;
const int DW = 372;
int     g_dashH = 0;

uint DRGB(const int r, const int g, const int b) { return ((uint)255 << 24) | ((uint)r << 16) | ((uint)g << 8) | (uint)b; }
uint dBG()    { return DRGB(12, 17, 30); }
uint dCard()  { return DRGB(21, 29, 48); }
uint dGold()  { return DRGB(255, 196, 64); }
uint dGreen() { return DRGB(46, 204, 113); }
uint dRed()   { return DRGB(231, 76, 60); }
uint dText()  { return DRGB(236, 240, 248); }
uint dDim()   { return DRGB(139, 154, 184); }

bool Dash_Init() {
   g_dashH = 640;
   if(!cvs.CreateBitmapLabel(0, 0, g_prefix + "CANVAS", InpDashX, InpDashY, DW, g_dashH, COLOR_FORMAT_ARGB_NORMALIZE)) return false;
   return true;
}
void Dash_Deinit() { if(g_dashOn) cvs.Destroy(); ObjectsDeleteAll(0, g_prefix); }

void DTx(const int x, const int y, const string s, const uint col, const int size = -90, const bool bold = false, const uint al = TA_LEFT | TA_TOP) {
   cvs.FontSet("Segoe UI", size, bold ? FW_BOLD : FW_NORMAL);
   cvs.TextOut(x, y, s, col, al);
}
void DCardBox(const int y, const int h, const string title) {
   cvs.FillRectangle(8, y, DW - 8, y + h, dCard());
   cvs.FillRectangle(8, y, 11, y + h, dGold());
   DTx(20, y + 5, title, dGold(), -80, true);
}
void DRow(const int y, const string k, const string v, const uint col) {
   DTx(20, y, k, dDim());
   DTx(DW - 20, y, v, col, -90, true, TA_RIGHT | TA_TOP);
}
void DChip(const int x, const int y, const int w, const string label, const bool on) {
   cvs.FillRectangle(x, y, x + w, y + 22, on ? DRGB(24, 94, 56) : DRGB(60, 38, 40));
   DTx(x + w / 2, y + 4, label, on ? dGreen() : dDim(), -80, true, TA_CENTER | TA_TOP);
}

string BlockWhy() {
   if(!AT24Gate_Allowed()) return "licence not valid";
   if(g_isPaused)          return "paused";
   if(IsWeekendBlocked())  return "weekend shield";
   if(IsSpreadBlocked())   return "spread too wide";
   if(InpMaxTradesPerDay > 0 && g_tradesToday >= InpMaxTradesPerDay) return "daily trade limit";
   return "";
}

void DrawFinalDashboard() {
   if(!g_dashOn) return;
   cvs.Erase(dBG());
   string why = BlockWhy();
   bool open = (why == "");

   // header
   cvs.FillRectangle(0, 0, DW, 46, dCard());
   cvs.FillRectangle(0, 0, DW, 3, dGold());
   DTx(14, 8, "XXX BTC  v1.02", dGold(), -110, true);
   DTx(14, 28, _Symbol + "  |  " + EnumToString((ENUM_TIMEFRAMES)InpTF) + "  |  24/7  |  magic " + (string)InpMagicNumber, dDim(), -80);
   cvs.FillRectangle(DW - 132, 12, DW - 10, 34, open ? DRGB(24, 94, 56) : DRGB(110, 36, 30));
   DTx(DW - 71, 15, open ? "ENTRIES ON" : "OFF: " + why, open ? dGreen() : dRed(), -75, true, TA_CENTER | TA_TOP);
   int y = 52;

   // account
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY);
   double dayPL = eq - g_dailyStartEquity, dayPct = g_dailyStartEquity > 0 ? dayPL / g_dailyStartEquity * 100.0 : 0.0;
   double dd = g_peakEquity > 0 ? (g_peakEquity - eq) / g_peakEquity * 100.0 : 0.0;
   int spr = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   DCardBox(y, 106, "ACCOUNT");
   DRow(y + 22, "Balance", DoubleToString(bal, 2), dText());
   DRow(y + 40, "Equity", DoubleToString(eq, 2), dText());
   DRow(y + 58, "Today", (dayPL >= 0 ? "+" : "") + DoubleToString(dayPL, 2) + "  (" + DoubleToString(dayPct, 2) + "%)", dayPL >= 0 ? dGreen() : dRed());
   DRow(y + 76, "Drawdown from peak", DoubleToString(dd, 2) + "%", dd < 3 ? dText() : (dd < 8 ? dGold() : dRed()));
   DRow(y + 92 - 2, "Spread / limit (points)", (string)spr + " / " + DoubleToString(InpMaxSpreadPoints, 0), IsSpreadBlocked() ? dRed() : dGreen());
   y += 112;

   // performance (profit factor = gross profit / gross loss)
   double gp = 0, gl = 0; int w = 0, l = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--) {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != (long)InpMagicNumber || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) continue;
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT);
      if(p > 0) { gp += p; w++; } else if(p < 0) { gl -= p; l++; }
   }
   int tt = w + l;
   double wr = tt > 0 ? w * 100.0 / tt : 0.0, pf = gl > 0 ? gp / gl : 0.0;
   DCardBox(y, 70, "PERFORMANCE (this symbol, this magic)");
   DRow(y + 22, "Trades  /  win rate", (string)tt + "  /  " + DoubleToString(wr, 1) + "%", dText());
   DRow(y + 40, "Wins / losses", (string)w + " / " + (string)l, dText());
   DRow(y + 54, "Profit factor", gl > 0 ? DoubleToString(pf, 2) : "n/a", pf >= 1.3 ? dGreen() : (pf >= 1.0 ? dGold() : dRed()));
   y += 76;

   // modules
   DCardBox(y, 56, "MODULES");
   string nm[5] = {"Nova", "Apex", "Zenith", "Pulse", "Eclipse"};
   bool on[5]; on[0] = InpEnableNova; on[1] = InpEnableApex; on[2] = InpEnableZenith; on[3] = InpEnablePulse; on[4] = InpEnableEclipse;
   for(int i = 0; i < 5; i++) DChip(20 + i * 68, y + 26, 64, nm[i], on[i]);
   y += 62;

   // shields
   string ai = (g_ai_status == 1) ? "READY" : ((g_ai_status == 2) ? "FAILED" : "OFF");
   DCardBox(y, 90, "SHIELDS AND LIMITS");
   DRow(y + 22, "Weekend shield (BTC is 24/7)", InpWeekendShield ? "ON" : "OFF", dText());
   DRow(y + 38, "Spread shield", InpSpreadShieldEnabled ? "ON" : "OFF", InpSpreadShieldEnabled ? dGreen() : dDim());
   DRow(y + 54, "Prop mode  /  daily loss limit", (InpPropFirmMode ? "ON" : "off") + "  /  " + (InpDailyLossLimitEnabled ? "ON" : "off"), dText());
   DRow(y + 70, "Trades today  |  AI filter", (string)g_tradesToday + " / " + (string)InpMaxTradesPerDay + "  |  " + ai, dText());
   y += 96;

   // open positions
   int np = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber) np++;
   DCardBox(y, 104, "OPEN POSITIONS  " + (string)np);
   int row = 0;
   for(int i = PositionsTotal() - 1; i >= 0 && row < 4; i--) {
      if(!posInfo.SelectByIndex(i) || posInfo.Symbol() != _Symbol || posInfo.Magic() != InpMagicNumber) continue;
      bool buy = posInfo.PositionType() == POSITION_TYPE_BUY;
      double pl = posInfo.Profit() + posInfo.Swap();
      DTx(20, y + 22 + row * 19, (buy ? "BUY  " : "SELL ") + DoubleToString(posInfo.Volume(), 2) + "  @ " + DoubleToString(posInfo.PriceOpen(), 2), buy ? dGreen() : dRed());
      DTx(DW - 20, y + 22 + row * 19, (pl >= 0 ? "+" : "") + DoubleToString(pl, 2), pl >= 0 ? dGreen() : dRed(), -90, true, TA_RIGHT | TA_TOP);
      row++;
   }
   if(row == 0) DTx(20, y + 24, "no open position", dDim());
   y += 110;

   // last 5 closed trades
   DCardBox(y, 124, "LAST 5 CLOSED TRADES");
   int n = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0 && n < 5; i--) {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != (long)InpMagicNumber || HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) continue;
      double p = HistoryDealGetDouble(tk, DEAL_PROFIT);
      datetime t = (datetime)HistoryDealGetInteger(tk, DEAL_TIME);
      long dt = HistoryDealGetInteger(tk, DEAL_TYPE);
      DTx(20, y + 22 + n * 19, (dt == DEAL_TYPE_BUY ? "B   " : "S   ") + TimeToString(t, TIME_DATE | TIME_MINUTES), dDim(), -85);
      DTx(DW - 20, y + 22 + n * 19, (p >= 0 ? "+" : "") + DoubleToString(p, 2) + "   " + GetTradeGrade(p), p >= 0 ? dGreen() : dRed(), -85, true, TA_RIGHT | TA_TOP);
      n++;
   }
   if(n == 0) DTx(20, y + 24, "no closed trade yet", dDim());
   y += 130;

   cvs.Update();

   // pause / close buttons stay real chart buttons (a canvas cannot be clicked)
   CreateButton(g_prefix + "BtnPause", InpDashX + 10, InpDashY + y + 4, 170, 28, g_isPaused ? "RESUME" : "PAUSE", clrWhite, g_isPaused ? clrGreen : clrFireBrick);
   CreateButton(g_prefix + "BtnClose", InpDashX + 190, InpDashY + y + 4, 170, 28, "CLOSE ALL", clrWhite, clrDarkOrange);
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