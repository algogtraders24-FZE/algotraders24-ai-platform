//+------------------------------------------------------------------+
//|                                    AT24_GOLD_Breakout_v1.03.mq5   |
//|                        Copyright algotraders24.ai                  |
//|     XAUUSD / GOLD breakout MT5 - Nova / Zenith / Eclipse (v1.03)    |
//+------------------------------------------------------------------+
// v1.03 = Gold v1.02 with the review fixes (see CHANGELOG-v1.03.md next to this file):
//   1  HistorySelect() added: dashboard stats and the max-trades-per-day limit now actually work
//   2  Profit factor computed from gross profit / gross loss (was net profit / number of losses)
//   3  One order per module and side (old orders replaced each bar), one trade per module, and a cap on open positions
//   4  Prop-firm mode measured from the START balance (was today's start equity); locks stay locked; daily-loss is independent
//   5  Distances use the effective point (100 points = $1.00 on 2-digit AND 3-digit gold) - kept from v1.02, now also used for the spread shield and log
//   6  Lots normalised to the broker's min/max/step and checked against free margin
//   7  Eclipse reads the most recent fractal (v1.02 only looked at one bar, so it rarely traded)
//   8  AT24 licence guard (activate + daily re-validation); tester carve-out; existing positions are still managed
//   9  CTrade fill type from the symbol, trade stats cached (no full-history scan every second), stale locks cleaned
// IMPORTANT: behaviour changed (3, 7), so any backtest evidence from v1.02 does NOT describe this version.
#property copyright "Copyright algotraders24.ai - All Rights Reserved"
#property version   "1.03"
#property description "AT24 Gold Breakout MT5 (XAUUSD, 2/3-digit brokers) - Nova + Zenith + Eclipse"
#property description "Requires an AT24 licence. Not a promise of results: trading involves risk of loss."

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

#define PRODUCT_NAME           "AT24 Gold Breakout"
// Fixed product identity of this build. MUST equal the TradingSystem / Version registered for the listing this file is sold under.
#define AT24_TRADING_SYSTEM_ID "GOLD-BREAKOUT"
#define AT24_VERSION_ID        "GOLD-BREAKOUT-v1.03"
#define AT24_PLATFORM          "MT5"

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
input int    InpSizingMode           = 0;       // 0 = fixed lot, 1 = risk %
input double InpFixedLot             = 0.01;
input double InpRiskPercent          = 2.0;
input double InpMaxLot               = 0.0;     // 0 = no extra cap
input bool   InpAutoLotGrowth        = false;
input double InpAutoLotBaseBalance   = 1000.0;
input double InpAutoLotBalanceStep   = 500.0;
input double InpAutoLotStepSize      = 0.01;

input group "=== TRADE MANAGEMENT (100 points = $1.00) ==="
input bool   InpMoonLockEnabled      = true;
input double InpMoonLockStart        = 1.0;     // account currency
input double InpMoonLockPercent      = 50.0;
input double InpStopLossPoints       = 500.0;   // $5.00 SL
input double InpTakeProfitPoints     = 1500.0;  // $15.00 TP
input bool   InpAutoBreakeven        = true;
input double InpBE_TriggerPoints     = 200.0;   // $2.00 trigger
input double InpBE_LockPoints        = 50.0;    // $0.50 lock
input bool   InpTimeStopEnabled      = true;
input int    InpTimeStopMinutes      = 60;
input bool   InpSmartTrailing        = true;
input double InpTrailStartPoints     = 300.0;   // $3.00 trail start
input double InpTrailStepPoints      = 100.0;   // $1.00 trail step

input group "=== MODULES (NOVA / ZENITH / ECLIPSE) ==="
input bool   InpEnableNova           = true;
input bool   InpEnableZenith         = true;
input bool   InpEnableEclipse        = true;
input bool   InpOneTradePerModule    = true;    // a module places no new order while its own trade is open
input int    InpMaxOpenPositions     = 3;       // cap on open positions for this symbol + magic

input group "=== MTF TREND ==="
input bool   InpUseMTFTrend          = true;
input ENUM_TIMEFRAMES InpMTF_Timeframe = PERIOD_H1;
input int    InpFastEMA              = 50;
input int    InpSlowEMA              = 200;

