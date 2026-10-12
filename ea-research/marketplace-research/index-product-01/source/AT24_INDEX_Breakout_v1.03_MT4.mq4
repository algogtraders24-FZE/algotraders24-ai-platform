//+------------------------------------------------------------------+
//|                                AT24_INDEX_Breakout_v1.03_MT4.mq4  |
//|                        Copyright algotraders24.ai                  |
//|     Multi-Index breakout MT4 - Nova / Zenith / Eclipse (v1.03)      |
//+------------------------------------------------------------------+
// v1.03 = XXX Multi-Index MT4 v1.02 with the review fixes (see CHANGELOG-v1.03-MT4.md):
//   1  The daily trade limit counted every CLOSED order incl. deleted pending orders (each cancelled stop counted as a trade), and
//      did not count the trade that was still open. Now: market trades (buy/sell) opened today, open or closed.
//   2  Profit factor = gross profit / gross loss (was net profit / number of losses); history lists exclude pending orders and balance rows
//   3  One order per module and side (old order replaced each bar), one trade per module, cap on open positions
//   4  Prop mode measured from the START balance; locks stay locked; daily-loss limit works on its own
//   5  Distances are INDEX points by default (same on every broker); broker-point mode kept as an option
//   6  Lots normalised to min/max/step, free-margin check
//   7  Eclipse: v1.02 required an upper AND a lower fractal on the same single bar (it could essentially never trade). Now the latest of each
//   8  Zenith: v1.02 MT4 used 12 bars while the MT5 build and the label say 20. Now an input, default 20 (same as MT5)
//   9  AT24 licence guard (activate + daily re-validation); tester carve-out; existing trades are still managed
// IMPORTANT: behaviour changed (1, 3, 5, 7, 8) - any v1.02 evidence does NOT describe this version.
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property version   "1.03"
#property strict
#property description "AT24 Index Breakout MT4 - Nova + Zenith + Eclipse"
#property description "Requires an AT24 licence. Not a promise of results: trading involves risk of loss."

#define PRODUCT_NAME           "AT24 Index Breakout"
// Fixed product identity of this build. MUST equal the TradingSystem / Version registered for the listing this file is sold under.
#define AT24_TRADING_SYSTEM_ID "INDEX-BREAKOUT"
#define AT24_VERSION_ID        "INDEX-BREAKOUT-v1.03"
#define AT24_PLATFORM          "MT4"

//--- COLORS
color clrBG         = clrBlack;
color clrGoldColor  = clrOrange;
color clrText       = clrWhite;
color clrTextGreen  = clrLime;
color clrTextRed    = clrRed;
color clrPanelBG    = clrBlue;
color clrGrayBox    = clrGray;

enum ENUM_POINT_MODE { PM_INDEX = 0, PM_BROKER = 1 };

//--- INPUTS
input string __lot__                  = "=== LOT SIZE ===";
input int    InpSizingMode           = 0;       // 0 = fixed lot, 1 = risk %
input double InpFixedLot             = 0.01;
input double InpRiskPercent          = 2.0;
input double InpMaxLot               = 0.0;     // 0 = no extra cap
input bool   InpAutoLotGrowth        = false;
input double InpAutoLotBaseBalance   = 1000.0;
input double InpAutoLotBalanceStep   = 500.0;
input double InpAutoLotStepSize      = 0.01;

input string __tm__                   = "=== TRADE MANAGEMENT (distances) ===";
input ENUM_POINT_MODE InpPointMode   = PM_INDEX; // PM_INDEX: 1.0 = one full index point on every broker. PM_BROKER: 1.0 = one broker point (old behaviour)
input bool   InpMoonLockEnabled      = true;
input double InpMoonLockStart        = 1.0;     // account currency
input double InpMoonLockPercent      = 50.0;
input double InpStopLossPoints       = 120.0;
input double InpTakeProfitPoints     = 400.0;
input bool   InpAutoBreakeven        = true;
input double InpBE_TriggerPoints     = 40.0;
input double InpBE_LockPoints        = 10.0;
input bool   InpTimeStopEnabled      = true;
input int    InpTimeStopMinutes      = 45;
input bool   InpSmartTrailing        = true;
input double InpTrailStartPoints     = 80.0;
input double InpTrailStepPoints      = 40.0;

input string __mod__                  = "=== MODULES (NOVA / ZENITH / ECLIPSE) ===";
input bool   InpEnableNova           = true;
input bool   InpEnableZenith         = true;
input bool   InpEnableEclipse        = true;
input int    InpZenithBars           = 20;      // v1.02 MT4 used 12; the MT5 build and the module name say 20
input bool   InpOneTradePerModule    = true;    // a module places no new order while its own trade is open
input int    InpMaxOpenPositions     = 3;       // cap on open trades for this symbol + magic

input string __mtf__                  = "=== MTF TREND ===";
input bool   InpUseMTFTrend          = true;
input ENUM_TIMEFRAMES InpMTF_Timeframe = PERIOD_H1;
input int    InpFastEMA              = 50;
input int    InpSlowEMA              = 200;

input string __sh__                   = "=== SHIELDS ===";
input bool   InpWeekendShield        = true;
input int    InpFridayPauseHour      = 20;
input int    InpMondayResumeHour     = 5;
input bool   InpSpreadShieldEnabled  = true;
input int    InpMaxSpreadPoints      = 100;     // always BROKER points (that is what the terminal reports)

input string __pf__                   = "=== PROP FIRM ===";
input bool   InpPropFirmMode         = false;
input double InpPropStartBalance     = 0.0;     // 0 = the balance when this EA first started on this account (remembered)
input double InpPropFirmMaxDrawdown  = 10.0;    // % of the start balance (static)
input double InpPropFirmProfitTarget = 8.0;     // % of the start balance
input bool   InpDailyLossLimitEnabled= false;
input double InpMaxDailyLossPercent  = 5.0;     // % of today's starting equity

input string __gen__                  = "=== GENERAL ===";
input ENUM_TIMEFRAMES InpTF          = PERIOD_M15;
input int    InpMagicNumber          = 33302; // Change per index chart!
input int    InpMaxTradesPerDay      = 10;
input double InpBreakoutBufferPoints = 5.0;
input bool   InpShowDashboard        = true;

