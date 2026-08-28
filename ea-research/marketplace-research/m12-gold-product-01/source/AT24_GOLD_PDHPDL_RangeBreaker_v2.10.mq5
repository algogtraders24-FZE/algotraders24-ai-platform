//+------------------------------------------------------------------+
//|                    AT24_GOLD_PDHPDL_RangeBreaker_v2.10.mq5       |
//|         AT24 Gold Range Breaker -- Product #1 candidate           |
//|         (internal system ID: PDHPDL-GOLD, M12 intake)             |
//|              With Fixed Lot OR Correct % Risk + Pyramid System   |
//+------------------------------------------------------------------+
//| v2.10 EXECUTION-INTEGRITY PATCH (M12 audit fixes, entry/exit/     |
//| trend/pyramid/breakeven logic UNCHANGED - see M12_audit_report.md |
//| for the original findings):                                       |
//|  - Added a pre-trade broker stop-distance check (never adjusts    |
//|    SL/TP to fit - a violating trade is skipped, not sent).        |
//|  - CalculateLotSize now REJECTS (returns 0.0) any computed lot     |
//|    outside [volume_min, volume_max], instead of silently clamping |
//|    it - a clamped lot means real risk taken silently diverges     |
//|    from InpRiskPercent.                                            |
//|  - Added MathIsValidNumber() guards throughout the lot-size        |
//|    calculation - a NaN/Inf input now rejects the trade instead of |
//|    flowing into the order request.                                 |
//|  - OnInit() now reconstructs today's initial-trade count from real |
//|    broker deal history instead of a fresh in-memory reset, so a    |
//|    restart mid-day can never grant an extra trade beyond           |
//|    InpMaxTradesPerDay.                                             |
//|  - No change to: PDH/PDL breakout trigger, EMA/ADX filter logic,   |
//|    SL/TP ATR formulas, pyramid trigger/sizing, breakeven trigger,   |
//|    time filter, spread filter, or any input's default value.       |
//|                                                                     |
//| IMPORTANT: this branding (name/copyright/link) does not itself     |
//| mean the product is listed or approved. Real M7 Trust Status for   |
//| this product is currently INCONCLUSIVE (see                       |
//| M12_evidence_qualification_report.md) - no marketplace listing     |
//| exists, and none is created by this rename.                        |
//+------------------------------------------------------------------+
#property copyright "Algotraders24 AI (AT24)"
#property link      "https://algotraders24.ai"
#property version   "2.10"
#property description "AT24 Gold Range Breaker -- previous-day-high/low breakout with EMA/ADX confirmation, ATR risk sizing, and a pyramid add-on system (XAUUSD, MT5)."
#property strict

#include <Trade\Trade.mqh>
CTrade trade;

// This build's fixed AT24 product identity - matches the exact
// tradingSystemId/versionId this compiled binary's own backtest Evidence
// was verified against (marketplace_evidence_records row for PDHPDL-GOLD
// / PDHPDL-GOLD-v2x-2025-2026-EXTENDED-RUN, the version behind the live
// VALIDATED "AT24 Gold Range Breaker" listing). NOT a buyer-entered
// value - see GoldFire_v5.mq5's identical comment on why.
#define AT24_TRADING_SYSTEM_ID "PDHPDL-GOLD"
#define AT24_VERSION_ID        "PDHPDL-GOLD-v2x-2025-2026-EXTENDED-RUN"
#define AT24_PLATFORM          "MT5"

//+------------------------------------------------------------------+
//| ENUMS                                                            |
//+------------------------------------------------------------------+
enum ENUM_LOT_MODE {
   LOT_FIXED,        // Mode 1: Fixed Lot Size (Manual)
   LOT_RISK_PERCENT  // Mode 2: Risk % of Balance (Auto-calculate)
};

//+------------------------------------------------------------------+
//| INPUT PARAMETERS                                                 |
//+------------------------------------------------------------------+
input group "=== STRATEGY SETTINGS ==="
input int            InpMagicNumber     = 100002;        // Unique ID
input int            InpMaxTradesPerDay = 1;             // Max initial trades per day

input group "=== LOT SIZE MODE ==="
input ENUM_LOT_MODE  InpLotMode         = LOT_RISK_PERCENT; // Lot size calculation mode
input double         InpFixedLot        = 0.1;           // Mode 1: Fixed lot size (agar LOT_FIXED select kiya)
input double         InpRiskPercent     = 1.0;           // Mode 2: Risk % per trade (agar LOT_RISK_PERCENT select kiya)