input group "=== SHIELDS ==="
input bool   InpWeekendShield        = true;
input int    InpFridayPauseHour      = 20;
input int    InpMondayResumeHour     = 5;
input bool   InpSpreadShieldEnabled  = true;
input int    InpMaxSpreadPoints      = 50;      // in the same effective points as the distances above ($0.50)

input group "=== PROP FIRM ==="
input bool   InpPropFirmMode         = false;
input double InpPropStartBalance     = 0.0;     // 0 = the balance when this EA first started on this account (remembered)
input double InpPropFirmMaxDrawdown  = 10.0;    // % of the start balance (static)
input double InpPropFirmProfitTarget = 8.0;     // % of the start balance
input bool   InpDailyLossLimitEnabled= false;
input double InpMaxDailyLossPercent  = 5.0;     // % of today's starting equity

input group "=== GENERAL ==="
input ENUM_TIMEFRAMES InpTF          = PERIOD_M15;
input int    InpMagicNumber          = 55501;
input int    InpMaxTradesPerDay      = 5;
input double InpBreakoutBufferPoints = 30.0;   // $0.30 buffer
input bool   InpShowDashboard        = true;

input group "=== AT24 LICENSE ==="
input string InpLicenseKey           = "";      // EASIEST: paste ONE key here (AT24-...). If you use it, leave the 4 rows below empty
input string InpLicenseId            = "";      // (alternative) AT24 License ID
input string InpApiKey               = "";      // (alternative) AT24 API Key
input string InpBuyerId              = "";      // (alternative) AT24 Buyer ID
input string InpReleaseId            = "";      // (alternative) AT24 Release ID
input string InpApiBaseUrl           = "https://www.algotraders24.ai";
input int    InpLicenseRecheckHours  = 24;

//--- GLOBALS
int      handle_atr = INVALID_HANDLE, handle_fractals = INVALID_HANDLE;
int      handle_ema_fast = INVALID_HANDLE, handle_ema_slow = INVALID_HANDLE;
datetime g_lastBarTime = 0;
int      g_tradesToday = 0;
datetime g_todayStart = 0;
double   g_dailyStartEquity = 0.0;
double   g_peakEquity = 0.0;
double   g_propStart = 0.0;
bool     g_isPaused = false;      // manual (PAUSE button) - stays until you press RESUME
bool     g_dailyPaused = false;   // daily-loss limit - resets on the next trading day
bool     g_propLocked = false;    // prop target / max drawdown reached - stays until the EA is re-attached
bool     g_statsDirty = true;
double   g_totalProfit = 0, g_grossProfit = 0, g_grossLoss = 0;
int      g_totalWins = 0;
int      g_totalLosses = 0;

struct LastDeal { datetime t; double profit; bool isBuyPosition; };
LastDeal g_last[5];
int      g_lastCount = 0;

struct MoonLockData { ulong ticket; double peakProfit; bool active; bool isBE; };
MoonLockData g_locks[];
string g_prefix = "XAU_";

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
   string login  = IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   string server = AccountInfoString(ACCOUNT_SERVER);
   string common = TerminalInfoString(TERMINAL_COMMONDATA_PATH);
   return "{\"accountLogin\":\"" + AT24_JsonEscape(login) + "\",\"brokerServer\":\"" + AT24_JsonEscape(server) +
          "\",\"terminalCommonDataGuid\":\"" + AT24_JsonEscape(common) + "\"}";
}

