//+------------------------------------------------------------------+
//|                           UniversalTrailingPendingEA_FINAL.mq5   |
//|  v7.03 - v7.02 + chart dashboard (trading logic unchanged)        |
//+------------------------------------------------------------------+
#property copyright "Universal EA Final"
#property version   "7.03"
#property strict

//--- AT24 licence gate: one key = one trading account, only for this product (the Strategy Tester needs no key)
#define AT24_PRODUCT_ID "UNIVERSALEA"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = "";   // AT24 licence key (from your AT24 purchase page)

#include <Canvas/Canvas.mqh>
#property description "Universal Trailing Pending EA - All Brokers"

//+------------------------------------------------------------------+
//| INPUT PARAMETERS                                                 |
//+------------------------------------------------------------------+
input group "=== INDICATOR SETTINGS ==="
input int      InpATRPeriod = 14;              // ATR Period
input double   InpATRMultiplier = 2.0;         // ATR Multiplier
input int      InpEMAPeriod = 50;              // EMA Period (Trend Filter)

input group "=== TRADE SETTINGS ==="
input double   InpSLPoints = 500;              // Stop Loss (Points)
input double   InpLotSize = 0.01;              // Base Lot Size (0 = Auto Min)
input int      InpMagicNumber = 123456;        // Magic Number
input string   InpTradeComment = "UniversalEA"; // Trade Comment

input group "=== LOT COMPOUNDING (profit ke sath lot badhe) ==="
input bool     InpUseCompounding = false;      // Lot badhao jab balance badhe
input double   InpBaseBalance = 0;             // Base balance (0 = balance at EA start)
input double   InpCompoundStepUSD = 100;       // Har itne USD profit par...
input double   InpLotIncrement = 0.01;         // ...itna lot badhao
input double   InpMaxLot = 1.0;                // Max lot cap (0 = broker max)

input group "=== STOP MANAGEMENT ==="
input bool     InpUseBreakeven = true;         // Move SL to Breakeven
input double   InpBreakevenTrigger = 300;      // BE Trigger (Points profit)
input bool     InpUseTrailingSL = true;        // Trail Position SL
input double   InpTrailingSLPoints = 400;      // Position SL Trail Distance (Points)

input group "=== REVERSAL (open the opposite trade after a stop-loss loss) ==="
input bool     InpUseReversal = true;          // When a position is closed by its SL at a LOSS, open the opposite trade at market
input int      InpMaxReversals = 1;            // Max reversals in a row (the chain starts again after a profit / break-even exit)
input double   InpReverseLotMult = 1.0;        // Lot of the reversal trade = lot of the stopped trade x this

input group "=== FLAT STRADDLE REFRESH ==="
input double   InpFlatRefreshATR = 0;          // Flat me pending itne ATR se door ho to refresh (0 = off)

input group "=== FILTERS ==="
input bool     InpUseTrendFilter = false;      // Use EMA Trend Filter
input bool     InpUseSpreadFilter = true;      // Use Spread Filter
input int      InpMaxSpreadPoints = 50;        // Max Spread (Points)
input bool     InpUseSessionFilter = true;     // Use Session Filter
input int      InpStartHour = 8;               // Start Hour (Server)
input int      InpEndHour = 20;                // End Hour (Server)
input bool     InpAvoidFriday = true;          // Avoid Friday Afternoon
input int      InpFridayCloseHour = 18;        // Friday Close Hour

input group "=== RISK MANAGEMENT ==="
input double   InpMaxDailyLossUSD = 100;       // Max Daily Loss (USD, 0 = off)

input group "=== DISPLAY SETTINGS ==="
input bool     InpAutoDetectSymbol = true;     // Auto Detect Suffix/Prefix
input bool     InpShowDashboard = true;        // Show Dashboard
input bool     InpDashInTester = false;        // Strategy Tester: draw it only in visual mode when this is true (off by default)
input int      InpDashX = 12;                  // Dashboard X (pixels from the left)
input int      InpDashY = 28;                  // Dashboard Y (pixels from the top)
input bool     InpEnableLogging = true;        // Enable Logs

//+------------------------------------------------------------------+
//| GLOBAL VARIABLES                                                 |
//+------------------------------------------------------------------+
int      g_atrHandle = INVALID_HANDLE;
int      g_emaHandle = INVALID_HANDLE;
double   g_atrBuffer[];
double   g_emaBuffer[];

bool     g_buyTradeActive = false;
bool     g_sellTradeActive = false;
ulong    g_buyTicket = 0;
ulong    g_sellTicket = 0;
ulong    g_buyStopTicket = 0;
ulong    g_sellStopTicket = 0;

string   g_actualSymbol = "";
double   g_pointValue = 0;
int      g_digits = 0;
double   g_minLot = 0, g_maxLot = 0, g_lotStep = 0;
int      g_lotDigits = 2;
double   g_minStopDist = 0;
bool     g_is3DigitBroker = false;

bool     g_isTestingMode = false;
double   g_dailyStartBalance = 0;
double   g_baseBalance = 0;
datetime g_lastDay = 0;
int      g_revCount = 0;      // reversals in the current chain
int      g_revTotal = 0;      // reversals since the EA started
CCanvas  g_cv;                // dashboard
bool     g_dashOn = false;