input string __lic__                  = "=== AT24 LICENSE ===";
input string InpLicenseKey           = "";      // EASIEST: paste ONE key here (AT24-...). If you use it, leave the 4 rows below empty
input string InpLicenseId            = "";      // (alternative) AT24 License ID
input string InpApiKey               = "";      // (alternative) AT24 API Key
input string InpBuyerId              = "";      // (alternative) AT24 Buyer ID
input string InpReleaseId            = "";      // (alternative) AT24 Release ID
input string InpApiBaseUrl           = "https://www.algotraders24.ai";
input int    InpLicenseRecheckHours  = 24;

//--- GLOBALS
int      g_slippage = 30;
datetime g_lastBarTime = 0;
int      g_tradesToday = 0;
datetime g_todayStart = 0;
double   g_dailyStartEquity = 0.0;
double   g_peakEquity = 0.0;
double   g_propStart = 0.0;
bool     g_isPaused = false;      // manual (PAUSE button) - stays until RESUME
bool     g_dailyPaused = false;   // daily-loss limit - resets on the next trading day
bool     g_propLocked = false;    // prop target / max drawdown reached - stays until the EA is re-attached
double   g_totalProfit = 0, g_grossProfit = 0, g_grossLoss = 0;
int      g_totalWins = 0;
int      g_totalLosses = 0;
int      g_histCount = -1;        // OrdersHistoryTotal() when the stats were last computed

struct LastTrade { datetime t; double profit; bool isBuy; };
LastTrade g_last[5];
int      g_lastCount = 0;

struct MoonLockData { int ticket; double peakProfit; bool active; bool isBE; };
MoonLockData g_locks[];
string g_prefix = "XIDX_";

bool     g_AT24_Licensed  = false;
datetime g_AT24_LastCheck = 0;

//+------------------------------------------------------------------+
//| AT24 LICENSE GUARD (same mechanism as the other AT24 EAs)        |
//| WebRequest needs the base URL under Tools > Options > Expert     |
//| Advisors > "Allow WebRequest for listed URL".                    |
//+------------------------------------------------------------------+
string AT24_JsonEscape(const string s)
{
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
}