string AT24_PostJson(const string path, const string bodyJson)
{
   string url = InpApiBaseUrl + path;
   string headers = "Content-Type: application/json\r\n";
   uchar postData[];
   int n = StringToCharArray(bodyJson, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(n > 0 && postData[n - 1] == 0) ArrayResize(postData, n - 1);
   else if(n != ArraySize(postData)) ArrayResize(postData, n);

   uchar result[];
   string resultHeaders;
   ResetLastError();
   int status = WebRequest("POST", url, headers, 8000, postData, result, resultHeaders);
   if(status == -1)
   {
      int err = GetLastError();
      Print("AT24 License: WebRequest to ", url, " failed, error ", err,
            ". Add '", InpApiBaseUrl, "' to MT5 -> Tools -> Options -> Expert Advisors -> 'Allow WebRequest for listed URL'.");
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
   string deviceLabel = AT24_JsonEscape(AccountInfoString(ACCOUNT_SERVER) + " #" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)));
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
   string body = "{\"key\":\"" + AT24_JsonEscape(k) + "\",\"account\":\"" + AT24_JsonEscape(IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN))) +
                 "\",\"server\":\"" + AT24_JsonEscape(AccountInfoString(ACCOUNT_SERVER)) + "\",\"requireAccount\":true}";
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
      if(g_AT24_Licensed) Print("AT24 License: re-validation FAILED (", AT24_JsonExtractString(resp, "reason"), ") - no new trades will open. Existing positions are still managed.");
      g_AT24_Licensed = false;
   }
}

//+------------------------------------------------------------------+
//| Effective point: 100 "points" = $1.00 on 2-digit and 3-digit    |
//| gold alike (3- and 5-digit symbols have a raw point 10x finer).  |
//+------------------------------------------------------------------+
double g_effPoint = 0.0;

double EffPoint()
{
   if(g_effPoint > 0) return g_effPoint;
   double rawPoint = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   g_effPoint = (digits == 3 || digits == 5) ? rawPoint * 10.0 : rawPoint;
   return g_effPoint;
}

// Spread expressed in effective points (the terminal reports raw points).
int EffSpread()
{
   double rawPoint = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int spreadRaw = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   return (int)MathRound(spreadRaw * rawPoint / EffPoint());
}

double PU(const double v)
{
   return v * EffPoint();
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(MQLInfoInteger(MQL_TESTER))
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

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(_Symbol);

   handle_atr = iATR(_Symbol, InpTF, 14);
   handle_fractals = iFractals(_Symbol, InpTF);
   if(handle_atr == INVALID_HANDLE || handle_fractals == INVALID_HANDLE) { Print("Indicator handle failed: ", GetLastError()); return INIT_FAILED; }

   if(InpUseMTFTrend)
   {
      handle_ema_fast = iMA(_Symbol, InpMTF_Timeframe, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);
      handle_ema_slow = iMA(_Symbol, InpMTF_Timeframe, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
      if(handle_ema_fast == INVALID_HANDLE || handle_ema_slow == INVALID_HANDLE) { Print("EMA handle failed: ", GetLastError()); return INIT_FAILED; }
   }

   g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
   g_peakEquity = g_dailyStartEquity;

   // Prop-firm start balance: the input, else the balance at the first start on this account (remembered across restarts).
   string gv = g_prefix + "StartBal_" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   if(InpPropStartBalance > 0) g_propStart = InpPropStartBalance;
   else if(GlobalVariableCheck(gv)) g_propStart = GlobalVariableGet(gv);
   else { g_propStart = AccountInfoDouble(ACCOUNT_BALANCE); GlobalVariableSet(gv, g_propStart); }

   // Show what the distances really are on this symbol, so a wrong digits assumption is obvious.
   g_effPoint = 0.0;
   double sl = PU(InpStopLossPoints), tp = PU(InpTakeProfitPoints);
   double spreadPrice = EffSpread() * EffPoint();
   Print(PRODUCT_NAME, " v1.03 on ", _Symbol, ": digits=", (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS), " effective point=", DoubleToString(EffPoint(), 5),
         " | SL=", DoubleToString(sl, _Digits), " TP=", DoubleToString(tp, _Digits), " (price units), spread now=", DoubleToString(spreadPrice, _Digits));
   if(sl < spreadPrice * 3.0) Print("WARNING: the stop loss is less than 3x the current spread. Check the distances for this symbol.");
   if(StringFind(_Symbol, "XAU") == -1 && StringFind(_Symbol, "GOLD") == -1) Print("WARNING: this EA is tuned for gold. Current symbol: ", _Symbol);

   EventSetTimer(1);
   UpdateStatistics();
   if(InpShowDashboard) DrawFinalDashboard();
   ChartRedraw(0);
   Print("Modules: Nova=", InpEnableNova, " Zenith=", InpEnableZenith, " Eclipse=", InpEnableEclipse, " | Copyright algotraders24.ai");
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectsDeleteAll(0, g_prefix);
   ChartRedraw(0);
   if(handle_atr != INVALID_HANDLE)      { IndicatorRelease(handle_atr);      handle_atr = INVALID_HANDLE; }
   if(handle_fractals != INVALID_HANDLE) { IndicatorRelease(handle_fractals); handle_fractals = INVALID_HANDLE; }
   if(handle_ema_fast != INVALID_HANDLE) { IndicatorRelease(handle_ema_fast); handle_ema_fast = INVALID_HANDLE; }
   if(handle_ema_slow != INVALID_HANDLE) { IndicatorRelease(handle_ema_slow); handle_ema_slow = INVALID_HANDLE; }
   Print(PRODUCT_NAME, " deinitialised");
}

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.type == TRADE_TRANSACTION_DEAL_ADD) g_statsDirty = true;
}