//+------------------------------------------------------------------+
//| INITIALIZATION                                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   EventSetTimer(1);                                        // licence re-check every few hours (and the dashboard)
   g_isTestingMode = MQLInfoInteger(MQL_TESTER) || MQLInfoInteger(MQL_OPTIMIZATION);

   if(!InitializeSymbolSettings())
      return(INIT_FAILED);

   g_atrHandle = iATR(g_actualSymbol, PERIOD_CURRENT, InpATRPeriod);
   if(g_atrHandle == INVALID_HANDLE)
   {
      Print("ATR init failed: ", GetLastError());
      return(INIT_FAILED);
   }
   ArraySetAsSeries(g_atrBuffer, true);

   if(InpUseTrendFilter)
   {
      g_emaHandle = iMA(g_actualSymbol, PERIOD_CURRENT, InpEMAPeriod, 0, MODE_EMA, PRICE_CLOSE);
      if(g_emaHandle == INVALID_HANDLE)
      {
         Print("EMA init failed: ", GetLastError());
         return(INIT_FAILED);
      }
      ArraySetAsSeries(g_emaBuffer, true);
   }

   g_dailyStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   g_baseBalance = (InpBaseBalance > 0) ? InpBaseBalance : AccountInfoDouble(ACCOUNT_BALANCE);
   g_lastDay = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));

   DashCreate();
   LogMessage("Universal EA v7.03 initialized | " + g_actualSymbol +
              " | Digits: " + IntegerToString(g_digits) +
              " | MinStop: " + DoubleToString(g_minStopDist, g_digits) +
              " | BaseBalance: " + DoubleToString(g_baseBalance, 2));
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   if(g_atrHandle != INVALID_HANDLE) IndicatorRelease(g_atrHandle);
   if(g_emaHandle != INVALID_HANDLE) IndicatorRelease(g_emaHandle);
   EventKillTimer();
   if(g_dashOn) { g_cv.Destroy(); g_dashOn = false; }
   if(!g_isTestingMode) Comment("");
}

//+------------------------------------------------------------------+
//| SYMBOL SETTINGS                                                  |
//+------------------------------------------------------------------+
bool InitializeSymbolSettings()
{
   g_actualSymbol = InpAutoDetectSymbol ? DetectSymbolWithSuffix() : _Symbol;
   if(g_actualSymbol == "") return false;

   // FIX 6: make sure the detected symbol is in Market Watch
   if(!SymbolSelect(g_actualSymbol, true))
   {
      Print("SymbolSelect failed for ", g_actualSymbol);
      return false;
   }

   g_digits      = (int)SymbolInfoInteger(g_actualSymbol, SYMBOL_DIGITS);
   g_pointValue  = SymbolInfoDouble(g_actualSymbol, SYMBOL_POINT);
   g_minLot      = SymbolInfoDouble(g_actualSymbol, SYMBOL_VOLUME_MIN);
   g_maxLot      = SymbolInfoDouble(g_actualSymbol, SYMBOL_VOLUME_MAX);
   g_lotStep     = SymbolInfoDouble(g_actualSymbol, SYMBOL_VOLUME_STEP);

   // FIX 5: lot digits derived from the lot step (0.01 -> 2, 0.001 -> 3)
   g_lotDigits = 0;
   for(double s = g_lotStep; s > 0 && s < 1.0 - 1e-9 && g_lotDigits < 8; s *= 10.0)
      g_lotDigits++;

   long stopsLevel = SymbolInfoInteger(g_actualSymbol, SYMBOL_TRADE_STOPS_LEVEL);
   g_minStopDist = stopsLevel * g_pointValue;
   if(g_minStopDist <= 0) g_minStopDist = g_pointValue * 10;

   g_is3DigitBroker = (g_digits >= 3 && g_pointValue < 0.01);
   return true;
}

//+------------------------------------------------------------------+
string DetectSymbolWithSuffix()
{
   string currentSymbol = _Symbol;
   if(SymbolInfoDouble(currentSymbol, SYMBOL_BID) > 0)
      return currentSymbol;

   string base = ExtractBaseSymbol(currentSymbol);
   string suffixes[] = {"", ".pro", ".m", "_m", ".i", "-m", "raw", "ecn", "standard", "#", ".raw", ".stp"};

   for(int i = 0; i < ArraySize(suffixes); i++)
   {
      string test = base + suffixes[i];
      if(SymbolInfoDouble(test, SYMBOL_BID) > 0)
      {
         LogMessage("Detected symbol: " + test);
         return test;
      }
   }
   return currentSymbol;
}

//+------------------------------------------------------------------+
string ExtractBaseSymbol(string symbol)
{
   if(StringFind(symbol, "XAU") >= 0 || StringFind(symbol, "GOLD") >= 0) return "XAUUSD";
   if(StringFind(symbol, "US30") >= 0 || StringFind(symbol, "DJ30") >= 0) return "US30";
   if(StringFind(symbol, "NAS") >= 0 || StringFind(symbol, "US100") >= 0) return "NAS100";
   if(StringFind(symbol, "SPX") >= 0 || StringFind(symbol, "US500") >= 0) return "SPX500";
   return symbol;
}

//+------------------------------------------------------------------+
//| LOT SIZE                                                         |
//+------------------------------------------------------------------+
double AdjustLotSize(double lot)
{
   if(lot <= 0) lot = g_minLot;
   lot = MathFloor(lot / g_lotStep + 1e-9) * g_lotStep;
   if(lot < g_minLot) lot = g_minLot;
   if(lot > g_maxLot) lot = g_maxLot;
   return NormalizeDouble(lot, g_lotDigits);
}