input group "=== POSITIVE PYRAMID SETTINGS ==="
input bool           InpUsePyramid      = true;          // Pyramid system ON/OFF
input int            InpMaxPyramidLevels= 3;             // Max pyramid positions (e.g., 3 = original + 2 additions)
input double         InpPyramidLotMultiplier = 0.5;      // Pyramid lot = Initial Lot × Multiplier (0.5 = half size)
input double         InpPyramid_Trigger_R = 1.0;         // Kitne R profit par pyramid add karein (1.0 = 1R)

input group "=== FILTERS (Fakeout Protection) ==="
input bool           InpUseEMAFilter    = true;          // EMA Trend Filter
input int            InpEMA_Period      = 100;           // EMA Period
input bool           InpUseADXFilter    = true;          // ADX Filter
input int            InpADX_Period      = 14;            // ADX Period
input double         InpADX_MinLevel    = 20.0;          // Minimum ADX level
input int            InpMaxSpreadPoints = 40;            // Max allowed spread

input group "=== TIME FILTER ==="
input bool           InpUseTimeFilter   = true;          // Sirf London/NY session mein trade
input int            InpStartHour       = 8;             // Start hour (GMT)
input int            InpEndHour         = 17;            // End hour (GMT)

input group "=== RISK MANAGEMENT ==="
input int            InpATR_Period      = 14;            // ATR Period
input double         InpSL_ATR_Mult     = 1.5;           // SL = ATR × 1.5
input double         InpTP_ATR_Mult     = 3.0;           // TP = ATR × 3.0
input bool           InpUseBreakEven    = true;          // Break-Even On/Off
input double         InpBE_Trigger_R    = 1.0;           // 1R profit ke baad SL entry par shift

input group "=== AT24 LICENSE ==="
input string         InpLicenseId          = "";         // AT24 License ID (from My Purchases)
input string         InpApiKey             = "";         // AT24 API Key (from My Purchases)
input string         InpBuyerId            = "";         // AT24 Buyer ID (from My Purchases)
input string         InpReleaseId          = "";         // AT24 Release ID (from My Purchases)
input string         InpApiBaseUrl         = "https://www.algotraders24.ai"; // AT24 API base URL
input int            InpLicenseRecheckHours = 24;        // Re-validate license every N hours while running

//+------------------------------------------------------------------+
//| GLOBAL VARIABLES                                                 |
//+------------------------------------------------------------------+
int emaHandle, adxHandle, atrHandle;
double emaBuffer[], adxBuffer[], atrBuffer[];
int initialTradesToday = 0;
datetime lastTradeDay = 0;

//+------------------------------------------------------------------+
//| AT24 LICENSE GUARD (M11 runtime licensing) - identical mechanism |
//| to GoldFire_v5.mq5's own AT24 LICENSE GUARD section; see that    |
//| file for the full design rationale (WebRequest URL allowlisting  |
//| requirement, tester carve-out, revocation semantics).            |
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
   StringToCharArray(bodyJson, postData, 0, StringLen(bodyJson), CP_UTF8);
   ArrayResize(postData, ArraySize(postData) - 1);

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
      Print("AT24 License: InpLicenseId / InpApiKey are empty. Get your real license from My Purchases in your AT24 dashboard after buying this product.");
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

