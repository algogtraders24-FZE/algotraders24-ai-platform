//+------------------------------------------------------------------+
//|                                                    GoldFire_v5.mq5 |
//|                        Copyright 2026, AlgoTraders24             |
//|                        https://www.algotraders24.ai              |
//+------------------------------------------------------------------+
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "5.00"
#property description "Gold Fire v5 - Next-Gen 3D Dashboard, Advanced Risk & Breakout Logic"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\SymbolInfo.mqh>

CTrade trade;
CSymbolInfo sym;

// This build's fixed AT24 product identity - matches the exact
// tradingSystemId/versionId this compiled binary's own backtest Evidence
// was verified against (marketplace_evidence_records row for GOLDFIRE /
// GOLDFIRE-v5.00-2025-BASELINE). NOT a buyer-entered value - a real
// license can only ever authorize the version it was actually issued
// against (see licenseCore.ts validateRuntime's WRONG_PRODUCT/
// WRONG_VERSION checks), so hardcoding it here (rather than trusting an
// input the buyer could accidentally mistype) is the safer choice.
#define AT24_TRADING_SYSTEM_ID "GOLDFIRE"
#define AT24_VERSION_ID        "GOLDFIRE-v5.00-2025-BASELINE"
#define AT24_PLATFORM          "MT5"

//--- Enums
enum ENUM_LOT_MODE    { LOT_FIXED = 0, LOT_RISK_PERCENT = 1 };
enum ENUM_SLTP_MODE   { MODE_POINTS = 0, MODE_ATR = 1, MODE_DOLLARS = 2 };
enum ENUM_TRAIL_MODE  { TRAIL_POINTS = 0, TRAIL_ATR = 1 };

//+------------------------------------------------------------------+
//| 1. GENERAL & BACKTEST SETTINGS                                   |
//+------------------------------------------------------------------+
input group "=== 1. GENERAL & BACKTEST ==="
input bool                 InpBacktestMode = false;                // Enable Backtest Mode (Disables heavy dashboard)
input bool                 InpShowDashboard = true;                // Show New-Gen 3D Dashboard
input bool                 InpShowLogo = true;                     // Show 200x200 Logo Area

//+------------------------------------------------------------------+
//| 2. STRATEGY & FILTERS                                            |
//+------------------------------------------------------------------+
input group "=== 2. STRATEGY & FILTERS ==="
input ENUM_TIMEFRAMES      InpBreakoutTF = PERIOD_M15;             // Breakout Timeframe
input bool                 InpUseTrendFilter = true;               // Enable EMA Trend Filter
input int                  InpEMAPeriod = 50;                      // EMA Period
input bool                 InpUseSessionFilter = true;             // Enable Session Filter
input int                  InpSessionStartHour = 8;                // Session Start Hour (Broker Time)
input int                  InpSessionEndHour = 20;                 // Session End Hour (Broker Time)

//+------------------------------------------------------------------+
//| 3. ENTRY LOGIC                                                   |
//+------------------------------------------------------------------+
input group "=== 3. ENTRY LOGIC ==="
input int                  InpLookbackCandles = 10;                // Lookback Candles
input int                  InpOffsetPoints = 20;                   // Offset from High/Low (Points)
input double               InpEntryRandomizer = 2.0;               // Randomizer (+/- Points)
input int                  InpPauseBetweenPositions = 300;         // Pause After Trade (Seconds)
input int                  InpMaxHoldTimeSeconds = 300;            // Max Trade Hold Time (Seconds)

//+------------------------------------------------------------------+
//| 4. RISK & LOT SETTINGS                                           |
//+------------------------------------------------------------------+
input group "=== 4. RISK & LOT SETTINGS ==="
input ENUM_LOT_MODE        InpLotMode = LOT_FIXED;                 // Lot Calculation Mode
input double               InpFixedLot = 0.01;                     // Fixed Lot Size
input double               InpRiskPercent = 1.0;                   // Risk % per Trade

//+------------------------------------------------------------------+
//| 5. SL / TP SETTINGS (Multi-Mode)                                 |
//+------------------------------------------------------------------+
input group "=== 5. SL / TP SETTINGS ==="
input ENUM_SLTP_MODE       InpSLTPMode = MODE_POINTS;              // SL/TP Calculation Mode
input double               InpSL_Points = 150;                     // SL (Points)
input double               InpTP_Points = 250;                     // TP (Points)
input double               InpSL_ATR_Mult = 1.5;                   // SL (ATR Multiplier)
input double               InpTP_ATR_Mult = 2.5;                   // TP (ATR Multiplier)
input int                  InpATR_Period = 14;                     // ATR Period
input double               InpSL_Dollars = 1.50;                   // SL (Dollar Distance)
input double               InpTP_Dollars = 2.50;                   // TP (Dollar Distance)