// Compounding: lot grows by InpLotIncrement for every InpCompoundStepUSD of
// balance above the base balance. It never drops below InpLotSize.
double GetTradeLot()
{
   double lot = InpLotSize;

   if(InpUseCompounding && InpCompoundStepUSD > 0)
   {
      double bal = AccountInfoDouble(ACCOUNT_BALANCE);
      if(bal > g_baseBalance)
      {
         int steps = (int)MathFloor((bal - g_baseBalance) / InpCompoundStepUSD);
         lot += steps * InpLotIncrement;
      }
      if(InpMaxLot > 0 && lot > InpMaxLot) lot = InpMaxLot;
   }
   return AdjustLotSize(lot);
}

//+------------------------------------------------------------------+
//| MAIN TICK                                                        |
//+------------------------------------------------------------------+
void OnTick()
{
   CheckNewDay();

   // STEP 1: Sync state from market (fixes stale tickets)
   RefreshStateFromMarket();

   // STEP 2: a trade is open -> no pending order stays (nothing moves with the SL any more)
   if(g_buyTradeActive || g_sellTradeActive)
      RemoveAllPendings();
   CleanupDuplicateOrders();

   // STEP 3: Manage position SL (breakeven + trailing)
   ApplyStopManagement();
   if(!AT24Gate_Allowed()) RemoveAllPendings();             // no valid licence: open trades are still managed, no pending orders stand

   // STEP 4: Flat -> keep BOTH pending orders alive (each side independently)
   if(!g_buyTradeActive && !g_sellTradeActive)
   {
      RefreshStaleStraddle();
      if(CanPlaceNewOrders())
         PlaceStraddle();
   }

   DrawDash();
}

//+------------------------------------------------------------------+
//| REFRESH STATE FROM MARKET                                        |
//+------------------------------------------------------------------+
void RefreshStateFromMarket()
{
   bool mBuy = false, mSell = false;
   ulong mBuyTicket = 0, mSellTicket = 0;

   //--- Scan positions
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != g_actualSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;

      if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
      { mBuy = true; mBuyTicket = t; }
      else
      { mSell = true; mSellTicket = t; }
   }

   //--- BUY transition
   if(mBuy && !g_buyTradeActive)
   {
      g_buyTradeActive = true;
      g_buyTicket = mBuyTicket;
      LogMessage("BUY position detected | Ticket: " + IntegerToString(mBuyTicket));

      if(mSell) // reverse: close opposite
      {
         ClosePosition(mSellTicket);
         g_sellTradeActive = false;
         g_sellTicket = 0;
      }
   }
   if(!mBuy && g_buyTradeActive)
   {
      ulong closedT = g_buyTicket;
      g_buyTradeActive = false; g_buyTicket = 0; LogMessage("Buy position closed");
      ulong nt = 0;
      if(OnPositionClosed(true, closedT, nt) && nt > 0)
      { mSell = true; mSellTicket = nt; }        // the SELL block below registers the reversal trade
   }

   //--- SELL transition
   if(mSell && !g_sellTradeActive)
   {
      g_sellTradeActive = true;
      g_sellTicket = mSellTicket;
      LogMessage("SELL position detected | Ticket: " + IntegerToString(mSellTicket));

      if(mBuy) // reverse: close opposite
      {
         ClosePosition(mBuyTicket);
         g_buyTradeActive = false;
         g_buyTicket = 0;
      }
   }
   if(!mSell && g_sellTradeActive)
   {
      ulong closedT = g_sellTicket;
      g_sellTradeActive = false; g_sellTicket = 0; LogMessage("Sell position closed");
      ulong nt = 0;
      if(OnPositionClosed(false, closedT, nt) && nt > 0)
      { g_buyTradeActive = true; g_buyTicket = nt; LogMessage("BUY reversal registered | Ticket: " + IntegerToString(nt)); }
   }

   //--- Scan pending orders (keep LATEST ticket of each type)
   ulong mBS = 0, mSS = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != g_actualSymbol) continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) continue;

      ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      if(ot == ORDER_TYPE_BUY_STOP  && t > mBS) mBS = t;
      if(ot == ORDER_TYPE_SELL_STOP && t > mSS) mSS = t;
   }
   g_buyStopTicket = mBS;
   g_sellStopTicket = mSS;
}

//+------------------------------------------------------------------+
//| DELETE DUPLICATE PENDING ORDERS                                  |
//+------------------------------------------------------------------+
void CleanupDuplicateOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != g_actualSymbol) continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) continue;

      ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
      if(ot == ORDER_TYPE_BUY_STOP && t != g_buyStopTicket)
         DeletePendingOrder(t);
      else if(ot == ORDER_TYPE_SELL_STOP && t != g_sellStopTicket)
         DeletePendingOrder(t);
   }
}

//+------------------------------------------------------------------+
//| PRICE HELPERS                                                    |
//+------------------------------------------------------------------+
double SLForSellStop(double price) { return NormalizeDouble(price + InpSLPoints * g_pointValue, g_digits); }
double SLForBuyStop(double price)  { return NormalizeDouble(price - InpSLPoints * g_pointValue, g_digits); }