void AT24_RevalidateIfDue()
{
   if(InpLicenseRecheckHours <= 0) return;
   if(TimeCurrent() - g_AT24_LastCheck < InpLicenseRecheckHours * 3600) return;

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
   if(StringLen(resp) == 0) return;

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
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   // AT24 License Guard - mandatory. See this file's own AT24 LICENSE
   // GUARD section; tester carve-out matches GoldFire_v5.mq5's reasoning.
   if(MQLInfoInteger(MQL_TESTER))
   {
      g_AT24_Licensed = true;
      Print("AT24 Gold Range Breaker: running inside Strategy Tester - AT24 License Guard skipped (no network calls in tester).");
   }
   else
   {
      g_AT24_Licensed = AT24_ActivateLicense();
      if(!g_AT24_Licensed)
      {
         Print("AT24 Gold Range Breaker: NOT licensed - EA will not trade. Fill in InpLicenseId/InpApiKey from your AT24 My Purchases page.");
         return(INIT_FAILED);
      }
   }

   if(StringFind(_Symbol, "XAUUSD") == -1 && StringFind(_Symbol, "GOLD") == -1)
      Print("WARNING: This EA is optimized for XAUUSD. Current: ", _Symbol);

   // Initialize indicators
   if(InpUseEMAFilter) {
      emaHandle = iMA(_Symbol, _Period, InpEMA_Period, 0, MODE_EMA, PRICE_CLOSE);
      if(emaHandle == INVALID_HANDLE) return(INIT_FAILED);
      ArraySetAsSeries(emaBuffer, true);
   }

   if(InpUseADXFilter) {
      adxHandle = iADX(_Symbol, _Period, InpADX_Period);
      if(adxHandle == INVALID_HANDLE) return(INIT_FAILED);
      ArraySetAsSeries(adxBuffer, true);
   }

   atrHandle = iATR(_Symbol, _Period, InpATR_Period);
   if(atrHandle == INVALID_HANDLE) return(INIT_FAILED);
   ArraySetAsSeries(atrBuffer, true);

   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFilling(ORDER_FILLING_FOK);

   // v2.10: reconstruct today's initial-trade count from real broker
   // history instead of trusting a fresh in-memory reset - see the
   // function's own header comment.
   RebuildDailyTradeCountFromHistory();

   Print("PDH/PDL Breakout EA v2.10 Initialized");
   Print("Lot Mode: ", EnumToString(InpLotMode), " | Pyramid: ", InpUsePyramid ? "ON" : "OFF");

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(emaHandle != INVALID_HANDLE) IndicatorRelease(emaHandle);
   if(adxHandle != INVALID_HANDLE) IndicatorRelease(adxHandle);
   if(atrHandle != INVALID_HANDLE) IndicatorRelease(atrHandle);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
{
   // 1. Reset daily trade counter
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   datetime today = StringToTime(IntegerToString(dt.year) + "." + IntegerToString(dt.mon) + "." + IntegerToString(dt.day));

   if(today != lastTradeDay) {
      initialTradesToday = 0;
      lastTradeDay = today;
   }

   // 2. Spread check
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPoints) return;

   // 3. Time filter check
   if(InpUseTimeFilter) {
      if(dt.hour < InpStartHour || dt.hour >= InpEndHour) return;
   }

   // 4. Manage existing positions (Break-Even + Pyramid)
   ManagePositions();

   // AT24 License Guard - periodic re-check (no-op inside Strategy
   // Tester). A later revocation blocks new entries below only.
   if(!MQLInfoInteger(MQL_TESTER)) AT24_RevalidateIfDue();
   if(!g_AT24_Licensed) return;

   // 5. Check if we can open initial trade
   if(initialTradesToday >= InpMaxTradesPerDay) return;

   // 6. Check if we already have an initial position (not pyramid)
   int positionCount = CountPositions();
   if(positionCount > 0) return; // Already have positions, wait

   // 7. Get indicator values
   double currentATR = 0;
   if(CopyBuffer(atrHandle, 0, 0, 1, atrBuffer) > 0) currentATR = atrBuffer[0];
   if(currentATR == 0) return;

   double currentADX = 0;
   if(InpUseADXFilter) {
      if(CopyBuffer(adxHandle, 0, 0, 1, adxBuffer) > 0) {
         currentADX = adxBuffer[0];
         if(currentADX < InpADX_MinLevel) return;
      }
   }

   int trendDirection = 0;
   if(InpUseEMAFilter) {
      if(CopyBuffer(emaHandle, 0, 0, 1, emaBuffer) > 0) {
         double price = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         if(price > emaBuffer[0]) trendDirection = 1;
         else if(price < emaBuffer[0]) trendDirection = -1;
      }
   }

   // 8. Calculate PDH/PDL levels
   double pdh = iHigh(_Symbol, PERIOD_D1, 1);
   double pdl = iLow(_Symbol, PERIOD_D1, 1);
   if(pdh == 0 || pdl == 0) return;

   // 9. Calculate SL/TP distances
   double slDistance = currentATR * InpSL_ATR_Mult;
   double tpDistance = currentATR * InpTP_ATR_Mult;

   // 10. Calculate lot size
   double lot = CalculateLotSize(slDistance);

   // 11. Execution logic
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);

   // v2.10: an invalid/rejected lot must never reach trade.Buy/Sell.
   if(lot <= 0) return;

   // BUY: Price breaks above PDH
   if(ask > pdh && (trendDirection == 0 || trendDirection == 1)) {
      double sl = NormalizeDouble(ask - slDistance, _Digits);
      double tp = NormalizeDouble(ask + tpDistance, _Digits);

      if(CheckStopDistance(true, ask, sl, tp)) {
         Print("=== PDH BREAKOUT BUY ===");
         Print("Lot Mode: ", EnumToString(InpLotMode), " | Calculated Lot: ", lot);
         Print("SL: ", sl, " | TP: ", tp);

         if(trade.Buy(lot, _Symbol, ask, sl, tp, "PDH Breakout Initial")) {
            initialTradesToday++;
            Print("Initial trade executed. Trades today: ", initialTradesToday);
         }
      }
   }

   // SELL: Price breaks below PDL
   if(bid < pdl && (trendDirection == 0 || trendDirection == -1)) {
      double sl = NormalizeDouble(bid + slDistance, _Digits);
      double tp = NormalizeDouble(bid - tpDistance, _Digits);

      if(CheckStopDistance(false, bid, sl, tp)) {
         Print("=== PDL BREAKOUT SELL ===");
         Print("Lot Mode: ", EnumToString(InpLotMode), " | Calculated Lot: ", lot);
         Print("SL: ", sl, " | TP: ", tp);

         if(trade.Sell(lot, _Symbol, bid, sl, tp, "PDL Breakout Initial")) {
            initialTradesToday++;
            Print("Initial trade executed. Trades today: ", initialTradesToday);
         }
      }
   }
}