string AT24_JsonExtractString(const string json, const string key)
{
   string needle = "\"" + key + "\":\"";
   int p = StringFind(json, needle);
   if(p < 0) return "";
   int start = p + StringLen(needle);
   int end = StringFind(json, "\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

string AT24_BuildDeviceInfoJson()
{
   string login  = IntegerToString(AccountNumber());
   string server = AccountServer();
   string common = TerminalInfoString(TERMINAL_COMMONDATA_PATH);
   return "{\"accountLogin\":\"" + AT24_JsonEscape(login) + "\",\"brokerServer\":\"" + AT24_JsonEscape(server) +
          "\",\"terminalCommonDataGuid\":\"" + AT24_JsonEscape(common) + "\"}";
}

string AT24_PostJson(const string path, const string bodyJson)
{
   string url = InpApiBaseUrl + path;
   string headers = "Content-Type: application/json\r\n";
   char postData[];
   int n = StringToCharArray(bodyJson, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0 && postData[n - 1] == 0) ArrayResize(postData, n - 1);
   else if(n != ArraySize(postData)) ArrayResize(postData, n);

   char result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", url, headers, 8000, postData, result, resultHeaders);
   if(status == -1)
   {
      int err = GetLastError();
      Print("AT24 License: WebRequest to ", url, " failed, error ", err,
            ". Add '", InpApiBaseUrl, "' to MT4 -> Tools -> Options -> Expert Advisors -> 'Allow WebRequest for listed URL'.");
      return "";
   }
   return CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
}

bool AT24_ActivateLicense()
{
   if(StringLen(InpLicenseId) == 0 || StringLen(InpApiKey) == 0)
   {
      Print("AT24 License: No licence key. Paste your key into InpLicenseKey (or the four values into InpLicenseId / InpApiKey / InpBuyerId / InpReleaseId) from your AT24 purchase page.");
      return false;
   }
   string deviceLabel = AT24_JsonEscape(AccountServer() + " #" + IntegerToString(AccountNumber()));
   string body = "{\"licenseId\":\"" + AT24_JsonEscape(InpLicenseId) + "\",\"apiKey\":\"" + AT24_JsonEscape(InpApiKey) +
                 "\",\"deviceInfo\":" + AT24_BuildDeviceInfoJson() + ",\"deviceLabel\":\"" + deviceLabel + "\"}";
   string resp = AT24_PostJson("/api/license/activate", body);
   if(StringLen(resp) == 0) return false;
   if(StringFind(resp, "\"status\":\"ok\"") >= 0)
   {
      Print("AT24 License: activated OK. deviceBindingId=", AT24_JsonExtractString(resp, "deviceBindingId"));
      g_AT24_LastCheck = TimeCurrent();
      return true;
   }
   Print("AT24 License: activation REJECTED (", AT24_JsonExtractString(resp, "code"), "): ", AT24_JsonExtractString(resp, "message"),
         ". This copy will not trade. Check your License ID/API Key and activation limit in your AT24 dashboard.");
   return false;
}

//+------------------------------------------------------------------+
//| ONE-KEY mode: POST /api/license/check with the single key        |
//| AT24-<licenseId>.<secret>. The same call binds this trading      |
//| account (one activation per account by default). Returns         |
//|   1 = valid for THIS product, 0 = explicitly refused,            |
//|  -1 = no usable answer (network / server problem: keep state).   |
//+------------------------------------------------------------------+
int AT24_CheckKey()
{
   string k = InpLicenseKey;
   StringTrimLeft(k);
   StringTrimRight(k);
   string body = "{\"key\":\"" + AT24_JsonEscape(k) + "\",\"account\":\"" + AT24_JsonEscape(IntegerToString(AccountNumber())) +
                 "\",\"server\":\"" + AT24_JsonEscape(AccountServer()) + "\",\"requireAccount\":true}";
   string resp = AT24_PostJson("/api/license/check", body);
   if(StringLen(resp) == 0) return -1;
   if(StringFind(resp, "\"valid\":false") >= 0)
   {
      Print("AT24 License: key REJECTED (", AT24_JsonExtractString(resp, "reason"), "): ", AT24_JsonExtractString(resp, "detail"),
            ". This copy will not trade. Check the key on your AT24 purchase page.");
      return 0;
   }
   if(StringFind(resp, "\"valid\":true") < 0) return -1;
   // The key must belong to THIS product on THIS platform (a key for another AT24 product must not run this EA).
   string sys = AT24_JsonExtractString(resp, "tradingSystemId");
   string plat = AT24_JsonExtractString(resp, "platform");
   if(sys != AT24_TRADING_SYSTEM_ID || plat != AT24_PLATFORM)
   {
      Print("AT24 License: this key is for another product (", sys, " / ", plat, "), not ", AT24_TRADING_SYSTEM_ID, " / ", AT24_PLATFORM, ". This copy will not trade.");
      return 0;
   }
   Print("AT24 License: key accepted. Expires: ", AT24_JsonExtractString(resp, "expiresAt"));
   g_AT24_LastCheck = TimeCurrent();
   return 1;
}

// Start-up: one key if given, else the four separate values.
bool AT24_StartLicense()
{
   if(StringLen(InpLicenseKey) > 0) return (AT24_CheckKey() == 1);
   return AT24_ActivateLicense();
}

void AT24_RevalidateIfDue()
{
   if(InpLicenseRecheckHours <= 0) return;
   if(TimeCurrent() - g_AT24_LastCheck < InpLicenseRecheckHours * 3600) return;
   if(StringLen(InpLicenseKey) > 0)
   {
      bool wasLicensed = g_AT24_Licensed;
      int r = AT24_CheckKey();
      g_AT24_LastCheck = TimeCurrent();
      if(r == 1)
      {
         if(!wasLicensed) Print("AT24 License: re-validated OK, resuming new trades.");
         g_AT24_Licensed = true;
      }
      else if(r == 0)
      {
         if(wasLicensed) Print("AT24 License: re-validation FAILED - no new trades will open. Existing positions are still managed.");
         g_AT24_Licensed = false;
      }
      return;
   }
   if(StringLen(InpBuyerId) == 0 || StringLen(InpReleaseId) == 0)
   {
      g_AT24_LastCheck = TimeCurrent();
      return;
   }
   string body = "{\"licenseId\":\"" + AT24_JsonEscape(InpLicenseId) + "\",\"apiKey\":\"" + AT24_JsonEscape(InpApiKey) +
                 "\",\"buyerId\":\"" + AT24_JsonEscape(InpBuyerId) + "\",\"tradingSystemId\":\"" + AT24_TRADING_SYSTEM_ID +
                 "\",\"versionId\":\"" + AT24_VERSION_ID + "\",\"releaseId\":\"" + AT24_JsonEscape(InpReleaseId) +
                 "\",\"platform\":\"" + AT24_PLATFORM + "\",\"deviceInfo\":" + AT24_BuildDeviceInfoJson() + "}";
   string resp = AT24_PostJson("/api/license/validate", body);
   g_AT24_LastCheck = TimeCurrent();
   if(StringLen(resp) == 0) return;   // network problem: keep the last known state, try again next time
   bool ok = (StringFind(resp, "\"status\":\"ok\"") >= 0) && (StringFind(resp, "\"ok\":true") >= 0);
   if(ok)
   {
      if(!g_AT24_Licensed) Print("AT24 License: re-validated OK, resuming new trades.");
      g_AT24_Licensed = true;
   }
   else
   {
      if(g_AT24_Licensed) Print("AT24 License: re-validation FAILED (", AT24_JsonExtractString(resp, "reason"), ") - no new trades will open. Existing trades are still managed.");
      g_AT24_Licensed = false;
   }
}

//+------------------------------------------------------------------+
//| Distances: convert an input "points" value to a price distance   |
//+------------------------------------------------------------------+
double PU(const double v)
{
   return (InpPointMode == PM_INDEX) ? v : v * MarketInfo(_Symbol, MODE_POINT);
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(IsTesting())
   {
      g_AT24_Licensed = true;
      Print(PRODUCT_NAME, ": running inside the Strategy Tester - licence guard skipped (no network calls in the tester).");
   }
   else
   {
      g_AT24_Licensed = AT24_StartLicense();
      if(!g_AT24_Licensed)
      {
         Print(PRODUCT_NAME, ": NOT licensed - the EA will not trade. Paste your key into InpLicenseKey from your AT24 purchase page.");
         return INIT_FAILED;
      }
   }

   g_dailyStartEquity = AccountEquity();
   g_peakEquity = g_dailyStartEquity;

   // Prop-firm start balance: the input, else the balance at the first start on this account (remembered across restarts).
   string gv = g_prefix + "StartBal_" + IntegerToString(AccountNumber());
   if(InpPropStartBalance > 0) g_propStart = InpPropStartBalance;
   else if(GlobalVariableCheck(gv)) g_propStart = GlobalVariableGet(gv);
   else { g_propStart = AccountBalance(); GlobalVariableSet(gv, g_propStart); }

   // Show what the distances really are on this symbol, so a wrong point mode is obvious.
   double sl = PU(InpStopLossPoints), tp = PU(InpTakeProfitPoints);
   double spreadPrice = MarketInfo(_Symbol, MODE_SPREAD) * MarketInfo(_Symbol, MODE_POINT);
   Print(PRODUCT_NAME, " v1.03 MT4 on ", _Symbol, ": SL=", DoubleToString(sl, _Digits), " TP=", DoubleToString(tp, _Digits),
         " (price units, mode ", (InpPointMode == PM_INDEX ? "INDEX" : "BROKER"), "), spread now=", DoubleToString(spreadPrice, _Digits));
   if(sl < spreadPrice * 3.0) Print("WARNING: the stop loss is less than 3x the current spread. Check InpPointMode and the distances for this symbol.");

   EventSetTimer(1);
   UpdateStatistics();
   if(InpShowDashboard) DrawFinalDashboard();
   ChartRedraw();
   Print("Modules: Nova=", InpEnableNova, " Zenith=", InpEnableZenith, " Eclipse=", InpEnableEclipse, " | Copyright algotraders24.ai");
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0, g_prefix);
   ChartRedraw();
   Print(PRODUCT_NAME, " MT4 deinitialised");
}

//+------------------------------------------------------------------+
void OnTimer()
{
   // MT4 has no trade-transaction event: recompute the stats only when the history length changed.
   if(OrdersHistoryTotal() != g_histCount) UpdateStatistics();
   if(InpShowDashboard) DrawFinalDashboard();
   ChartRedraw();
}

//+------------------------------------------------------------------+
void OnTick()
{
   CheckNewDay();
   if(!IsTesting()) AT24_RevalidateIfDue();
   ManageTradeExits();   // open trades are always managed, even when new trading is blocked

   bool propHit = CheckPropFirmLimits();
   bool isBlocked = !g_AT24_Licensed || g_isPaused || g_dailyPaused || g_propLocked || propHit || IsWeekendBlocked() || IsSpreadBlocked();

   if(isBlocked) DeleteAllPendingOrders();
   else
   {
      DeleteStalePendingOrders();
      if(IsNewBar()) PlaceBreakoutOrders();
   }
}

//+------------------------------------------------------------------+
void OnChartEvent(const int id, const long &lparam, const double &dparam, const string &sparam)
{
   if(id == CHARTEVENT_OBJECT_CLICK)
   {
      if(sparam == g_prefix + "BtnPause")
      {
         g_isPaused = !g_isPaused;
         ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
         ChartRedraw();
      }
      if(sparam == g_prefix + "BtnClose")
      {
         CloseAllPositions();
         ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
         ChartRedraw();
      }
   }
}

//+------------------------------------------------------------------+
void DrawFinalDashboard()
{
   int xLeft = 10, yTop = 10, wLeft = 300;
   bool paused = g_isPaused || g_dailyPaused || g_propLocked;

   CreateRect(g_prefix + "Header", xLeft, yTop, wLeft, 55, clrPanelBG, clrGoldColor);
   SetLabel(g_prefix + "Brand", xLeft + 10, yTop + 8, "ALGOTRADERS24", clrText, 12, "Arial Bold");
   SetLabel(g_prefix + "Sub", xLeft + 10, yTop + 22, "INDEX BREAKOUT MT4 v1.03 (" + _Symbol + ")", clrGoldColor, 9, "Arial");
   string st = !g_AT24_Licensed ? "NOT LICENSED" : (g_propLocked ? "PROP LOCK" : (g_dailyPaused ? "DAILY LIMIT" : (g_isPaused ? "PAUSED" : "ACTIVE")));
   SetLabel(g_prefix + "Status", xLeft + 10, yTop + 38, st, (paused || !g_AT24_Licensed) ? clrTextRed : clrTextGreen, 10, "Arial Bold");

   int yStats = yTop + 70;
   CreateRect(g_prefix + "StatsBG", xLeft, yStats, wLeft, 85, clrBG, clrGrayBox);
   double balance = AccountBalance();
   double equity = AccountEquity();
   double dailyPL = equity - g_dailyStartEquity;
   double dailyPLPercent = (g_dailyStartEquity > 0) ? (dailyPL / g_dailyStartEquity * 100) : 0;
   double dd = g_peakEquity > 0 ? ((g_peakEquity - equity) / g_peakEquity * 100) : 0;
   int spread_int = (int)MarketInfo(_Symbol, MODE_SPREAD);

   SetLabel(g_prefix + "Balance", xLeft + 10, yStats + 8, "BAL: $" + DoubleToString(balance, 2), clrText, 9, "Arial Bold");
   SetLabel(g_prefix + "Equity", xLeft + 150, yStats + 8, "EQ: $" + DoubleToString(equity, 2), clrText, 9, "Arial Bold");
   color plColor = (dailyPL >= 0) ? clrTextGreen : clrTextRed;
   SetLabel(g_prefix + "PL", xLeft + 10, yStats + 24, "P/L: $" + DoubleToString(dailyPL, 2), plColor, 9, "Arial Bold");
   SetLabel(g_prefix + "PLPercent", xLeft + 150, yStats + 24, "(" + DoubleToString(dailyPLPercent, 2) + "%)", plColor, 8, "Arial");
   SetLabel(g_prefix + "DD", xLeft + 10, yStats + 40, "DD: " + DoubleToString(dd, 2) + "%", clrOrange, 9, "Arial Bold");
   SetLabel(g_prefix + "Spread", xLeft + 10, yStats + 56, "SPREAD: " + IntegerToString(spread_int) + " pts", clrText, 8, "Arial");
   string risk = (InpSizingMode == 1) ? "RISK: " + DoubleToString(InpRiskPercent, 2) + "%" : "LOT: " + DoubleToString(InpFixedLot, 2);
   SetLabel(g_prefix + "Risk", xLeft + 150, yStats + 56, risk, clrGoldColor, 8, "Arial");

   int yPerf = yStats + 95;
   CreateRect(g_prefix + "PerfBG", xLeft, yPerf, wLeft, 65, clrBG, clrGrayBox);
   SetLabel(g_prefix + "PerfTitle", xLeft + 10, yPerf + 8, "PERFORMANCE", clrBlue, 8, "Arial Bold");
   int totalTrades = g_totalWins + g_totalLosses;
   double winRate = (totalTrades > 0) ? (g_totalWins * 100.0 / totalTrades) : 0;
   double profitFactor = (g_grossLoss > 0) ? (g_grossProfit / g_grossLoss) : 0;
   SetLabel(g_prefix + "WinRate", xLeft + 10, yPerf + 24, "WIN: " + DoubleToString(winRate, 1) + "%", clrTextGreen, 8, "Arial Bold");
   SetLabel(g_prefix + "Trades", xLeft + 10, yPerf + 38, "TRADES: " + IntegerToString(totalTrades), clrText, 8, "Arial Bold");
   SetLabel(g_prefix + "PF", xLeft + 150, yPerf + 24, "PF: " + (g_grossLoss > 0 ? DoubleToString(profitFactor, 2) : "n/a"), clrGoldColor, 8, "Arial Bold");
   SetLabel(g_prefix + "Wins", xLeft + 150, yPerf + 38, "W:" + IntegerToString(g_totalWins) + " L:" + IntegerToString(g_totalLosses), clrTextGreen, 7, "Arial");

   int yModules = yPerf + 75;
   CreateRect(g_prefix + "ModulesBG", xLeft, yModules, wLeft, 65, clrBG, clrGrayBox);
   SetLabel(g_prefix + "ModulesTitle", xLeft + 10, yModules + 8, "MODULES", clrBlue, 8, "Arial Bold");
   CreateModuleRowCompact("Nova", InpEnableNova, yModules + 22, xLeft);
   CreateModuleRowCompact("Zenith", InpEnableZenith, yModules + 37, xLeft);
   CreateModuleRowCompact("Eclipse", InpEnableEclipse, yModules + 52, xLeft);

   int yShields = yModules + 75;
   CreateRect(g_prefix + "ShieldsBG", xLeft, yShields, wLeft, 50, clrBG, clrGrayBox);
   SetLabel(g_prefix + "ShieldsTitle", xLeft + 10, yShields + 8, "SHIELDS", clrBlue, 8, "Arial Bold");
   SetLabel(g_prefix + "Prop", xLeft + 10, yShields + 24, "PROP: " + (InpPropFirmMode ? "ON" : "OFF"), InpPropFirmMode ? clrTextGreen : clrTextRed, 7, "Arial");
   SetLabel(g_prefix + "Weekend", xLeft + 70, yShields + 24, "WKND: " + (InpWeekendShield ? "ON" : "OFF"), InpWeekendShield ? clrTextGreen : clrTextRed, 7, "Arial");
   SetLabel(g_prefix + "SpreadShield", xLeft + 140, yShields + 24, "SPRD: " + (InpSpreadShieldEnabled ? "ON" : "OFF"), InpSpreadShieldEnabled ? clrTextGreen : clrTextRed, 7, "Arial");
   SetLabel(g_prefix + "Lic", xLeft + 210, yShields + 24, "LIC: " + (g_AT24_Licensed ? "OK" : "NO"), g_AT24_Licensed ? clrTextGreen : clrTextRed, 7, "Arial Bold");

   int yButtons = yShields + 60;
   CreateButton(g_prefix + "BtnPause", xLeft + 10, yButtons, 140, 28, g_isPaused ? "RESUME" : "PAUSE", clrText, g_isPaused ? clrGreen : clrRed);
   CreateButton(g_prefix + "BtnClose", xLeft + 155, yButtons, 140, 28, "CLOSE ALL", clrText, clrOrange);
   SetLabel(g_prefix + "Footer", xLeft + 10, yButtons + 32, "algotraders24.ai | Index Breakout MT4 v1.03", clrGoldColor, 7, "Arial");

   int yTrades = yButtons + 50;
   CreateRect(g_prefix + "TradesBG", xLeft, yTrades, wLeft, 100, clrBG, clrGrayBox);
   SetLabel(g_prefix + "TradesTitle", xLeft + 10, yTrades + 8, "LAST 5 TRADES", clrBlue, 8, "Arial Bold");
   int yTrade = yTrades + 22;
   for(int n = 0; n < 5; n++)
   {
      string k = IntegerToString(n + 1);
      if(n < g_lastCount)
      {
         double profit = g_last[n].profit;
         string side = g_last[n].isBuy ? "B" : "S";
         SetLabel(g_prefix + "TNum" + k, xLeft + 10, yTrade, k, clrText, 7, "Arial");
         SetLabel(g_prefix + "TSide" + k, xLeft + 28, yTrade, side, side == "B" ? clrTextGreen : clrTextRed, 7, "Arial Bold");
         SetLabel(g_prefix + "TProfit" + k, xLeft + 55, yTrade, "$" + DoubleToString(profit, 2), profit >= 0 ? clrTextGreen : clrTextRed, 8, "Arial Bold");
         SetLabel(g_prefix + "TGrade" + k, xLeft + 130, yTrade, GetTradeGrade(profit), clrGoldColor, 7, "Arial");
         SetLabel(g_prefix + "TTime" + k, xLeft + 170, yTrade, TimeToString(g_last[n].t, TIME_DATE | TIME_MINUTES), clrGray, 7, "Arial");
         yTrade += 18;
      }
      else
      {
         ObjectDelete(0, g_prefix + "TNum" + k);    ObjectDelete(0, g_prefix + "TSide" + k);
         ObjectDelete(0, g_prefix + "TProfit" + k); ObjectDelete(0, g_prefix + "TGrade" + k);
         ObjectDelete(0, g_prefix + "TTime" + k);
      }
   }
}

//+------------------------------------------------------------------+
void CreateModuleRowCompact(string moduleName, bool enabled, int yPos, int xPos)
{
   SetLabel(g_prefix + "Mod" + moduleName, xPos + 10, yPos, moduleName + ": " + (enabled ? "ON" : "OFF"), enabled ? clrTextGreen : clrTextRed, 7, "Arial");
}

string GetTradeGrade(double profit)
{
   if(profit >= 10.0) return "S+ BEST";
   if(profit >= 5.0) return "A+ EXC";
   if(profit >= 2.0) return "A GOOD";
   if(profit >= 0) return "B NORM";
   if(profit >= -2.0) return "C POOR";
   return "D LOSS";
}

//+------------------------------------------------------------------+
void CreateRect(string name, int x, int y, int w, int h, color bgColor, color borderColor)
{
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

void SetLabel(string name, int x, int y, string text, color clr, int size, string font)
{
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

//+------------------------------------------------------------------+
//| Statistics from the closed MARKET trades of this EA (FIX 1/2).   |
//| Pending orders that were deleted or expired are NOT trades.      |
//+------------------------------------------------------------------+
void UpdateStatistics()
{
   g_totalWins = 0; g_totalLosses = 0; g_totalProfit = 0; g_grossProfit = 0; g_grossLoss = 0; g_lastCount = 0;
   g_histCount = OrdersHistoryTotal();
   // History is sorted by close time; walk it from the newest so the first 5 hits are the last 5 trades.
   for(int i = g_histCount - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderMagicNumber() != InpMagicNumber || OrderSymbol() != _Symbol) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      double profit = OrderProfit() + OrderSwap() + OrderCommission();
      g_totalProfit += profit;
      if(profit > 0) { g_totalWins++; g_grossProfit += profit; }
      else if(profit < 0) { g_totalLosses++; g_grossLoss += -profit; }
      if(g_lastCount < 5)
      {
         g_last[g_lastCount].t = OrderCloseTime();
         g_last[g_lastCount].profit = profit;
         g_last[g_lastCount].isBuy = (type == OP_BUY);
         g_lastCount++;
      }
   }
}

//+------------------------------------------------------------------+
void CleanLocks()
{
   for(int i = ArraySize(g_locks) - 1; i >= 0; i--)
   {
      if(!OrderSelect(g_locks[i].ticket, SELECT_BY_TICKET) || OrderCloseTime() != 0) RemoveLock(i);
   }
}

// A stop-loss change must respect the broker's minimum distance.
bool StopsOk(int type, double newSL, double price)
{
   double minDist = MarketInfo(_Symbol, MODE_STOPLEVEL) * MarketInfo(_Symbol, MODE_POINT);
   if(type == OP_BUY) return (price - newSL) >= minDist;
   return (newSL - price) >= minDist;
}

//+------------------------------------------------------------------+
void ManageTradeExits()
{
   double point = MarketInfo(_Symbol, MODE_POINT);
   int digits = (int)MarketInfo(_Symbol, MODE_DIGITS);
   CleanLocks();

   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;   // pending orders are handled elsewhere

      int ticket = OrderTicket();
      int idx = FindLock(ticket);
      if(idx == -1) idx = AddLock(ticket);

      double openPrice = OrderOpenPrice();
      double currentSL = OrderStopLoss();
      double currentTP = OrderTakeProfit();
      bool isBuy = (type == OP_BUY);
      double currentPrice = isBuy ? MarketInfo(_Symbol, MODE_BID) : MarketInfo(_Symbol, MODE_ASK);
      double profit = OrderProfit() + OrderSwap() + OrderCommission();
      double lots = OrderLots();

      // TIME STOP
      if(InpTimeStopEnabled)
      {
         int minutesOpen = (int)((TimeCurrent() - OrderOpenTime()) / 60);
         if(minutesOpen >= InpTimeStopMinutes && profit < 0)
         {
            if(!OrderClose(ticket, lots, currentPrice, g_slippage, clrGray)) Print("OrderClose (time stop) failed: ", ticket, " error ", GetLastError());
            RemoveLock(idx);
            continue;
         }
      }

      // BREAKEVEN
      if(InpAutoBreakeven && !g_locks[idx].isBE)
      {
         double triggerDist = PU(InpBE_TriggerPoints);
         double lockDist = PU(InpBE_LockPoints);
         if(isBuy)
         {
            if((currentPrice - openPrice) >= triggerDist)
            {
               double newSL = NormalizeDouble(openPrice + lockDist, digits);
               if(newSL > currentSL && StopsOk(OP_BUY, newSL, currentPrice))
               {
                  if(OrderModify(ticket, openPrice, newSL, currentTP, 0, clrBlue)) { g_locks[idx].isBE = true; currentSL = newSL; }
                  else Print("OrderModify (BE) failed: ", ticket, " error ", GetLastError());
               }
            }
         }
         else
         {
            if((openPrice - currentPrice) >= triggerDist)
            {
               double newSL = NormalizeDouble(openPrice - lockDist, digits);
               if((newSL < currentSL || currentSL == 0) && StopsOk(OP_SELL, newSL, currentPrice))
               {
                  if(OrderModify(ticket, openPrice, newSL, currentTP, 0, clrBlue)) { g_locks[idx].isBE = true; currentSL = newSL; }
                  else Print("OrderModify (BE) failed: ", ticket, " error ", GetLastError());
               }
            }
         }
      }

      // TRAILING
      if(InpSmartTrailing)
      {
         double trailStartDist = PU(InpTrailStartPoints);
         double trailStepDist = PU(InpTrailStepPoints);
         double minGain = 5 * point;
         if(isBuy)
         {
            if((currentPrice - openPrice) >= trailStartDist)
            {
               double newSL = NormalizeDouble(currentPrice - trailStepDist, digits);
               if(newSL > currentSL + minGain && StopsOk(OP_BUY, newSL, currentPrice))
                  if(!OrderModify(ticket, openPrice, newSL, currentTP, 0, clrGreen)) Print("OrderModify (Trail) failed: ", ticket, " error ", GetLastError());
            }
         }
         else
         {
            if((openPrice - currentPrice) >= trailStartDist)
            {
               double newSL = NormalizeDouble(currentPrice + trailStepDist, digits);
               if((currentSL == 0 || newSL < currentSL - minGain) && StopsOk(OP_SELL, newSL, currentPrice))
                  if(!OrderModify(ticket, openPrice, newSL, currentTP, 0, clrGreen)) Print("OrderModify (Trail) failed: ", ticket, " error ", GetLastError());
            }
         }
      }

      // MOONLOCK: once in profit by InpMoonLockStart, close if profit falls to InpMoonLockPercent of its peak
      if(InpMoonLockEnabled)
      {
         if(!g_locks[idx].active && profit >= InpMoonLockStart) { g_locks[idx].active = true; g_locks[idx].peakProfit = profit; }
         if(g_locks[idx].active && profit > g_locks[idx].peakProfit) g_locks[idx].peakProfit = profit;
         if(g_locks[idx].active && profit <= g_locks[idx].peakProfit * (InpMoonLockPercent / 100.0) && profit > 0)
         {
            if(!OrderClose(ticket, lots, currentPrice, g_slippage, clrOrange)) Print("OrderClose (MoonLock) failed: ", ticket, " error ", GetLastError());
            RemoveLock(idx);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| FIX 4: prop-firm limits from the START balance; locks persist;   |
//| the daily-loss limit is independent of prop mode.                |
//+------------------------------------------------------------------+
bool CheckPropFirmLimits()
{
   double eq = AccountEquity();
   g_peakEquity = MathMax(g_peakEquity, eq);
   if(g_propLocked) return true;

   if(InpPropFirmMode && g_propStart > 0)
   {
      if((eq - g_propStart) >= g_propStart * (InpPropFirmProfitTarget / 100.0))
      {
         Print("Prop profit target reached - closing everything and locking.");
         CloseAllPositions(); DeleteAllPendingOrders(); g_propLocked = true; return true;
      }
      if((g_propStart - eq) >= g_propStart * (InpPropFirmMaxDrawdown / 100.0))
      {
         Print("Prop max drawdown reached - closing everything and locking.");
         CloseAllPositions(); DeleteAllPendingOrders(); g_propLocked = true; return true;
      }
   }
   if(InpDailyLossLimitEnabled && !g_dailyPaused && g_dailyStartEquity > 0)
   {
      if((g_dailyStartEquity - eq) >= g_dailyStartEquity * (InpMaxDailyLossPercent / 100.0))
      {
         Print("Daily loss limit reached - closing everything until the next trading day.");
         CloseAllPositions(); DeleteAllPendingOrders(); g_dailyPaused = true; return true;
      }
   }
   return false;
}

//+------------------------------------------------------------------+
void CloseAllPositions()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      int type = OrderType();
      if(type != OP_BUY && type != OP_SELL) continue;
      double closePrice = (type == OP_BUY) ? MarketInfo(_Symbol, MODE_BID) : MarketInfo(_Symbol, MODE_ASK);
      if(!OrderClose(OrderTicket(), OrderLots(), closePrice, g_slippage, clrRed)) Print("OrderClose failed: ", OrderTicket(), " error ", GetLastError());
   }
}

//+------------------------------------------------------------------+
bool IsTrendUp()
{
   if(!InpUseMTFTrend) return true;
   double fast = iMA(_Symbol, InpMTF_Timeframe, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE, 1);
   double slow = iMA(_Symbol, InpMTF_Timeframe, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE, 1);
   return (fast > slow && fast > 0 && slow > 0);
}

bool IsTrendDown()
{
   if(!InpUseMTFTrend) return true;
   double fast = iMA(_Symbol, InpMTF_Timeframe, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE, 1);
   double slow = iMA(_Symbol, InpMTF_Timeframe, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE, 1);
   return (fast < slow && fast > 0 && slow > 0);
}

//+------------------------------------------------------------------+
bool IsWeekendBlocked()
{
   if(!InpWeekendShield) return false;
   datetime now = TimeCurrent();
   int dow = TimeDayOfWeek(now), hr = TimeHour(now);
   if(dow == 0 || dow == 6) return true;
   if(dow == 5 && hr >= InpFridayPauseHour) return true;
   if(dow == 1 && hr < InpMondayResumeHour) return true;
   return false;
}

bool IsSpreadBlocked()
{
   if(!InpSpreadShieldEnabled) return false;
   return ((int)MarketInfo(_Symbol, MODE_SPREAD) > InpMaxSpreadPoints);
}

//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int c = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      if(OrderType() == OP_BUY || OrderType() == OP_SELL) c++;
   }
   return c;
}

// An open trade of this module (the order comment is kept on the trade: "Nova_Buy" / "Nova_Sell").
bool HasOpenModulePosition(const string module)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      if((OrderType() == OP_BUY || OrderType() == OP_SELL) && StringFind(OrderComment(), module) == 0) return true;
   }
   return false;
}