//+------------------------------------------------------------------+
//| 6. TRAILING STOP & BREAK EVEN                                    |
//+------------------------------------------------------------------+
input group "=== 6. TRAILING & BREAK EVEN ==="
input bool                 InpUseBreakEven = true;                 // Enable Break Even
input int                  InpBE_TriggerPoints = 50;               // BE Trigger (Points)
input int                  InpBE_ProfitPoints = 20;                // BE Profit Lock (Points)
input bool                 InpUseTrailing = true;                  // Enable Trailing Stop
input ENUM_TRAIL_MODE      InpTrailMode = TRAIL_POINTS;            // Trailing Mode
input double               InpTrailStart_Points = 100;             // Trailing Start (Points)
input double               InpTrailStep_Points = 50;               // Trailing Step (Points)
input double               InpTrailStart_ATR = 1.0;                // Trailing Start (ATR Mult)
input double               InpTrailStep_ATR = 0.5;                 // Trailing Step (ATR Mult)

//+------------------------------------------------------------------+
//| 7. PROTECTIONS & SETTINGS                                        |
//+------------------------------------------------------------------+
input group "=== 7. PROTECTIONS & SETTINGS ==="
input bool                 InpHideInitialSL = false;               // Hide Initial SL on Pending
input int                  InpMaxSpread = 30;                      // Max Spread (Points)
input bool                 InpFridayCloseProtection = true;        // Friday Close Protection
input int                  InpFridayCloseHour = 18;                // Friday Close Hour
input int                  InpFridayCloseMinute = 15;              // Friday Close Minute
input int                  InpDailyCloseHour = 21;                 // Daily Close Hour
input int                  InpDailyCloseMinute = 15;               // Daily Close Minute
input long                 InpMagicNumber = 777999;                // Magic Number
input string               InpTradeComment = "GoldFire_v5";        // Trade Comment

//+------------------------------------------------------------------+
//| 8. AT24 LICENSE                                                  |
//+------------------------------------------------------------------+
input group "=== 8. AT24 LICENSE ==="
input string                InpLicenseId          = "";            // AT24 License ID (from My Purchases)
input string                InpApiKey              = "";            // AT24 API Key (from My Purchases)
input string                InpBuyerId             = "";            // AT24 Buyer ID (from My Purchases)
input string                InpReleaseId           = "";            // AT24 Release ID (from My Purchases)
input string                InpApiBaseUrl          = "https://www.algotraders24.ai"; // AT24 API base URL
input int                   InpLicenseRecheckHours = 24;            // Re-validate license every N hours while running

//--- Global Variables
datetime lastBarTime = 0;
datetime lastTradeTime = 0;
int handleEMA, handleATR;
double dailyStartBalance = 0;
int lastDay = 0;

//+------------------------------------------------------------------+
//| AT24 LICENSE GUARD (M11 runtime licensing)                       |
//| Real POSTs to the real /api/license/activate + /validate         |
//| endpoints - not a cosmetic check, this genuinely refuses to      |
//| trade without a valid activation, and stops opening new trades   |
//| if a later re-validation fails (e.g. the license was revoked).   |
//|                                                                    |
//| REQUIRED ONE-TIME SETUP (cannot be done from code - a real MT5   |
//| terminal restriction): MT5 -> Tools -> Options -> Expert Advisors|
//| -> check "Allow WebRequest for listed URL:" -> add InpApiBaseUrl |
//| exactly. Without this, WebRequest always fails (error 4060) and  |
//| this EA will never activate.                                     |
//+------------------------------------------------------------------+
bool     g_AT24_Licensed  = false;
datetime g_AT24_LastCheck = 0;

string AT24_JsonEscape(const string s)
{
   string out = s;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   return out;
}