//+------------------------------------------------------------------+
//| CORRECT Lot Size Calculation (Gold-Optimized)                    |
//+------------------------------------------------------------------+
double CalculateLotSize(double slDistancePrice)
{
   if(InpLotMode == LOT_FIXED) {
      // Mode 1: Fixed lot size
      double fixedLot = NormalizeDouble(InpFixedLot, 2);
      if(!MathIsValidNumber(fixedLot) || fixedLot <= 0) {
         Print("LOT SIZE REJECTED: InpFixedLot is invalid (", InpFixedLot, ")");
         return(0.0);
      }
      return(fixedLot);
   }
   else {
      // Mode 2: Risk Percentage (CORRECT FORMULA FOR GOLD)
      if(!MathIsValidNumber(slDistancePrice) || slDistancePrice <= 0) {
         Print("LOT SIZE REJECTED: invalid SL distance (", slDistancePrice, ")");
         return(0.0);
      }

      double balance = AccountInfoDouble(ACCOUNT_BALANCE);
      double riskAmount = balance * (InpRiskPercent / 100.0);

      // Gold-specific calculation
      double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
      double tickSize = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
      double lotStep = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
      double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);

      // v2.10: a zero/invalid symbol spec must reject, not silently divide
      // by an unusable value.
      if(!MathIsValidNumber(tickValue) || !MathIsValidNumber(tickSize) || tickValue <= 0 || tickSize <= 0 ||
         lotStep <= 0 || minLot <= 0) {
         Print("LOT SIZE REJECTED: invalid symbol specification (tickValue=", tickValue, " tickSize=", tickSize,
               " lotStep=", lotStep, " minLot=", minLot, ")");
         return(0.0);
      }

      // Calculate how many ticks in SL distance
      double slInTicks = slDistancePrice / tickSize;

      // Calculate dollar value per tick for 1 lot
      double dollarPerTick = tickValue;

      // Calculate dollar risk per lot for this SL
      double dollarRiskPerLot = slInTicks * dollarPerTick;

      if(!MathIsValidNumber(dollarRiskPerLot) || dollarRiskPerLot <= 0) {
         Print("LOT SIZE REJECTED: invalid dollar-risk-per-lot (", dollarRiskPerLot, ")");
         return(0.0);
      }

      // Calculate lot size
      double rawLot = riskAmount / dollarRiskPerLot;
      if(!MathIsValidNumber(rawLot) || rawLot <= 0) {
         Print("LOT SIZE REJECTED: invalid raw lot computation (", rawLot, ")");
         return(0.0);
      }

      double finalLot = MathFloor(rawLot / lotStep) * lotStep;

      // v2.10: REJECT (never silently clamp) a lot outside the broker's
      // allowed range - a clamped lot means the actual risk taken silently
      // diverges from InpRiskPercent, in either direction.
      if(finalLot < minLot) {
         Print("LOT SIZE REJECTED: computed lot ", finalLot, " is below broker minimum ", minLot,
               " - risk amount too small for this SL distance, not clamped up.");
         return(0.0);
      }
      if(maxLot > 0 && finalLot > maxLot) {
         Print("LOT SIZE REJECTED: computed lot ", finalLot, " exceeds broker maximum ", maxLot,
               " - not clamped down.");
         return(0.0);
      }

      Print("Risk Calculation: Balance=", balance, " | Risk%=", InpRiskPercent,
            " | RiskAmount=$", riskAmount, " | SL Distance=", slDistancePrice,
            " | Raw Lot=", rawLot, " | Final Lot=", finalLot);

      return NormalizeDouble(finalLot, 2);
   }
}