//+------------------------------------------------------------------+
void OnTimer()
{
   if(g_statsDirty) { UpdateStatistics(); g_statsDirty = false; }
   if(InpShowDashboard) DrawFinalDashboard();
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void OnTick()
{
   CheckNewDay();
   if(!MQLInfoInteger(MQL_TESTER)) AT24_RevalidateIfDue();
   ManageTradeExits();   // open positions are always managed, even when new trading is blocked

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
         ChartRedraw(0);
      }
      if(sparam == g_prefix + "BtnClose")
      {
         CloseAllPositions();
         ObjectSetInteger(0, sparam, OBJPROP_STATE, false);
         ChartRedraw(0);
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
   SetLabel(g_prefix + "Sub", xLeft + 10, yTop + 22, "GOLD BREAKOUT v1.03 (" + _Symbol + ")", clrGoldColor, 9, "Arial");
   string st = !g_AT24_Licensed ? "NOT LICENSED" : (g_propLocked ? "PROP LOCK" : (g_dailyPaused ? "DAILY LIMIT" : (g_isPaused ? "PAUSED" : "ACTIVE")));
   SetLabel(g_prefix + "Status", xLeft + 10, yTop + 38, st, (paused || !g_AT24_Licensed) ? clrTextRed : clrTextGreen, 10, "Arial Bold");

   int yStats = yTop + 70;
   CreateRect(g_prefix + "StatsBG", xLeft, yStats, wLeft, 85, clrBG, clrGrayBox);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double dailyPL = equity - g_dailyStartEquity;
   double dailyPLPercent = (g_dailyStartEquity > 0) ? (dailyPL / g_dailyStartEquity * 100) : 0;
   double dd = g_peakEquity > 0 ? ((g_peakEquity - equity) / g_peakEquity * 100) : 0;
   int spread_int = EffSpread();

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
   SetLabel(g_prefix + "Footer", xLeft + 10, yButtons + 32, "algotraders24.ai | Gold Breakout v1.03", clrGoldColor, 7, "Arial");

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
         string side = g_last[n].isBuyPosition ? "B" : "S";
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

//+------------------------------------------------------------------+
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
//| Statistics from the deal history (FIX 1: HistorySelect first).   |
//| Called only when a deal was added, not every second.             |
//+------------------------------------------------------------------+
void UpdateStatistics()
{
   g_totalWins = 0; g_totalLosses = 0; g_totalProfit = 0; g_grossProfit = 0; g_grossLoss = 0; g_lastCount = 0;
   if(!HistorySelect(0, TimeCurrent() + 60)) return;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;
      if(HistoryDealGetInteger(ticket, DEAL_MAGIC) != (long)InpMagicNumber) continue;
      if(HistoryDealGetString(ticket, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(ticket, DEAL_ENTRY) != DEAL_ENTRY_OUT) continue;
      double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT) + HistoryDealGetDouble(ticket, DEAL_SWAP) + HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      g_totalProfit += profit;
      if(profit > 0) { g_totalWins++; g_grossProfit += profit; }
      else if(profit < 0) { g_totalLosses++; g_grossLoss += -profit; }
      if(g_lastCount < 5)
      {
         g_last[g_lastCount].t = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
         g_last[g_lastCount].profit = profit;
         // The closing deal is the opposite side of the position it closes.
         g_last[g_lastCount].isBuyPosition = (HistoryDealGetInteger(ticket, DEAL_TYPE) == DEAL_TYPE_SELL);
         g_lastCount++;
      }
   }
}

//+------------------------------------------------------------------+
void CleanLocks()
{
   for(int i = ArraySize(g_locks) - 1; i >= 0; i--)
      if(!PositionSelectByTicket(g_locks[i].ticket)) RemoveLock(i);
}

//+------------------------------------------------------------------+
bool StopsOk(ENUM_POSITION_TYPE type, double newSL, double price)
{
   double minDist = (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   if(type == POSITION_TYPE_BUY) return (price - newSL) >= minDist;
   return (newSL - price) >= minDist;
}

//+------------------------------------------------------------------+
void ManageTradeExits()
{
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   CleanLocks();

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
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
      bool isBuy = (posInfo.PositionType() == POSITION_TYPE_BUY);

      // TIME STOP
      if(InpTimeStopEnabled)
      {
         int minutesOpen = (int)((TimeCurrent() - posInfo.Time()) / 60);
         if(minutesOpen >= InpTimeStopMinutes && profit < 0)
         {
            if(!trade.PositionClose(ticket)) Print("PositionClose (time stop) failed: ", ticket);
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
               if(newSL > currentSL && StopsOk(POSITION_TYPE_BUY, newSL, currentPrice))
                  if(trade.PositionModify(ticket, newSL, currentTP)) { g_locks[idx].isBE = true; currentSL = newSL; }
            }
         }
         else
         {
            if((openPrice - currentPrice) >= triggerDist)
            {
               double newSL = NormalizeDouble(openPrice - lockDist, digits);
               if((newSL < currentSL || currentSL == 0) && StopsOk(POSITION_TYPE_SELL, newSL, currentPrice))
                  if(trade.PositionModify(ticket, newSL, currentTP)) { g_locks[idx].isBE = true; currentSL = newSL; }
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
               if(newSL > currentSL + minGain && StopsOk(POSITION_TYPE_BUY, newSL, currentPrice)) trade.PositionModify(ticket, newSL, currentTP);
            }
         }
         else
         {
            if((openPrice - currentPrice) >= trailStartDist)
            {
               double newSL = NormalizeDouble(currentPrice + trailStepDist, digits);
               if((currentSL == 0 || newSL < currentSL - minGain) && StopsOk(POSITION_TYPE_SELL, newSL, currentPrice)) trade.PositionModify(ticket, newSL, currentTP);
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
            if(!trade.PositionClose(ticket)) Print("PositionClose (MoonLock) failed: ", ticket);
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
   double eq = AccountInfoDouble(ACCOUNT_EQUITY);
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
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber)
         if(!trade.PositionClose(posInfo.Ticket())) Print("PositionClose failed: ", posInfo.Ticket());
}

//+------------------------------------------------------------------+
bool IsTrendUp()
{
   if(!InpUseMTFTrend) return true;
   double fast = GetInd(handle_ema_fast, 0, 1);
   double slow = GetInd(handle_ema_slow, 0, 1);
   return (fast > slow && fast > 0 && slow > 0);
}

bool IsTrendDown()
{
   if(!InpUseMTFTrend) return true;
   double fast = GetInd(handle_ema_fast, 0, 1);
   double slow = GetInd(handle_ema_slow, 0, 1);
   return (fast < slow && fast > 0 && slow > 0);
}

//+------------------------------------------------------------------+
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
   return (EffSpread() > InpMaxSpreadPoints);
}

//+------------------------------------------------------------------+
int CountOpenPositions()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber) c++;
   return c;
}