// Finds "key":"value" (a flat string field) inside a JSON blob; "" if absent.
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
   // MT5 adapter (adapters.ts): accountLogin + brokerServer + a stable
   // per-install identifier. MT5 has no direct "GUID" API, so the
   // terminal's own common-data path is used - it's install-specific
   // (not a bare machine ID) and stable across EA reloads, matching the
   // adapter's own documented binding-inputs description.
   string login  = IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   string server = AccountInfoString(ACCOUNT_SERVER);
   string common = TerminalInfoString(TERMINAL_COMMONDATA_PATH);
   return "{\"accountLogin\":\"" + AT24_JsonEscape(login) + "\",\"brokerServer\":\"" + AT24_JsonEscape(server) +
          "\",\"terminalCommonDataGuid\":\"" + AT24_JsonEscape(common) + "\"}";
}

// Real POST to the AT24 API. Returns the raw JSON response body, or ""
// on a transport-level failure (network/WebRequest error - already
// logged before returning; NOT the same as a valid {"status":"error"}
// application response, which is returned as-is for the caller to read).
string AT24_PostJson(const string path, const string bodyJson)
{
   string url = InpApiBaseUrl + path;
   string headers = "Content-Type: application/json\r\n";
   uchar postData[];
   StringToCharArray(bodyJson, postData, 0, StringLen(bodyJson), CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1); // drop StringToCharArray's trailing null terminator

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

// Mandatory gate - called once from OnInit(). A missing/invalid license
// means this EA refuses to initialize at all: never trades unlicensed.
bool AT24_ActivateLicense()
{
   if(StringLen(InpLicenseId) == 0 || StringLen(InpApiKey) == 0)
   {
      Print("AT24 License: InpLicenseId / InpApiKey are empty. Get your real license from My Purchases in your AT24 dashboard after buying this product.");
      return false;
   }

   string deviceLabel = AT24_JsonEscape(AccountInfoString(ACCOUNT_SERVER) + " #" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN)));
   string body = "{\"licenseId\":\"" + AT24_JsonEscape(InpLicenseId) + "\",\"apiKey\":\"" + AT24_JsonEscape(InpApiKey) +
                 "\",\"deviceInfo\":" + AT24_BuildDeviceInfoJson() + ",\"deviceLabel\":\"" + deviceLabel + "\"}";

   string resp = AT24_PostJson("/api/license/activate", body);
   if(StringLen(resp) == 0) return false; // transport failure, already logged

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