//+------------------------------------------------------------------+
//| v2.10 execution-integrity patch: pre-trade broker stop-distance   |
//| check. Never adjusts SL/TP to make a trade fit - if the strategy's|
//| already-computed SL/TP violates the broker's minimum distance     |
//| (max of SYMBOL_TRADE_STOPS_LEVEL / SYMBOL_TRADE_FREEZE_LEVEL), the |
//| trade is rejected as-is, not silently sent anyway.                |
//+------------------------------------------------------------------+
bool CheckStopDistance(bool isBuy, double entryPrice, double sl, double tp)
{
   double point = SymbolInfoDouble(_Symbol, SYMBOL_POINT);
   long stopsLevelPoints  = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long freezeLevelPoints = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL);
   double minDistance = MathMax(stopsLevelPoints, freezeLevelPoints) * point;

   double slDistance, tpDistance;
   if(isBuy) {
      slDistance = entryPrice - sl;
      tpDistance = tp - entryPrice;
   } else {
      slDistance = sl - entryPrice;
      tpDistance = entryPrice - tp;
   }

   if(slDistance < minDistance || tpDistance < minDistance) {
      Print("STOP DISTANCE BLOCK: dir=", isBuy ? "BUY" : "SELL", " entry=", entryPrice,
            " sl=", sl, " tp=", tp, " min_distance=", minDistance,
            " sl_distance=", slDistance, " tp_distance=", tpDistance);
      return(false);
   }
   return(true);
}

//+------------------------------------------------------------------+
//| v2.10 execution-integrity patch: rebuild initialTradesToday/       |
//| lastTradeDay from REAL broker deal history on (re)start, so a      |
//| restart mid-day can never silently grant an extra trade beyond     |
//| InpMaxTradesPerDay. Counts only today's DEAL_ENTRY_IN deals for    |
//| this symbol+magic whose comment identifies them as an INITIAL      |
//| entry (pyramid legs are excluded, matching the live counting       |
//| logic in OnTick/ManagePositions).                                  |
//+------------------------------------------------------------------+
void RebuildDailyTradeCountFromHistory()
{
   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime dayStart = StructToTime(dt);
   datetime dayEnd = dayStart + 86400;

   lastTradeDay = dayStart;
   initialTradesToday = 0;

   if(!HistorySelect(dayStart, dayEnd)) {
      Print("RebuildDailyTradeCountFromHistory: HistorySelect failed, starting count at 0.");
      return;
   }

   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++) {
      ulong dealTicket = HistoryDealGetTicket(i);
      if(dealTicket == 0) continue;
      if(HistoryDealGetString(dealTicket, DEAL_SYMBOL) != _Symbol) continue;
      if(HistoryDealGetInteger(dealTicket, DEAL_MAGIC) != InpMagicNumber) continue;
      if((ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY) != DEAL_ENTRY_IN) continue;
      string comment = HistoryDealGetString(dealTicket, DEAL_COMMENT);
      if(StringFind(comment, "Initial") == -1) continue;
      initialTradesToday++;
   }

   Print("RebuildDailyTradeCountFromHistory: reconstructed initialTradesToday=", initialTradesToday, " for today (", TimeToString(dayStart, TIME_DATE), ").");
}

//+------------------------------------------------------------------+
//| Count Current Positions                                          |
//+------------------------------------------------------------------+
int CountPositions()
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagicNumber) {
         count++;
      }
   }
   return count;
}