//+------------------------------------------------------------------+
//| PLACE STRADDLE - each side independently (FIX 3)                 |
//+------------------------------------------------------------------+
void PlaceStraddle()
{
   bool needBuy  = (g_buyStopTicket == 0)  && (!InpUseTrendFilter || IsTrendValidForBuy());
   bool needSell = (g_sellStopTicket == 0) && (!InpUseTrendFilter || IsTrendValidForSell());
   if(!needBuy && !needSell) return;

   double atr = GetATR();
   if(atr <= 0) return;

   double atrDist = atr * InpATRMultiplier;
   double slDist  = InpSLPoints * g_pointValue;

   double orderDist = MathMax(atrDist, slDist * 1.2);
   orderDist = MathMax(orderDist, g_minStopDist * 1.5);

   double ask = SymbolInfoDouble(g_actualSymbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(g_actualSymbol, SYMBOL_BID);

   if(needBuy)
   {
      double buyPrice = NormalizeDouble(ask + orderDist, g_digits);
      g_buyStopTicket = PlacePendingOrder(ORDER_TYPE_BUY_STOP, buyPrice, SLForBuyStop(buyPrice));
   }
   if(needSell)
   {
      double sellPrice = NormalizeDouble(bid - orderDist, g_digits);
      g_sellStopTicket = PlacePendingOrder(ORDER_TYPE_SELL_STOP, sellPrice, SLForSellStop(sellPrice));
   }
}

//+------------------------------------------------------------------+
//| FLAT: delete pending that drifted too far (optional, default off)|
//+------------------------------------------------------------------+
void RefreshStaleStraddle()
{
   if(InpFlatRefreshATR <= 0) return;
   double atr = GetATR();
   if(atr <= 0) return;
   double maxDist = atr * InpFlatRefreshATR;

   if(g_buyStopTicket > 0)
   {
      double p = GetOrderPrice(g_buyStopTicket);
      if(p > 0 && (p - SymbolInfoDouble(g_actualSymbol, SYMBOL_ASK)) > maxDist)
      { DeletePendingOrder(g_buyStopTicket); g_buyStopTicket = 0; }
   }
   if(g_sellStopTicket > 0)
   {
      double p = GetOrderPrice(g_sellStopTicket);
      if(p > 0 && (SymbolInfoDouble(g_actualSymbol, SYMBOL_BID) - p) > maxDist)
      { DeletePendingOrder(g_sellStopTicket); g_sellStopTicket = 0; }
   }
}

//+------------------------------------------------------------------+
//| Delete every pending order of this EA (used while a trade is open)|
//+------------------------------------------------------------------+
void RemoveAllPendings()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong t = OrderGetTicket(i);
      if(t == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != g_actualSymbol) continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagicNumber) continue;
      DeletePendingOrder(t);
   }
   g_buyStopTicket = 0;
   g_sellStopTicket = 0;
}

//+------------------------------------------------------------------+
//| REVERSAL: the position was closed. If its SL took it out at a    |
//| loss, open the opposite trade at market (same SL distance).      |
//| Returns true and the new ticket when a reversal trade was opened.|
//+------------------------------------------------------------------+
ENUM_ORDER_TYPE_FILLING FillingMode()
{
   long m = SymbolInfoInteger(g_actualSymbol, SYMBOL_FILLING_MODE);
   if((m & SYMBOL_FILLING_FOK) != 0) return ORDER_FILLING_FOK;
   if((m & SYMBOL_FILLING_IOC) != 0) return ORDER_FILLING_IOC;
   return ORDER_FILLING_RETURN;
}

bool OnPositionClosed(const bool wasBuy, const ulong posTicket, ulong &newTicket)
{
   newTicket = 0;
   if(!InpUseReversal || posTicket == 0) return false;
   if(!HistorySelectByPosition(posTicket)) { g_revCount = 0; return false; }

   double openPx = 0, exitPx = 0, vol = 0;
   long   reason = -1;
   for(int i = 0; i < HistoryDealsTotal(); i++)
   {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0) continue;
      long en = HistoryDealGetInteger(d, DEAL_ENTRY);
      if(en == DEAL_ENTRY_IN)  openPx = HistoryDealGetDouble(d, DEAL_PRICE);
      if(en == DEAL_ENTRY_OUT || en == DEAL_ENTRY_OUT_BY)
      {
         exitPx = HistoryDealGetDouble(d, DEAL_PRICE);
         vol    = HistoryDealGetDouble(d, DEAL_VOLUME);
         reason = HistoryDealGetInteger(d, DEAL_REASON);
      }
   }
   if(openPx <= 0 || exitPx <= 0 || vol <= 0) { g_revCount = 0; return false; }

   bool lossBySL = (reason == DEAL_REASON_SL) &&
                   (wasBuy ? (exitPx < openPx - g_pointValue) : (exitPx > openPx + g_pointValue));
   if(!lossBySL) { g_revCount = 0; return false; }            // profit / break-even / manual exit: the chain ends

   if(g_revCount >= InpMaxReversals)
   {
      LogMessage("Reversal limit reached (" + IntegerToString(InpMaxReversals) + ") - no more reversals");
      g_revCount = 0;
      return false;
   }
   if(!RiskAllowsNewOrders()) { LogMessage("Reversal skipped: spread / daily loss limit"); g_revCount = 0; return false; }

   double ask = SymbolInfoDouble(g_actualSymbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(g_actualSymbol, SYMBOL_BID);
   double slDist = MathMax(InpSLPoints * g_pointValue, g_minStopDist * 1.2);
   bool   goBuy  = !wasBuy;
   double price  = goBuy ? ask : bid;
   double sl     = NormalizeDouble(goBuy ? price - slDist : price + slDist, g_digits);

   MqlTradeRequest r = {};
   MqlTradeResult res = {};
   r.action       = TRADE_ACTION_DEAL;
   r.symbol       = g_actualSymbol;
   r.volume       = AdjustLotSize(vol * InpReverseLotMult);
   r.type         = goBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   r.price        = price;
   r.sl           = sl;
   r.deviation    = 30;
   r.magic        = InpMagicNumber;
   r.comment      = InpTradeComment + "-REV";
   r.type_filling = FillingMode();

   if(OrderSend(r, res) && (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_DONE_PARTIAL))
   {
      g_revCount++; g_revTotal++;
      newTicket = res.order;
      LogMessage(StringFormat("REVERSAL %d: %s stopped out at %s (entry %s) -> %s %.2f lot opened | SL %s",
                 g_revCount, wasBuy ? "BUY" : "SELL", DoubleToString(exitPx, g_digits), DoubleToString(openPx, g_digits),
                 goBuy ? "BUY" : "SELL", r.volume, DoubleToString(sl, g_digits)));
      return true;
   }
   LogMessage("Reversal FAILED | " + IntegerToString(res.retcode) + " | " + GetRetcodeDescription(res.retcode));
   g_revCount = 0;
   return false;
}