// Periodic re-check - called from OnTick() at most once every
// InpLicenseRecheckHours. On failure this blocks NEW trades only
// (g_AT24_Licensed=false); it does NOT force-close already-open
// positions - a remotely-triggerable close-all is itself a risk surface
// this EA should not expose.
void AT24_RevalidateIfDue()
{
   if(InpLicenseRecheckHours <= 0) return;
   if(TimeCurrent() - g_AT24_LastCheck < InpLicenseRecheckHours * 3600) return;

   if(StringLen(InpBuyerId) == 0 || StringLen(InpReleaseId) == 0)
   {
      // /validate needs these too (unlike /activate) - if they were never
      // filled in, skip silently rather than spamming Print every tick-
      // interval; the mandatory OnInit() activation already gated trading.
      g_AT24_LastCheck = TimeCurrent();
      return;
   }

   string body = "{\"licenseId\":\"" + AT24_JsonEscape(InpLicenseId) + "\",\"apiKey\":\"" + AT24_JsonEscape(InpApiKey) +
                 "\",\"buyerId\":\"" + AT24_JsonEscape(InpBuyerId) + "\",\"tradingSystemId\":\"" + AT24_TRADING_SYSTEM_ID +
                 "\",\"versionId\":\"" + AT24_VERSION_ID + "\",\"releaseId\":\"" + AT24_JsonEscape(InpReleaseId) +
                 "\",\"platform\":\"" + AT24_PLATFORM + "\",\"deviceInfo\":" + AT24_BuildDeviceInfoJson() + "}";

   string resp = AT24_PostJson("/api/license/validate", body);
   g_AT24_LastCheck = TimeCurrent();
   if(StringLen(resp) == 0) return; // transport failure - keep last known state rather than flip-flopping on a blip

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
int OnInit()
{
   // AT24 License Guard - mandatory. Refuses to initialize at all without
   // a valid activation (see this file's own AT24 LICENSE GUARD section).
   // Carve-out: MQL5's Strategy Tester either blocks WebRequest outright or
   // would otherwise hit the real production API on every single backtest/
   // optimization run - neither is wanted for AT24's own re-verification
   // testing, so tester runs are treated as licensed without a network
   // call. This never applies to a live/demo account (MQL_TESTER is only
   // ever true inside the Strategy Tester itself).
   if(MQLInfoInteger(MQL_TESTER))
   {
      g_AT24_Licensed = true;
      Print("Gold Fire v5: running inside Strategy Tester - AT24 License Guard skipped (no network calls in tester).");
   }
   else
   {
      g_AT24_Licensed = AT24_ActivateLicense();
      if(!g_AT24_Licensed)
      {
         Print("Gold Fire v5: NOT licensed - EA will not trade. Fill in InpLicenseId/InpApiKey from your AT24 My Purchases page.");
         return INIT_FAILED;
      }
   }

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(10);
   trade.SetTypeFilling(ORDER_FILLING_IOC);
   sym.Name(_Symbol);
   sym.Refresh();

   handleEMA = iMA(_Symbol, InpBreakoutTF, InpEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
   handleATR = iATR(_Symbol, InpBreakoutTF, InpATR_Period);

   if(handleEMA == INVALID_HANDLE || handleATR == INVALID_HANDLE) {
      Print("Indicator Init Failed!"); return INIT_FAILED;
   }

   MqlDateTime dt; TimeCurrent(dt);
   dailyStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   lastDay = dt.day;

   if(!InpBacktestMode && InpShowDashboard) CreateDashboard();
   if(!InpBacktestMode && InpShowLogo) CreateLogo();

   Print("Gold Fire v5 Initialized | AlgoTraders24 | TF: ", EnumToString(InpBreakoutTF));
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   DeleteAllObjects();
   if(handleEMA != INVALID_HANDLE) IndicatorRelease(handleEMA);
   if(handleATR != INVALID_HANDLE) IndicatorRelease(handleATR);
}

//+------------------------------------------------------------------+
void OnTick()
{
   sym.Refresh();

   // Update Daily Balance
   MqlDateTime dt; TimeCurrent(dt);
   if(dt.day != lastDay) {
      dailyStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      lastDay = dt.day;
   }

   bool isNewBar = false;
   datetime currentBarTime = iTime(_Symbol, InpBreakoutTF, 0);
   if(currentBarTime != lastBarTime) { isNewBar = true; lastBarTime = currentBarTime; }

   // Light Checks
   if(InpFridayCloseProtection && IsFridayCloseTime()) { CloseAllPositions(); DeleteAllPendingOrders(); return; }
   if(IsDailyCloseTime()) { CloseAllPositions(); DeleteAllPendingOrders(); return; }
   if(!CheckSpread()) return;
   if(InpUseSessionFilter && !IsSessionTime()) return;

   // Manage Open Position
   if(HasOpenPosition()) {
      ManageOpenPosition();
      if(!InpBacktestMode && InpShowDashboard) UpdateDashboard();
      return;
   }

   // AT24 License Guard - periodic re-check (no-op inside Strategy Tester,
   // see OnInit()). A later revocation blocks new entries here; it does
   // not touch position management above.
   if(!MQLInfoInteger(MQL_TESTER)) AT24_RevalidateIfDue();

   // Heavy Logic (New Bar Only)
   if(isNewBar && g_AT24_Licensed) {
      if(TimeCurrent() - lastTradeTime >= InpPauseBetweenPositions) {
         if(!HasPendingOrder()) PlacePendingOrders();
      }
   }

   if(!InpBacktestMode && InpShowDashboard) UpdateDashboard();
}

//+------------------------------------------------------------------+
void PlacePendingOrders()
{
   int highestShift = iHighest(_Symbol, InpBreakoutTF, MODE_HIGH, InpLookbackCandles, 1);
   int lowestShift = iLowest(_Symbol, InpBreakoutTF, MODE_LOW, InpLookbackCandles, 1);

   double high = iHigh(_Symbol, InpBreakoutTF, highestShift);
   double low  = iLow(_Symbol, InpBreakoutTF, lowestShift);
   if(high == 0 || low == 0) return;

   double emaVal = 0, atrVal = 0;
   double emaBuf[], atrBuf[];
   if(InpUseTrendFilter && CopyBuffer(handleEMA, 0, 0, 1, emaBuf) > 0) emaVal = emaBuf[0];
   if(InpSLTPMode == MODE_ATR || InpTrailMode == TRAIL_ATR) {
      if(CopyBuffer(handleATR, 0, 0, 1, atrBuf) > 0) atrVal = atrBuf[0];
      else return;
   }

   double point = sym.Point();
   int digits = (int)sym.Digits();
   double currentPrice = sym.Ask();

   double slDist = 0, tpDist = 0;
   if(InpSLTPMode == MODE_POINTS) { slDist = InpSL_Points * point; tpDist = InpTP_Points * point; }
   else if(InpSLTPMode == MODE_ATR) { slDist = atrVal * InpSL_ATR_Mult; tpDist = atrVal * InpTP_ATR_Mult; }
   else if(InpSLTPMode == MODE_DOLLARS) { slDist = InpSL_Dollars; tpDist = InpTP_Dollars; }

   double slPoints = slDist / point;
   double lotSize = CalculateLotSize(slPoints);

   double offset = InpOffsetPoints * point;
   double randBuy = ((MathRand() % 1000) / 1000.0 * 2 - 1) * InpEntryRandomizer * point;
   double randSell = ((MathRand() % 1000) / 1000.0 * 2 - 1) * InpEntryRandomizer * point;

   double buyStopPrice = NormalizeDouble(high + offset + randBuy, digits);
   double sellStopPrice = NormalizeDouble(low - offset - randSell, digits);

   double slBuy = NormalizeDouble(buyStopPrice - slDist, digits);
   double tpBuy = NormalizeDouble(buyStopPrice + tpDist, digits);
   double slSell = NormalizeDouble(sellStopPrice + slDist, digits);
   double tpSell = NormalizeDouble(sellStopPrice - tpDist, digits);

   bool canBuy = !InpUseTrendFilter || (currentPrice > emaVal);
   bool canSell = !InpUseTrendFilter || (currentPrice < emaVal);

   if(canBuy) {
      if(InpHideInitialSL) trade.BuyStop(lotSize, buyStopPrice, _Symbol, 0, tpBuy, ORDER_TIME_GTC, 0, InpTradeComment);
      else trade.BuyStop(lotSize, buyStopPrice, _Symbol, slBuy, tpBuy, ORDER_TIME_GTC, 0, InpTradeComment);
   }
   if(canSell) {
      if(InpHideInitialSL) trade.SellStop(lotSize, sellStopPrice, _Symbol, 0, tpSell, ORDER_TIME_GTC, 0, InpTradeComment);
      else trade.SellStop(lotSize, sellStopPrice, _Symbol, slSell, tpSell, ORDER_TIME_GTC, 0, InpTradeComment);
   }

   lastTradeTime = TimeCurrent();
}

//+------------------------------------------------------------------+
void ManageOpenPosition()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0 || PositionGetInteger(POSITION_MAGIC) != InpMagicNumber || PositionGetString(POSITION_SYMBOL) != _Symbol) continue;

      datetime openTime = (datetime)PositionGetInteger(POSITION_TIME);
      int holdTime = (int)(TimeCurrent() - openTime);

      if(holdTime >= InpMaxHoldTimeSeconds) { trade.PositionClose(ticket); continue; }

      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      double currentSL = PositionGetDouble(POSITION_SL);
      double currentTP = PositionGetDouble(POSITION_TP);
      bool isBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      double currentPrice = isBuy ? sym.Bid() : sym.Ask();
      double point = sym.Point();

      double profitPoints = (isBuy ? (currentPrice - openPrice) : (openPrice - currentPrice)) / point;

      if(InpUseBreakEven && profitPoints >= InpBE_TriggerPoints) {
         double newSL = isBuy ? openPrice + InpBE_ProfitPoints * point : openPrice - InpBE_ProfitPoints * point;
         if((isBuy && newSL > currentSL) || (!isBuy && newSL < currentSL))
            trade.PositionModify(ticket, newSL, currentTP);
      }

      if(InpUseTrailing) {
         double trailDist = 0;
         if(InpTrailMode == TRAIL_POINTS) trailDist = InpTrailStep_Points * point;
         else {
            double atrBuf[];
            if(CopyBuffer(handleATR, 0, 0, 1, atrBuf) > 0) trailDist = atrBuf[0] * InpTrailStep_ATR;
            else continue;
         }

         double trailStart = (InpTrailMode == TRAIL_POINTS) ? InpTrailStart_Points * point : 0;
         if(InpTrailMode == TRAIL_ATR) {
            double atrBuf[];
            if(CopyBuffer(handleATR, 0, 0, 1, atrBuf) > 0) trailStart = atrBuf[0] * InpTrailStart_ATR;
            else continue;
         }

         if(profitPoints * point >= trailStart) {
            double newTrailSL = isBuy ? currentPrice - trailDist : currentPrice + trailDist;
            if((isBuy && newTrailSL > currentSL) || (!isBuy && newTrailSL < currentSL))
               trade.PositionModify(ticket, newTrailSL, currentTP);
         }
      }
   }
}