void DeleteModulePending(const string module)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      if(OrderType() != OP_BUYSTOP && OrderType() != OP_SELLSTOP) continue;
      if(StringFind(OrderComment(), module) != 0) continue;
      if(!OrderDelete(OrderTicket())) Print("OrderDelete failed: ", OrderTicket(), " error ", GetLastError());
   }
}

//+------------------------------------------------------------------+
// FIX 7: the most recent real fractal of each side (iFractals returns 0 on bars without one).
double LastFractal(const int mode, const int lookback = 60)
{
   for(int i = 2; i < lookback; i++)
   {
      double v = iFractals(_Symbol, InpTF, mode, i);
      if(v > 0) return v;
   }
   return 0;
}

//+------------------------------------------------------------------+
void PlaceModule(const string module, const double hi, const double lo, const bool trendUp, const bool trendDown,
                 const double slDist, const double tpDist, const double buffer, const int digits, const double minDist, const double lot)
{
   if(InpOneTradePerModule && HasOpenModulePosition(module)) return;
   DeleteModulePending(module);   // replace last bar's order instead of stacking a new one next to it
   if(hi > 0 && trendUp)   PlacePending(OP_BUYSTOP,  hi + buffer, slDist, tpDist, module + "_Buy",  digits, minDist, lot);
   if(lo > 0 && trendDown) PlacePending(OP_SELLSTOP, lo - buffer, slDist, tpDist, module + "_Sell", digits, minDist, lot);
}