//+------------------------------------------------------------------+
//| STOP MANAGEMENT: BREAKEVEN + TRAILING SL                         |
//+------------------------------------------------------------------+
void ApplyStopManagement()
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != g_actualSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      if(!PositionSelectByTicket(t)) continue;

      double open  = PositionGetDouble(POSITION_PRICE_OPEN);
      double curSL = PositionGetDouble(POSITION_SL);
      double curTP = PositionGetDouble(POSITION_TP);
      ENUM_POSITION_TYPE pt = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

      if(pt == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(g_actualSymbol, SYMBOL_BID);
         double profitPts = (bid - open) / g_pointValue;
         double newSL = curSL;

         if(profitPts >= InpBreakevenTrigger)
         {
            if(InpUseBreakeven && curSL < open)
               newSL = MathMax(newSL, NormalizeDouble(open + g_pointValue, g_digits));

            if(InpUseTrailingSL)
            {
               double trailSL = NormalizeDouble(bid - InpTrailingSLPoints * g_pointValue, g_digits);
               if(trailSL > open)
                  newSL = MathMax(newSL, trailSL);
            }
         }

         if(newSL > curSL + g_pointValue * 0.5)
            ModifyPositionSL(t, newSL, curTP);
      }
      else
      {
         double ask = SymbolInfoDouble(g_actualSymbol, SYMBOL_ASK);
         double profitPts = (open - ask) / g_pointValue;
         double newSL = curSL;

         if(profitPts >= InpBreakevenTrigger)
         {
            if(InpUseBreakeven && (curSL > open || curSL == 0))
               newSL = (curSL == 0) ? NormalizeDouble(open - g_pointValue, g_digits)
                                    : MathMin(newSL, NormalizeDouble(open - g_pointValue, g_digits));

            if(InpUseTrailingSL)
            {
               double trailSL = NormalizeDouble(ask + InpTrailingSLPoints * g_pointValue, g_digits);
               if(trailSL < open)
                  newSL = (newSL == 0) ? trailSL : MathMin(newSL, trailSL);
            }
         }

         if(newSL > 0 && (curSL == 0 || newSL < curSL - g_pointValue * 0.5))
            ModifyPositionSL(t, newSL, curTP);
      }
   }
}

//+------------------------------------------------------------------+
//| FILTERS                                                          |
//+------------------------------------------------------------------+
// Spread + daily loss only (used for the reverse stop, ignores session)
bool RiskAllowsNewOrders()
{
   if(!AT24Gate_Allowed()) return false;                    // no valid licence: no new trades and no reversals
   if(InpUseSpreadFilter)
   {
      long spread = SymbolInfoInteger(g_actualSymbol, SYMBOL_SPREAD);
      if(spread > InpMaxSpreadPoints) return false;
   }

   if(InpMaxDailyLossUSD > 0)
   {
      double totalPL = (AccountInfoDouble(ACCOUNT_BALANCE) - g_dailyStartBalance) + AccountInfoDouble(ACCOUNT_PROFIT);
      if(totalPL < -InpMaxDailyLossUSD) return false;
   }
   return true;
}

bool CanPlaceNewOrders()
{
   if(InpUseSessionFilter)
   {
      MqlDateTime dt;
      TimeCurrent(dt);
      if(InpAvoidFriday && dt.day_of_week == 5 && dt.hour >= InpFridayCloseHour) return false;
      if(dt.day_of_week == 0 || dt.day_of_week == 6) return false;
      if(dt.hour < InpStartHour || dt.hour >= InpEndHour) return false;
   }
   return RiskAllowsNewOrders();
}

bool IsTrendValidForBuy()
{
   if(!InpUseTrendFilter) return true;
   if(CopyBuffer(g_emaHandle, 0, 0, 2, g_emaBuffer) < 2) return true;
   return (SymbolInfoDouble(g_actualSymbol, SYMBOL_ASK) > g_emaBuffer[0]);
}