//+------------------------------------------------------------------+
double CalculateLotSize(double slPoints)
{
   if(InpLotMode == LOT_FIXED) return InpFixedLot;
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney = balance * InpRiskPercent / 100.0;
   double tickValue = sym.TickValue();
   double tickSize = sym.TickSize();
   double slDistancePrice = slPoints * sym.Point();
   if(slDistancePrice <= 0 || tickValue <= 0 || tickSize <= 0) return InpFixedLot;

   double lot = riskMoney / ((slDistancePrice / tickSize) * tickValue);
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);

   lot = MathFloor(lot / lotStep) * lotStep;
   lot = MathMax(minLot, MathMin(maxLot, lot));
   return NormalizeDouble(lot, 2);
}

//+------------------------------------------------------------------+
//| NEW-GEN 3D DASHBOARD & LOGO FUNCTIONS                            |
//+------------------------------------------------------------------+
void CreateLogo()
{
   int x = 10, y = 10, w = 200, h = 200;
   string prefix = "GF_Logo_";

   // Try to load actual image if exists in MQL5/Images/
   if(FileIsExist("Images\\goldfire_logo.bmp")) {
      ObjectCreate(0, prefix+"Img", OBJ_BITMAP_LABEL, 0, 0, 0);
      ObjectSetString(0, prefix+"Img", OBJPROP_BMPFILE, "Images\\goldfire_logo.bmp");
      ObjectSetInteger(0, prefix+"Img", OBJPROP_XDISTANCE, x);
      ObjectSetInteger(0, prefix+"Img", OBJPROP_YDISTANCE, y);
      return;
   }

   // Fallback: Stylized Vector-like 3D Box
   CreateRectLabel(prefix+"Bg", x, y, w, h, clrBlack, clrDarkGoldenrod, 2); // 3D border effect
   CreateLabel(prefix+"Title", x+10, y+20, "GOLD FIRE", clrGold, 16, "Arial Black");
   CreateLabel(prefix+"Ver", x+10, y+50, "Version 5.0", clrWhite, 10, "Arial");
   CreateLabel(prefix+"Co", x+10, y+140, "AlgoTraders24", clrWhite, 12, "Arial Bold");
   CreateLabel(prefix+"Url", x+10, y+170, "[www.algotraders24.ai](https://www.algotraders24.ai)", clrDodgerBlue, 9, "Arial");
}