void PlaceBreakoutOrders()
{
   if(CountOpenPositions() >= InpMaxOpenPositions) return;
   g_tradesToday = CountTodayTrades();
   if(g_tradesToday >= InpMaxTradesPerDay) return;

   double point = MarketInfo(_Symbol, MODE_POINT);
   int digits = (int)MarketInfo(_Symbol, MODE_DIGITS);
   int stopLevel = (int)MarketInfo(_Symbol, MODE_STOPLEVEL);
   double minDist = (stopLevel + 10) * point;
   double slDist = PU(InpStopLossPoints);
   double tpDist = PU(InpTakeProfitPoints);
   double buffer = PU(InpBreakoutBufferPoints);

   double atr_val = iATR(_Symbol, InpTF, 14, 1);
   if(atr_val <= 0) return;

   double lot = CalculateLotSize();
   if(lot <= 0) return;
   bool trendUp = IsTrendUp(), trendDown = IsTrendDown();

   if(InpEnableNova)
   {
      double h = iHigh(_Symbol, PERIOD_D1, 1), l = iLow(_Symbol, PERIOD_D1, 1);
      PlaceModule("Nova", h, l, trendUp, trendDown, slDist, tpDist, buffer, digits, minDist, lot);
   }
   if(InpEnableZenith)
   {
      int ih = iHighest(_Symbol, InpTF, MODE_HIGH, InpZenithBars, 1), il = iLowest(_Symbol, InpTF, MODE_LOW, InpZenithBars, 1);
      double h = (ih >= 0) ? iHigh(_Symbol, InpTF, ih) : 0, l = (il >= 0) ? iLow(_Symbol, InpTF, il) : 0;
      PlaceModule("Zenith", h, l, trendUp, trendDown, slDist, tpDist, buffer, digits, minDist, lot);
   }
   if(InpEnableEclipse)
   {
      PlaceModule("Eclipse", LastFractal(MODE_UPPER), LastFractal(MODE_LOWER), trendUp, trendDown, slDist, tpDist, buffer, digits, minDist, lot);
   }
}