bool IsTrendValidForSell()
{
   if(!InpUseTrendFilter) return true;
   if(CopyBuffer(g_emaHandle, 0, 0, 2, g_emaBuffer) < 2) return true;
   return (SymbolInfoDouble(g_actualSymbol, SYMBOL_BID) < g_emaBuffer[0]);
}

//+------------------------------------------------------------------+
//| ORDER EXECUTION                                                  |
//+------------------------------------------------------------------+
ulong PlacePendingOrder(ENUM_ORDER_TYPE orderType, double price, double sl)
{
   double ask = SymbolInfoDouble(g_actualSymbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(g_actualSymbol, SYMBOL_BID);

   if(orderType == ORDER_TYPE_BUY_STOP && price <= ask + g_minStopDist)
   {
      LogMessage("Buy Stop too close to Ask - skipped");
      return 0;
   }
   if(orderType == ORDER_TYPE_SELL_STOP && price >= bid - g_minStopDist)
   {
      LogMessage("Sell Stop too close to Bid - skipped");
      return 0;
   }

   MqlTradeRequest r = {};
   MqlTradeResult res = {};
   r.action      = TRADE_ACTION_PENDING;
   r.symbol      = g_actualSymbol;
   r.volume      = GetTradeLot();
   r.type        = orderType;
   r.price       = price;
   r.sl          = sl;
   r.deviation   = 30;
   r.magic       = InpMagicNumber;
   r.comment     = InpTradeComment;
   r.type_time   = ORDER_TIME_GTC;

   if(OrderSend(r, res) && (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED))
   {
      LogMessage(EnumToString(orderType) + " placed | Ticket: " + IntegerToString(res.order) +
                 " | Lot: " + DoubleToString(r.volume, g_lotDigits));
      return res.order;
   }

   LogMessage(EnumToString(orderType) + " FAILED | " + IntegerToString(res.retcode) + " | " + GetRetcodeDescription(res.retcode));
   return 0;
}

//+------------------------------------------------------------------+
void ModifyPendingOrder(ulong ticket, double newPrice, double newSL)
{
   MqlTradeRequest r = {};
   MqlTradeResult res = {};
   r.action = TRADE_ACTION_MODIFY;
   r.order  = ticket;
   r.price  = newPrice;
   r.sl     = newSL;

   if(!OrderSend(r, res))
      LogMessage("Modify failed " + IntegerToString(ticket) + " | " + GetRetcodeDescription(res.retcode));
}

//+------------------------------------------------------------------+
void DeletePendingOrder(ulong ticket)
{
   MqlTradeRequest r = {};
   MqlTradeResult res = {};
   r.action = TRADE_ACTION_REMOVE;
   r.order  = ticket;

   if(OrderSend(r, res))
      LogMessage("Pending order deleted | Ticket: " + IntegerToString(ticket));
   else
      LogMessage("Delete failed " + IntegerToString(ticket) + " | " + GetRetcodeDescription(res.retcode));
}

//+------------------------------------------------------------------+
void ModifyPositionSL(ulong ticket, double newSL, double tp)
{
   MqlTradeRequest r = {};
   MqlTradeResult res = {};
   r.action   = TRADE_ACTION_SLTP;
   r.position = ticket;
   r.symbol   = g_actualSymbol;
   r.sl       = NormalizeDouble(newSL, g_digits);
   r.tp       = tp;

   if(!OrderSend(r, res))
      LogMessage("SL modify failed | " + GetRetcodeDescription(res.retcode));
}

//+------------------------------------------------------------------+
void ClosePosition(ulong ticket)
{
   if(!PositionSelectByTicket(ticket)) return;

   MqlTradeRequest r = {};
   MqlTradeResult res = {};
   r.action   = TRADE_ACTION_DEAL;
   r.position = ticket;
   r.symbol   = g_actualSymbol;
   r.volume   = PositionGetDouble(POSITION_VOLUME);
   r.deviation= 30;
   r.magic    = InpMagicNumber;

   if((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY)
   { r.type = ORDER_TYPE_SELL; r.price = SymbolInfoDouble(g_actualSymbol, SYMBOL_BID); }
   else
   { r.type = ORDER_TYPE_BUY;  r.price = SymbolInfoDouble(g_actualSymbol, SYMBOL_ASK); }

   if(OrderSend(r, res))
      LogMessage("Position closed | Ticket: " + IntegerToString(ticket));
   else
      LogMessage("Close failed | " + GetRetcodeDescription(res.retcode));
}

//+------------------------------------------------------------------+
//| UTILITIES                                                        |
//+------------------------------------------------------------------+
void CheckNewDay()
{
   datetime today = StringToTime(TimeToString(TimeCurrent(), TIME_DATE));
   if(today != g_lastDay)
   {
      g_dailyStartBalance = AccountInfoDouble(ACCOUNT_BALANCE);
      g_lastDay = today;
   }
}

double GetATR()
{
   if(CopyBuffer(g_atrHandle, 0, 0, 1, g_atrBuffer) <= 0) return 0;
   return g_atrBuffer[0];
}

double GetOrderPrice(ulong ticket)
{
   if(!OrderSelect(ticket)) return 0;
   return OrderGetDouble(ORDER_PRICE_OPEN);
}

string GetRetcodeDescription(int retcode)
{
   switch(retcode)
   {
      case TRADE_RETCODE_REQUOTE:            return "Requote";
      case TRADE_RETCODE_INVALID_STOPS:      return "Invalid Stops";
      case TRADE_RETCODE_INVALID:            return "Invalid request";
      case TRADE_RETCODE_MARKET_CLOSED:      return "Market closed";
      case TRADE_RETCODE_NO_MONEY:           return "Not enough money";
      case TRADE_RETCODE_PRICE_CHANGED:      return "Price changed";
      case TRADE_RETCODE_PRICE_OFF:          return "Price off";
      case TRADE_RETCODE_TOO_MANY_REQUESTS:  return "Too many requests";
      case TRADE_RETCODE_NO_CHANGES:         return "No changes";
      case TRADE_RETCODE_CONNECTION:         return "No connection";
      case TRADE_RETCODE_TIMEOUT:            return "Timeout";
      default:                               return "Code " + IntegerToString(retcode);
   }
}

//+------------------------------------------------------------------+
#define DASH_NAME "UNI_DASH"
#define DASH_W    340
#define DASH_H    450

uint DC(const color c, const int a = 255) { return ColorToARGB(c, (uchar)a); }

void DashText(const int x, const int y, const string s, const color c, const int size = 13, const bool bold = false, const uint align = TA_LEFT | TA_TOP)
{
   g_cv.FontSet("Segoe UI", size, bold ? FW_BOLD : FW_NORMAL);
   g_cv.TextOut(x, y, s, DC(c), align);
}

void DashRow(const int y, const string label, const string value, const color vc)
{
   DashText(14, y, label, C'150,160,175');
   DashText(DASH_W - 14, y, value, vc, 13, true, TA_RIGHT | TA_TOP);
}

void DashSep(const int y, const string title)
{
   g_cv.FillRectangle(14, y + 8, 20, y + 9, DC(C'70,80,100'));
   DashText(26, y, title, C'110,170,255', 11, true);
   g_cv.FillRectangle(26 + 7 * StringLen(title) + 10, y + 8, DASH_W - 14, y + 9, DC(C'50,58,76'));
}

string Money(const double v) { return (v >= 0 ? "+" : "-") + "$" + DoubleToString(MathAbs(v), 2); }
color  PnlCol(const double v) { return v > 0 ? C'80,220,140' : (v < 0 ? C'255,100,100' : C'200,205,215'); }

bool DashAllowed()
{
   if(!InpShowDashboard) return false;
   if(MQLInfoInteger(MQL_TESTER))
      return (InpDashInTester && MQLInfoInteger(MQL_VISUAL_MODE));
   return true;
}

void DashCreate()
{
   if(!DashAllowed()) return;
   if(!g_cv.CreateBitmapLabel(0, 0, DASH_NAME, InpDashX, InpDashY, DASH_W, DASH_H, COLOR_FORMAT_ARGB_NORMALIZE))
   { Print("Dashboard could not be created: ", GetLastError()); return; }
   ObjectSetInteger(0, DASH_NAME, OBJPROP_CORNER, CORNER_LEFT_UPPER);
   ObjectSetInteger(0, DASH_NAME, OBJPROP_SELECTABLE, false);
   ObjectSetInteger(0, DASH_NAME, OBJPROP_HIDDEN, true);
   g_dashOn = true;
   EventSetTimer(1);
   DrawDash();
}

void OnTimer() { AT24Gate_Timer(InpLicenseKey); DrawDash(); }

// why the EA is not placing new orders right now ("" = nothing blocks it)
string BlockReason()
{
   if(InpUseSessionFilter)
   {
      MqlDateTime dt;
      TimeCurrent(dt);
      if(dt.day_of_week == 0 || dt.day_of_week == 6) return "weekend";
      if(InpAvoidFriday && dt.day_of_week == 5 && dt.hour >= InpFridayCloseHour) return "Friday cut-off";
      if(dt.hour < InpStartHour || dt.hour >= InpEndHour) return "outside session";
   }
   if(InpUseSpreadFilter && SymbolInfoInteger(g_actualSymbol, SYMBOL_SPREAD) > InpMaxSpreadPoints) return "spread too high";
   if(InpMaxDailyLossUSD > 0)
   {
      double totalPL = (AccountInfoDouble(ACCOUNT_BALANCE) - g_dailyStartBalance) + AccountInfoDouble(ACCOUNT_PROFIT);
      if(totalPL < -InpMaxDailyLossUSD) return "daily loss limit";
   }
   return "";
}

void DrawDash()
{
   if(!g_dashOn) return;
   static uint lastDraw = 0;
   uint nowMs = GetTickCount();
   if(nowMs - lastDraw < 400) return;
   lastDraw = nowMs;

   // open position of this EA
   int    nPos = 0; bool posBuy = false;
   double pLots = 0, pOpen = 0, pSL = 0, pPnl = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(PositionGetTicket(i) == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != g_actualSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagicNumber) continue;
      nPos++;
      posBuy = ((ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
      pLots += PositionGetDouble(POSITION_VOLUME);
      pOpen  = PositionGetDouble(POSITION_PRICE_OPEN);
      pSL    = PositionGetDouble(POSITION_SL);
      pPnl  += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
   }
   long   spread = SymbolInfoInteger(g_actualSymbol, SYMBOL_SPREAD);
   double bal    = AccountInfoDouble(ACCOUNT_BALANCE);
   double dayPL  = (bal - g_dailyStartBalance) + AccountInfoDouble(ACCOUNT_PROFIT);
   string block  = BlockReason();

   g_cv.Erase(DC(C'0,0,0', 0));
   g_cv.FillRectangle(0, 0, DASH_W - 1, DASH_H - 1, DC(C'16,20,30', 235));
   g_cv.Rectangle(0, 0, DASH_W - 1, DASH_H - 1, DC(C'60,72,98'));
   g_cv.FillRectangle(0, 0, DASH_W - 1, 30, DC(C'28,36,54'));
   DashText(14, 6, "UNIVERSAL TRAILING EA", C'235,240,250', 13, true);
   DashText(DASH_W - 14, 8, g_actualSymbol, C'150,160,175', 11, false, TA_RIGHT | TA_TOP);

   // ---- status
   string st; color sc;
   if(nPos > 0)                                  { st = (posBuy ? "BUY" : "SELL") + " TRADE OPEN"; sc = posBuy ? C'80,220,140' : C'255,120,120'; }
   else if(g_buyStopTicket > 0 || g_sellStopTicket > 0) { st = "STRADDLE WAITING"; sc = C'110,170,255'; }
   else if(block != "")                          { st = "PAUSED - " + block; sc = C'255,190,80'; }
   else                                          { st = "READY"; sc = C'110,170,255'; }
   int y = 40;
   DashText(14, y, st, sc, 13, true);

   // ---- trade
   y += 26;
   DashSep(y, "OPEN TRADE");
   if(nPos > 0)
   {
      double px = SymbolInfoDouble(g_actualSymbol, posBuy ? SYMBOL_BID : SYMBOL_ASK);
      y += 22; DashRow(y, "Lots / entry", StringFormat("%.2f  /  %s", pLots, DoubleToString(pOpen, g_digits)), C'235,240,250');
      y += 20; DashRow(y, "Floating P/L", Money(pPnl), PnlCol(pPnl));
      bool slProfit = (pSL > 0) && (posBuy ? pSL > pOpen : pSL < pOpen);
      y += 20; DashRow(y, "Stop loss", pSL > 0 ? DoubleToString(pSL, g_digits) + (slProfit ? "  (locked)" : "") : "none", slProfit ? C'80,220,140' : C'200,205,215');
      y += 20; DashRow(y, "SL distance", pSL > 0 ? StringFormat("%.0f pts", MathAbs(px - pSL) / g_pointValue) : "-", C'200,205,215');
   }
   else
   {
      y += 22; DashRow(y, "Lots / entry", "-", C'200,205,215');
      y += 20; DashRow(y, "Floating P/L", "-", C'200,205,215');
      y += 20; DashRow(y, "Stop loss", "-", C'200,205,215');
      y += 20; DashRow(y, "SL distance", "-", C'200,205,215');
   }

   // ---- pending orders
   y += 26;
   DashSep(y, "PENDING ORDERS");
   double bsP = g_buyStopTicket > 0 ? GetOrderPrice(g_buyStopTicket) : 0;
   double ssP = g_sellStopTicket > 0 ? GetOrderPrice(g_sellStopTicket) : 0;
   y += 22; DashRow(y, "Buy Stop", bsP > 0 ? DoubleToString(bsP, g_digits) : "none", bsP > 0 ? C'235,240,250' : C'120,130,145');
   y += 20; DashRow(y, "Sell Stop", ssP > 0 ? DoubleToString(ssP, g_digits) : "none", ssP > 0 ? C'235,240,250' : C'120,130,145');

   // ---- reversal
   y += 26;
   DashSep(y, "REVERSAL");
   y += 22; DashRow(y, "Status", InpUseReversal ? "ON" : "OFF", InpUseReversal ? C'80,220,140' : C'120,130,145');
   y += 20; DashRow(y, "Chain / max", StringFormat("%d  /  %d     total %d", g_revCount, InpMaxReversals, g_revTotal), C'235,240,250');
   y += 20; DashRow(y, "Reversal lot x", DoubleToString(InpReverseLotMult, 2), C'200,205,215');

   // ---- market and account
   y += 26;
   DashSep(y, "MARKET AND DAY");
   y += 22; DashRow(y, "ATR / spread", StringFormat("%s  /  %d pts", DoubleToString(GetATR(), g_digits), (int)spread),
                    (InpUseSpreadFilter && spread > InpMaxSpreadPoints) ? C'255,100,100' : C'235,240,250');
   y += 20; DashRow(y, "Next lot", DoubleToString(GetTradeLot(), g_lotDigits) + (InpUseCompounding ? "  (compounding)" : ""), C'235,240,250');
   y += 20; DashRow(y, "Today P/L", Money(dayPL) + (InpMaxDailyLossUSD > 0 ? StringFormat("   limit -$%.0f", InpMaxDailyLossUSD) : ""), PnlCol(dayPL));
   y += 20; DashRow(y, "Filters S/Sp/T", StringFormat("%s / %s / %s", InpUseSessionFilter ? "on" : "off", InpUseSpreadFilter ? "on" : "off", InpUseTrendFilter ? "on" : "off"), C'200,205,215');

   g_cv.Update();
}

//+------------------------------------------------------------------+
void LogMessage(string message)
{
   if(!g_isTestingMode || InpEnableLogging)
      Print(message);
}
//+------------------------------------------------------------------+