void CreateDashboard()
{
   int x = 10, y = 230, w = 220, h = 180;
   string prefix = "GF_Dash_";

   // 3D Background
   CreateRectLabel(prefix+"Bg", x, y, w, h, clrBlack, clrDarkGoldenrod, 2);

   CreateLabel(prefix+"Title", x+10, y+10, "GOLD FIRE STATUS", clrGold, 11, "Arial Bold");
   CreateLabel(prefix+"Line", x+10, y+30, "________________________", clrDimGray, 10, "Arial");

   CreateLabel(prefix+"Bal", x+10, y+50, "Balance: $0.00", clrWhite, 9, "Consolas");
   CreateLabel(prefix+"Prof", x+10, y+70, "Daily P/L: $0.00", clrLime, 9, "Consolas");
   CreateLabel(prefix+"Trades", x+10, y+90, "Active Trades: 0", clrWhite, 9, "Consolas");
   CreateLabel(prefix+"Spread", x+10, y+110, "Spread: 0 pts", clrWhite, 9, "Consolas");
   CreateLabel(prefix+"Mode", x+10, y+130, "Mode: LIVE", clrDodgerBlue, 9, "Consolas");
   CreateLabel(prefix+"Foot", x+10, y+160, "© AlgoTraders24.ai", clrGray, 8, "Arial");
}