//+------------------------------------------------------------------+
void PlacePending(int type, double price, double slDist, double tpDist, string comment, int digits, double minDist, double lot)
{
   double ask = MarketInfo(_Symbol, MODE_ASK);
   double bid = MarketInfo(_Symbol, MODE_BID);
   if(type == OP_BUYSTOP && price <= ask + minDist) return;
   if(type == OP_SELLSTOP && price >= bid - minDist) return;

   // FIX 6: never send an order the account cannot carry.
   ResetLastError();
   double freeAfter = AccountFreeMarginCheck(_Symbol, (type == OP_BUYSTOP) ? OP_BUY : OP_SELL, lot);
   if(freeAfter <= 0 || GetLastError() == 134)
   {
      Print("Skipped ", comment, ": not enough free margin for ", DoubleToString(lot, 2), " lots.");
      return;
   }

   price = NormalizeDouble(price, digits);
   double sl = (type == OP_BUYSTOP) ? NormalizeDouble(price - slDist, digits) : NormalizeDouble(price + slDist, digits);
   double tp = (type == OP_BUYSTOP) ? NormalizeDouble(price + tpDist, digits) : NormalizeDouble(price - tpDist, digits);
   color arrow = (type == OP_BUYSTOP) ? clrBlue : clrRed;

   int ticket = OrderSend(_Symbol, type, lot, price, g_slippage, sl, tp, comment, InpMagicNumber, 0, arrow);
   if(ticket < 0) Print("OrderSend ", comment, " failed, error #", GetLastError());
}

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
{
   double step = MarketInfo(_Symbol, MODE_LOTSTEP);
   double minL = MarketInfo(_Symbol, MODE_MINLOT);
   double maxL = MarketInfo(_Symbol, MODE_MAXLOT);
   if(step <= 0) step = 0.01;
   lot = MathFloor(lot / step + 1e-9) * step;
   if(InpMaxLot > 0) lot = MathMin(lot, InpMaxLot);
   lot = MathMax(minL, MathMin(maxL, lot));
   int decimals = (int)MathMax(0.0, MathRound(-MathLog10(step)));
   return NormalizeDouble(lot, decimals);
}