//+------------------------------------------------------------------+
//| Manage Positions: Break-Even + Pyramid                           |
//+------------------------------------------------------------------+
void ManagePositions()
{
   if(CopyBuffer(atrHandle, 0, 0, 1, atrBuffer) <= 0) return;
   double currentATR = atrBuffer[0];

   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagicNumber) {

         double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
         double currentSL = PositionGetDouble(POSITION_SL);
         double currentTP = PositionGetDouble(POSITION_TP);
         double volume = PositionGetDouble(POSITION_VOLUME);
         ENUM_POSITION_TYPE type = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
         string comment = PositionGetString(POSITION_COMMENT);

         // 1. Break-Even Logic
         if(InpUseBreakEven) {
            double triggerDistance = currentATR * InpSL_ATR_Mult * InpBE_Trigger_R;

            if(type == POSITION_TYPE_BUY) {
               double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_BID);
               if(currentPrice - openPrice >= triggerDistance) {
                  if(currentSL < openPrice) {
                     double newSL = NormalizeDouble(openPrice + (10 * _Point), _Digits);
                     trade.PositionModify(ticket, newSL, currentTP);
                     Print("Break-Even triggered for BUY #", ticket);
                  }
               }
            } else if(type == POSITION_TYPE_SELL) {
               double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
               if(openPrice - currentPrice >= triggerDistance) {
                  if(currentSL > openPrice || currentSL == 0) {
                     double newSL = NormalizeDouble(openPrice - (10 * _Point), _Digits);
                     trade.PositionModify(ticket, newSL, currentTP);
                     Print("Break-Even triggered for SELL #", ticket);
                  }
               }
            }
         }

         // 2. Pyramid Logic (Only for initial positions, not pyramid positions)
         if(InpUsePyramid && StringFind(comment, "Initial") != -1) {
            int currentPyramidCount = CountPositions() - 1; // Subtract initial position

            if(currentPyramidCount < InpMaxPyramidLevels - 1) {
               double profitDistance = currentATR * InpSL_ATR_Mult * InpPyramid_Trigger_R;

               if(type == POSITION_TYPE_BUY) {
                  double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_BID);
                  if(currentPrice - openPrice >= profitDistance) {
                     // Add pyramid position
                     double pyramidLot = NormalizeDouble(volume * InpPyramidLotMultiplier, 2);
                     double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
                     if(pyramidLot < minLot) pyramidLot = minLot;

                     // New SL at breakeven of this pyramid level
                     double newSL = NormalizeDouble(currentPrice - (currentATR * InpSL_ATR_Mult), _Digits);
                     double newTP = NormalizeDouble(currentPrice + (currentATR * InpTP_ATR_Mult), _Digits);

                     // v2.10: reject (do not send) a pyramid leg whose SL/TP
                     // violates the broker's minimum stop distance.
                     if(pyramidLot > 0 && CheckStopDistance(true, currentPrice, newSL, newTP)) {
                        Print("=== PYRAMID BUY === Level: ", currentPyramidCount + 2);
                        Print("Lot: ", pyramidLot, " | SL: ", newSL, " | TP: ", newTP);

                        if(trade.Buy(pyramidLot, _Symbol, currentPrice, newSL, newTP, "Pyramid Buy")) {
                           Print("Pyramid position added successfully");
                        }
                     }
                  }
               } else if(type == POSITION_TYPE_SELL) {
                  double currentPrice = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
                  if(openPrice - currentPrice >= profitDistance) {
                     // Add pyramid position
                     double pyramidLot = NormalizeDouble(volume * InpPyramidLotMultiplier, 2);
                     double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
                     if(pyramidLot < minLot) pyramidLot = minLot;

                     double newSL = NormalizeDouble(currentPrice + (currentATR * InpSL_ATR_Mult), _Digits);
                     double newTP = NormalizeDouble(currentPrice - (currentATR * InpTP_ATR_Mult), _Digits);

                     // v2.10: reject (do not send) a pyramid leg whose SL/TP
                     // violates the broker's minimum stop distance.
                     if(pyramidLot > 0 && CheckStopDistance(false, currentPrice, newSL, newTP)) {
                        Print("=== PYRAMID SELL === Level: ", currentPyramidCount + 2);
                        Print("Lot: ", pyramidLot, " | SL: ", newSL, " | TP: ", newTP);

                        if(trade.Sell(pyramidLot, _Symbol, currentPrice, newSL, newTP, "Pyramid Sell")) {
                           Print("Pyramid position added successfully");
                        }
                     }
                  }
               }
            }
         }
      }
   }
}
//+------------------------------------------------------------------+