// An open position of this module (the order comment is carried onto the position: "Nova_Buy" / "Nova_Sell").
bool HasOpenModulePosition(const string module)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
      if(posInfo.SelectByIndex(i) && posInfo.Symbol() == _Symbol && posInfo.Magic() == InpMagicNumber && StringFind(posInfo.Comment(), module) == 0) return true;
   return false;
}

void DeleteModulePending(const string module)
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != (long)InpMagicNumber) continue;
      if(StringFind(OrderGetString(ORDER_COMMENT), module) != 0) continue;
      if(!trade.OrderDelete(t)) Print("OrderDelete failed: ", t);
   }
}

//+------------------------------------------------------------------+
// FIX 7: the most recent real fractal. The built-in indicator leaves EMPTY_VALUE on bars with no fractal, so v1.02 (which read
// a single bar) usually saw nothing - or a huge number.
double LastFractal(const int buffer, const int lookback = 60)
{
   if(handle_fractals == INVALID_HANDLE) return 0;
   double buf[]; ArraySetAsSeries(buf, true);
   int n = CopyBuffer(handle_fractals, buffer, 0, lookback, buf);
   for(int i = 2; i < n; i++)
      if(buf[i] != EMPTY_VALUE && buf[i] > 0 && buf[i] < 1.0e100) return buf[i];
   return 0;
}