void UpdateDashboard()
{
   string prefix = "GF_Dash_";
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double dailyProf = balance - dailyStartBalance;
   int trades = 0;
   for(int i=PositionsTotal()-1; i>=0; i--) {
      if(PositionGetInteger(POSITION_MAGIC) == InpMagicNumber) trades++;
   }

   ObjectSetString(0, prefix+"Bal", OBJPROP_TEXT, "Balance: $" + DoubleToString(balance, 2));

   color profColor = (dailyProf >= 0) ? clrLime : clrRed;
   ObjectSetString(0, prefix+"Prof", OBJPROP_TEXT, "Daily P/L: $" + DoubleToString(dailyProf, 2));
   ObjectSetInteger(0, prefix+"Prof", OBJPROP_COLOR, profColor);

   ObjectSetString(0, prefix+"Trades", OBJPROP_TEXT, "Active Trades: " + IntegerToString(trades));
   ObjectSetString(0, prefix+"Spread", OBJPROP_TEXT, "Spread: " + IntegerToString((int)sym.Spread()) + " pts");
   ObjectSetString(0, prefix+"Mode", OBJPROP_TEXT, InpBacktestMode ? "Mode: BACKTEST" : "Mode: LIVE");
}

void CreateRectLabel(string name, int x, int y, int w, int h, color bgColor, color borderColor, int borderWidth)
{
   ObjectCreate(0, name, OBJ_RECTANGLE_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetInteger(0, name, OBJPROP_XSIZE, w);
   ObjectSetInteger(0, name, OBJPROP_YSIZE, h);
   ObjectSetInteger(0, name, OBJPROP_BGCOLOR, bgColor);
   ObjectSetInteger(0, name, OBJPROP_BORDER_TYPE, BORDER_FLAT);
   ObjectSetInteger(0, name, OBJPROP_COLOR, borderColor);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, borderWidth);
   ObjectSetInteger(0, name, OBJPROP_BACK, false);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void CreateLabel(string name, int x, int y, string text, color clr, int fontSize, string font)
{
   ObjectCreate(0, name, OBJ_LABEL, 0, 0, 0);
   ObjectSetInteger(0, name, OBJPROP_XDISTANCE, x);
   ObjectSetInteger(0, name, OBJPROP_YDISTANCE, y);
   ObjectSetString(0, name, OBJPROP_TEXT, text);
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_FONTSIZE, fontSize);
   ObjectSetString(0, name, OBJPROP_FONT, font);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
}

void DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--) {
      string name = ObjectName(0, i);
      if(StringFind(name, "GF_") == 0) ObjectDelete(0, name);
   }
}

//+------------------------------------------------------------------+
//| Helper Functions                                                 |
//+------------------------------------------------------------------+
bool CheckSpread() { return (InpMaxSpread > 0 && sym.Spread() > InpMaxSpread) ? false : true; }
bool IsSessionTime() { MqlDateTime dt; TimeCurrent(dt); return (dt.hour >= InpSessionStartHour && dt.hour < InpSessionEndHour); }
bool IsDailyCloseTime() { MqlDateTime dt; TimeCurrent(dt); int t = dt.hour*60+dt.min; return (t >= InpDailyCloseHour*60+InpDailyCloseMinute); }
bool IsFridayCloseTime() { MqlDateTime dt; TimeCurrent(dt); if(dt.day_of_week == 5) { int t = dt.hour*60+dt.min; return (t >= InpFridayCloseHour*60+InpFridayCloseMinute); } return false; }
bool HasOpenPosition() { for(int i=PositionsTotal()-1; i>=0; i--) { ulong t=PositionGetTicket(i); if(t>0 && PositionGetInteger(POSITION_MAGIC)==InpMagicNumber && PositionGetString(POSITION_SYMBOL)==_Symbol) return true; } return false; }
bool HasPendingOrder() { for(int i=OrdersTotal()-1; i>=0; i--) { ulong t=OrderGetTicket(i); if(t>0 && OrderGetInteger(ORDER_MAGIC)==InpMagicNumber && OrderGetString(ORDER_SYMBOL)==_Symbol) return true; } return false; }
void CloseAllPositions() { for(int i=PositionsTotal()-1; i>=0; i--) { ulong t=PositionGetTicket(i); if(t>0 && PositionGetInteger(POSITION_MAGIC)==InpMagicNumber && PositionGetString(POSITION_SYMBOL)==_Symbol) trade.PositionClose(t); } }
void DeleteAllPendingOrders() { for(int i=OrdersTotal()-1; i>=0; i--) { ulong t=OrderGetTicket(i); if(t>0 && OrderGetInteger(ORDER_MAGIC)==InpMagicNumber && OrderGetString(ORDER_SYMBOL)==_Symbol) trade.OrderDelete(t); } }
//+------------------------------------------------------------------+