double CalculateLotSize()
{
   if(InpSizingMode == 1)
   {
      double balance = AccountBalance();
      double risk_amount = balance * (InpRiskPercent / 100.0);
      double sl_distance_price = PU(InpStopLossPoints);
      double tick_value = MarketInfo(_Symbol, MODE_TICKVALUE);
      double tick_size = MarketInfo(_Symbol, MODE_TICKSIZE);
      if(tick_size == 0 || tick_value == 0 || sl_distance_price <= 0) return NormalizeLot(InpFixedLot);
      double lot = risk_amount / ((sl_distance_price / tick_size) * tick_value);
      return NormalizeLot(lot);
   }
   double base_lot = InpFixedLot;
   if(InpAutoLotGrowth)
   {
      double growth_amount = AccountBalance() - InpAutoLotBaseBalance;
      if(growth_amount > 0 && InpAutoLotBalanceStep > 0)
      {
         int steps = (int)MathFloor(growth_amount / InpAutoLotBalanceStep);
         base_lot += (steps * InpAutoLotStepSize);
      }
   }
   return NormalizeLot(base_lot);
}

//+------------------------------------------------------------------+
void DeleteStalePendingOrders()
{
   datetime now = TimeCurrent();
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      if(OrderType() != OP_BUYSTOP && OrderType() != OP_SELLSTOP) continue;
      if(now - OrderOpenTime() > 1800)
         if(!OrderDelete(OrderTicket())) Print("OrderDelete failed: ", OrderTicket(), " error ", GetLastError());
   }
}

void DeleteAllPendingOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      if(OrderType() != OP_BUYSTOP && OrderType() != OP_SELLSTOP) continue;
      if(!OrderDelete(OrderTicket())) Print("OrderDelete failed: ", OrderTicket(), " error ", GetLastError());
   }
}

//+------------------------------------------------------------------+
// FIX 1: count MARKET trades opened today - the ones still open and the ones already closed.
// v1.02 counted every closed order of the day, including deleted pending orders.
int CountTodayTrades()
{
   int c = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      if((OrderType() == OP_BUY || OrderType() == OP_SELL) && OrderOpenTime() >= g_todayStart) c++;
   }
   for(int j = OrdersHistoryTotal() - 1; j >= 0; j--)
   {
      if(!OrderSelect(j, SELECT_BY_POS, MODE_HISTORY)) continue;
      if(OrderSymbol() != _Symbol || OrderMagicNumber() != InpMagicNumber) continue;
      if((OrderType() == OP_BUY || OrderType() == OP_SELL) && OrderOpenTime() >= g_todayStart) c++;
   }
   return c;
}

//+------------------------------------------------------------------+
void CheckNewDay()
{
   datetime now = TimeCurrent();
   datetime ts = StringToTime(StringFormat("%04d.%02d.%02d 00:00:00", TimeYear(now), TimeMonth(now), TimeDay(now)));
   if(now >= ts && g_todayStart != ts)
   {
      g_todayStart = ts; g_tradesToday = 0;
      g_dailyStartEquity = AccountEquity();
      g_peakEquity = g_dailyStartEquity;
      g_dailyPaused = false;   // the daily-loss pause ends with the day; a manual PAUSE and a prop lock do not
   }
}

bool IsNewBar()
{
   datetime t = iTime(_Symbol, InpTF, 0);
   if(t != g_lastBarTime) { g_lastBarTime = t; return true; }
   return false;
}

//+------------------------------------------------------------------+
int FindLock(int t) { for(int i = 0; i < ArraySize(g_locks); i++) if(g_locks[i].ticket == t) return i; return -1; }
int AddLock(int t) { int s = ArraySize(g_locks); ArrayResize(g_locks, s + 1); g_locks[s].ticket = t; g_locks[s].peakProfit = 0; g_locks[s].active = false; g_locks[s].isBE = false; return s; }
void RemoveLock(int idx) { int s = ArraySize(g_locks); if(idx < 0 || idx >= s) return; for(int i = idx; i < s - 1; i++) g_locks[i] = g_locks[i + 1]; ArrayResize(g_locks, s - 1); }
//+------------------------------------------------------------------+