//+------------------------------------------------------------------+
void PlaceModule(const string module, const double hi, const double lo, const bool trendUp, const bool trendDown,
                 const double slDist, const double tpDist, const double buffer, const int digits, const double minDist, const double lot)
{
   if(InpOneTradePerModule && HasOpenModulePosition(module)) return;
   DeleteModulePending(module);   // replace last bar's order instead of stacking a new one next to it
   if(hi > 0 && trendUp)   PlacePending(ORDER_TYPE_BUY_STOP,  hi + buffer, slDist, tpDist, module + "_Buy",  digits, minDist, lot);
   if(lo > 0 && trendDown) PlacePending(ORDER_TYPE_SELL_STOP, lo - buffer, slDist, tpDist, module + "_Sell", digits, minDist, lot);
}

void PlaceBreakoutOrders()
{
   if(CountOpenPositions() >= InpMaxOpenPositions) return;
   g_tradesToday = CountTodayTrades();
   if(g_tradesToday >= InpMaxTradesPerDay) return;

   int digits = (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS);
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   int stopLevel = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDist = stopLevel * point + 10 * EffPoint();
   double slDist = PU(InpStopLossPoints);
   double tpDist = PU(InpTakeProfitPoints);
   double buffer = PU(InpBreakoutBufferPoints);

   double atr_val = GetInd(handle_atr, 0, 1);
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
      int ih = iHighest(_Symbol, InpTF, MODE_HIGH, 20, 1), il = iLowest(_Symbol, InpTF, MODE_LOW, 20, 1);
      double h = (ih >= 0) ? iHigh(_Symbol, InpTF, ih) : 0, l = (il >= 0) ? iLow(_Symbol, InpTF, il) : 0;
      PlaceModule("Zenith", h, l, trendUp, trendDown, slDist, tpDist, buffer, digits, minDist, lot);
   }
   if(InpEnableEclipse)
   {
      PlaceModule("Eclipse", LastFractal(0), LastFractal(1), trendUp, trendDown, slDist, tpDist, buffer, digits, minDist, lot);
   }
}

//+------------------------------------------------------------------+
void PlacePending(ENUM_ORDER_TYPE type, double price, double slDist, double tpDist, string comment, int digits, double minDist, double lot)
{
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(type == ORDER_TYPE_BUY_STOP && price <= ask + minDist) return;
   if(type == ORDER_TYPE_SELL_STOP && price >= bid - minDist) return;

   // FIX 6: never send an order the account cannot carry.
   double margin = 0;
   ENUM_ORDER_TYPE mt = (type == ORDER_TYPE_BUY_STOP) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(OrderCalcMargin(mt, _Symbol, lot, price, margin) && margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9)
   {
      Print("Skipped ", comment, ": needs margin ", DoubleToString(margin, 2), " but free margin is ", DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2));
      return;
   }

   price = NormalizeDouble(price, digits);
   double sl = (type == ORDER_TYPE_BUY_STOP) ? NormalizeDouble(price - slDist, digits) : NormalizeDouble(price + slDist, digits);
   double tp = (type == ORDER_TYPE_BUY_STOP) ? NormalizeDouble(price + tpDist, digits) : NormalizeDouble(price - tpDist, digits);

   if(type == ORDER_TYPE_BUY_STOP)
   {
      if(!trade.BuyStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment)) Print("BuyStop failed: ", comment, " err:", GetLastError());
   }
   else
   {
      if(!trade.SellStop(lot, price, _Symbol, sl, tp, ORDER_TIME_GTC, 0, comment)) Print("SellStop failed: ", comment, " err:", GetLastError());
   }
}

//+------------------------------------------------------------------+
double NormalizeLot(double lot)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxL = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
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
      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double risk_amount = balance * (InpRiskPercent / 100.0);
      double sl_distance_price = PU(InpStopLossPoints);
      double tick_value = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tick_size = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      if(tick_size == 0 || tick_value == 0 || sl_distance_price <= 0) return NormalizeLot(InpFixedLot);
      double lot = risk_amount / ((sl_distance_price / tick_size) * tick_value);
      return NormalizeLot(lot);
   }
   double base_lot = InpFixedLot;
   if(InpAutoLotGrowth)
   {
      double growth_amount = AccountInfoDouble(ACCOUNT_BALANCE) - InpAutoLotBaseBalance;
      if(growth_amount > 0 && InpAutoLotBalanceStep > 0)
      {
         int steps = (int)MathFloor(growth_amount / InpAutoLotBalanceStep);
         base_lot += (steps * InpAutoLotStepSize);
      }
   }
   return NormalizeLot(base_lot);
}

//+------------------------------------------------------------------+
double GetInd(int handle, int buffer, int shift)
{
   if(handle == INVALID_HANDLE) return 0;
   double buf[]; ArraySetAsSeries(buf, true);
   return (CopyBuffer(handle, buffer, shift, 1, buf) > 0) ? buf[0] : 0;
}

//+------------------------------------------------------------------+
void DeleteStalePendingOrders()
{
   datetime now = TimeCurrent();
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && OrderGetInteger(ORDER_MAGIC) == (long)InpMagicNumber)
         if(now - (datetime)OrderGetInteger(ORDER_TIME_SETUP) > 1800)
            if(!trade.OrderDelete(t)) Print("OrderDelete failed: ", t);
   }
}

void DeleteAllPendingOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t > 0 && OrderGetString(ORDER_SYMBOL) == _Symbol && OrderGetInteger(ORDER_MAGIC) == (long)InpMagicNumber)
         if(!trade.OrderDelete(t)) Print("OrderDelete failed: ", t);
   }
}

//+------------------------------------------------------------------+
// FIX 1: HistorySelect for today only, then count entry deals.
int CountTodayTrades()
{
   if(!HistorySelect(g_todayStart, TimeCurrent() + 60)) return 0;
   int c = 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
   {
      ulong t = HistoryDealGetTicket(i);
      if(t == 0) continue;
      if(HistoryDealGetInteger(t, DEAL_MAGIC) == (long)InpMagicNumber && HistoryDealGetString(t, DEAL_SYMBOL) == _Symbol &&
         HistoryDealGetInteger(t, DEAL_ENTRY) == DEAL_ENTRY_IN) c++;
   }
   return c;
}

//+------------------------------------------------------------------+
void CheckNewDay()
{
   MqlDateTime dt; TimeCurrent(dt);
   datetime ts = StringToTime(StringFormat("%04d.%02d.%02d 00:00:00", dt.year, dt.mon, dt.day));
   if(TimeCurrent() >= ts && g_todayStart != ts)
   {
      g_todayStart = ts; g_tradesToday = 0;
      g_dailyStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
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
int FindLock(ulong t) { for(int i = 0; i < ArraySize(g_locks); i++) if(g_locks[i].ticket == t) return i; return -1; }
int AddLock(ulong t) { int s = ArraySize(g_locks); ArrayResize(g_locks, s + 1); g_locks[s].ticket = t; g_locks[s].peakProfit = 0; g_locks[s].active = false; g_locks[s].isBE = false; return s; }
void RemoveLock(int idx) { int s = ArraySize(g_locks); if(idx < 0 || idx >= s) return; for(int i = idx; i < s - 1; i++) g_locks[i] = g_locks[i + 1]; ArrayResize(g_locks, s - 1); }
//+------------------------------------------------------------------+
