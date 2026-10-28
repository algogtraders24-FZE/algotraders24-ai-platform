//+------------------------------------------------------------------+
//|                                      GoldBreakoutScalper_v112_licensed.mq5 |
//|  Breakout scalper for GOLD (XAUUSD) only. Fixed version of v1.00:  |
//|  chart symbol only, spread + commission + slippage aware, real    |
//|  trend filter, stale pending orders removed, modify throttling,   |
//|  broker filling/expiry/freeze handling, risk-capped lots.         |
//|  The stop logic is the original one: hard SL on the order,        |
//|  breakeven, then a trailing stop (now net of the trading costs).  |
//+------------------------------------------------------------------+
#property copyright "Original work"
#property version   "1.12"
#property strict

//--- AT24 licence gate: one key = one trading account, only for this product (the Strategy Tester needs no key)
#define AT24_PRODUCT_ID "GOLDBREAKOUTSCALPER"
#include "AT24_LicenseGate.mqh"
input string InpLicenseKey = "";   // AT24 licence key (from your AT24 purchase page)

#include <Trade\Trade.mqh>
#include <Canvas\Canvas.mqh>

//=== Enums ==========================================================
enum ENUM_LOT_MODE  { LOT_FIXED, LOT_AUTO };
enum ENUM_SR_MODE   { MODE_HIGH_FREQ, MODE_HIGH_PROB };

//=== Inputs ==========================================================
input group "=== Core Exit / Entry Distances (points, auto-scaled) ==="
input int    InpSL_Points        = 400;     // Hard Stop Loss (unchanged)
input int    InpTP_Points        = 10000;   // Take Profit (far - trailing does the real exit)
input int    InpTrail_Points     = 20;      // Trailing distance (never tighter than the cost floor below)
input int    InpMinShift_Points  = 0;       // Min distance of a pending order from price. 0 = automatic (stops level, 3 x trading cost)
input int    InpBreakEven_Points = 50;      // Move SL to breakeven once price moves this far in profit (0=off). Never below 2 x cost

input group "=== Trading costs (gold) ==="
input double InpCommissionPerLotUSD = 7.0;  // ROUND-TURN commission per 1 lot in USD (0 if the account has none)
input double InpSlippageAllowUSD    = 0.05; // slippage allowance per trade in price units (USD)
input double InpBELockExtraUSD      = 0.05; // breakeven stop sits at entry + spread + commission + this
input double InpMinATRtoCost        = 3.0;  // trade only if ATR(bar) >= this x total cost (spread + commission + slippage)

input group "=== Lot Sizing ==="
input ENUM_LOT_MODE InpLotMode   = LOT_AUTO;  // LOT_FIXED = the lot you type below | LOT_AUTO = grows with the account and shrinks with it
input double InpFixedLot         = 0.01;    // LOT_FIXED: lot of every trade
input double InpAutoLot          = 0.01;    // LOT_AUTO: this lot ...
input double InpAutoPerBalance   = 1000.0;  // ... for every this much money in the account (0.01 per 1000 -> 5000 gives 0.05, 500 gives the minimum lot)
input bool   InpAutoUseEquity    = false;   // LOT_AUTO: false = by balance, true = by equity
input double InpMaxLot           = 5.0;     // never more than this lot
input double InpMaxRiskPercent   = 5.0;     // safety cap: a trade whose hard SL would lose more than this % of equity is cut down, or skipped (0 = off). A 0.01 lot with the $4 SL risks $4 -> accounts under $80 need 0 here

input group "=== Structure & Timing ==="
input ENUM_SR_MODE InpMode       = MODE_HIGH_PROB; // HIGH_FREQ = both sides always, HIGH_PROB = trend + touch filtered
input int    InpSwingLookback    = 24;      // Bars scanned for swing high/low
input int    InpTouchLookback    = 100;     // Bars scanned for touch-count confirmation (HIGH_PROB)
input int    InpMinTouches       = 2;       // Min OTHER bars touching the level (HIGH_PROB)
input int    InpTouchTol_Points  = 300;     // How close a bar must get to the level to count as a touch
input int    InpTrendMA_Period   = 50;      // MA period for the trend filter (HIGH_PROB)
input ENUM_TIMEFRAMES InpTrendTF = PERIOD_M15; // Timeframe of the trend MA
input int    InpATRPeriod        = 14;
input int    InpPendingBars      = 3;       // A pending order lives this many bars (it is also rebuilt every bar)
input int    InpMaxPositions     = 2;       // Max simultaneous open positions (pending orders are removed when reached)

input group "=== Trailing Behavior ==="
input bool   InpTrailingSmart    = true;    // Widen trail distance with live spread + commission
input bool   InpHighProfitTrail  = false;   // Loosen trail once trade is well in profit to ride trend
input int    InpModifyMinSec     = 1;       // At most one stop modification per this many seconds
input double InpMinTrailStepFrac = 0.25;    // A trailing step must improve the stop by at least this fraction of the trail distance

input group "=== Filters / Safety ==="
input int    InpMaxSpread_Points = 100;     // Skip new entries if spread above this (and pull pending orders)
input bool   InpNewsFilter       = true;    // Block entries on abnormal spread spikes
input double InpSpreadSpikeMult  = 2.5;     // Spike = current spread > MultX average spread
input int    InpSessionStartHour = 1;       // Server hour from which new entries are allowed (0 and 24 = always)
input int    InpSessionEndHour   = 22;      // Server hour at which new entries stop (avoids the rollover spread)
input bool   InpFridayClose      = true;    // Close everything & stop trading before weekend
input int    InpFridayCloseHour  = 21;      // Server-time hour to flatten on Friday
input int    InpFridayNoNewHours = 2;       // No new entries this many hours before the Friday flat time
input bool   InpPanicClose       = true;    // Emergency close on abnormal gap vs last tick
input double InpPanicGapPoints   = 3000;    // Gap size (points) considered a panic event
input int    InpPanicBlockMin    = 5;       // No new entries for this many minutes after a panic
input int    InpCooldownSeconds  = 60;      // Pause new entries this long after a losing close
input int    InpMaxDeviation     = 30;      // Max slippage (points)
input long   InpMagic            = 990321;  // Magic number

input group "=== Dashboard ==="
input bool   InpShowDashboard    = true;    // chart panel
input int    InpDashX            = 10;
input int    InpDashY            = 30;
input bool   InpDashInTester     = false;   // false = no panel in the Strategy Tester (faster backtests); it only shows in visual mode anyway

//=== Globals =========================================================
CTrade   trade;
string   Sym;
double   Pt;
int      Scale = 1;
int      hATR = INVALID_HANDLE, hMA = INVALID_HANDLE;
bool     hedging = true;
datetime lastBarTime = 0, cooldownUntil = 0, panicUntil = 0, lastSpreadSec = 0, lastModTime = 0, modBackoff = 0;
double   avgSpread = 0.0, lastBid = 0.0;
int      statMods = 0, statModFail = 0, statSkipCost = 0, statSkipTrend = 0;

//--- helpers ---------------------------------------------------------
double P(const int pts) { return pts * Scale * Pt; }
double Spread()         { return SymbolInfoDouble(Sym, SYMBOL_ASK) - SymbolInfoDouble(Sym, SYMBOL_BID); }

double UsdPerLotPerUnit()
{
   double ts = SymbolInfoDouble(Sym, SYMBOL_TRADE_TICK_SIZE), tv = SymbolInfoDouble(Sym, SYMBOL_TRADE_TICK_VALUE);
   return ts > 0.0 ? tv / ts : SymbolInfoDouble(Sym, SYMBOL_TRADE_CONTRACT_SIZE);
}
double CommissionPrice() { return InpCommissionPerLotUSD > 0.0 ? InpCommissionPerLotUSD / UsdPerLotPerUnit() : 0.0; }
double CostNow()         { return Spread() + CommissionPrice() + InpSlippageAllowUSD; }   // one round trip in price units

bool Buf(const int handle, const int shift, double &v)
{
   if(handle == INVALID_HANDLE || BarsCalculated(handle) <= shift + 1) return false;
   double b[1];
   if(CopyBuffer(handle, 0, shift, 1, b) != 1) return false;
   v = b[0];
   return true;
}

//+------------------------------------------------------------------+
int OnInit()
{
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   Sym = _Symbol;                                   // GOLD ONLY: the chart symbol, nothing is auto-detected
   string up = Sym; StringToUpper(up);
   if(StringFind(up, "XAU") < 0 && StringFind(up, "GOLD") < 0)
   {
      Alert("GoldBreakoutScalper works on gold only (XAUUSD). Attach it to a gold chart.");
      return INIT_FAILED;
   }
   Pt = SymbolInfoDouble(Sym, SYMBOL_POINT);
   if(Pt <= 0.0) return INIT_FAILED;
   int digits = (int)SymbolInfoInteger(Sym, SYMBOL_DIGITS);
   Scale = (digits >= 3) ? 10 : 1;                  // inputs are written for 2-digit gold; 3-digit gold is scaled x10

   hedging = ((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE) == ACCOUNT_MARGIN_MODE_RETAIL_HEDGING);
   if(!hedging) Print("WARNING: netting account - only ONE position is allowed (opposite fills would net against each other)");

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpMaxDeviation);
   trade.SetTypeFillingBySymbol(Sym);               // the broker's own allowed filling mode

   hATR = iATR(Sym, _Period, InpATRPeriod);
   hMA  = iMA(Sym, InpTrendTF, InpTrendMA_Period, 0, MODE_SMA, PRICE_CLOSE);   // ONE persistent handle
   if(hATR == INVALID_HANDLE || hMA == INVALID_HANDLE) return INIT_FAILED;

   avgSpread = Spread(); lastBid = SymbolInfoDouble(Sym, SYMBOL_BID);
   PrintFormat("Lot now %.2f (%s) | min lot %.2f | the hard SL of a min lot risks %.2f USD = %.1f%% of equity",
               CalcLot(), InpLotMode == LOT_AUTO ? "auto" : "manual", SymbolInfoDouble(Sym, SYMBOL_VOLUME_MIN),
               SymbolInfoDouble(Sym, SYMBOL_VOLUME_MIN) * P(InpSL_Points) * UsdPerLotPerUnit(),
               SymbolInfoDouble(Sym, SYMBOL_VOLUME_MIN) * P(InpSL_Points) * UsdPerLotPerUnit() / MathMax(1.0, AccountInfoDouble(ACCOUNT_EQUITY)) * 100.0);
   dashOn = InpShowDashboard && (!MQLInfoInteger(MQL_TESTER) || (InpDashInTester && MQLInfoInteger(MQL_VISUAL_MODE)));
   EventSetTimer(1);
   if(dashOn && !Dash_Init()) dashOn = false;
   PrintFormat("GoldBreakoutScalper v1.12 | %s digits=%d scale=x%d | cost now: spread %.2f + commission %.2f + slippage %.2f = %.2f USD | %s | %s",
               Sym, digits, Scale, Spread(), CommissionPrice(), InpSlippageAllowUSD, CostNow(), InpMode == MODE_HIGH_PROB ? "HIGH_PROB" : "HIGH_FREQ", hedging ? "hedging" : "netting");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   Dash_Deinit();
   EventKillTimer();
   if(hATR != INVALID_HANDLE) IndicatorRelease(hATR);
   if(hMA  != INVALID_HANDLE) IndicatorRelease(hMA);
   PrintFormat("GBSSTAT stopModifies=%d failed=%d skippedCost=%d skippedTrend=%d", statMods, statModFail, statSkipCost, statSkipTrend);
}

//+------------------------------------------------------------------+
void OnTick()
{
   if(SymbolInfoDouble(Sym, SYMBOL_BID) <= 0.0) return;

   if(InpPanicClose && PanicGapDetected())
   {
      CloseAllPositions();
      CancelAllPendingOrders();
      panicUntil = TimeCurrent() + InpPanicBlockMin * 60;
      return;
   }
   if(InpFridayClose && IsFridayFlatTime())
   {
      CloseAllPositions();
      CancelAllPendingOrders();
      return;
   }

   UpdateSpreadAverage();
   ManagePositions();                                       // open trades are always managed
   if(!AT24Gate_Allowed())
   {
      if(CountPending() > 0) CancelAllPendingOrders();       // no valid licence: no new trades
      return;
   }

   // pending orders must not stand through a spread spike or when the position limit is reached
   if(CountPending() > 0 && (!SpreadOK() || (InpNewsFilter && SpreadSpike()) || CountPositions() >= EffectiveMaxPositions()))
      CancelAllPendingOrders();

   datetime bt = iTime(Sym, _Period, 0);
   if(bt != lastBarTime)
   {
      lastBarTime = bt;
      RefreshPendingOrders();
   }
}

//+------------------------------------------------------------------+
//| Spread tracking: TIME based average (one sample per second)       |
//+------------------------------------------------------------------+
void UpdateSpreadAverage()
{
   datetime s = TimeCurrent();
   if(s == lastSpreadSec) return;
   lastSpreadSec = s;
   double cur = Spread();
   avgSpread = (avgSpread <= 0.0) ? cur : (avgSpread * 0.98 + cur * 0.02);   // ~50 seconds of memory
}
bool SpreadSpike() { return avgSpread > 0.0 && Spread() > avgSpread * InpSpreadSpikeMult; }
bool SpreadOK()    { return SymbolInfoInteger(Sym, SYMBOL_SPREAD) <= (long)InpMaxSpread_Points * Scale; }

bool PanicGapDetected()
{
   double bid = SymbolInfoDouble(Sym, SYMBOL_BID);
   if(lastBid <= 0.0) { lastBid = bid; return false; }
   bool panic = MathAbs(bid - lastBid) >= P((int)InpPanicGapPoints);
   lastBid = bid;
   return panic;
}

bool IsFridayFlatTime()
{
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   return (t.day_of_week == 5 && t.hour >= InpFridayCloseHour);
}
bool FridayNoNew()
{
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   return (t.day_of_week == 5 && t.hour >= InpFridayCloseHour - InpFridayNoNewHours);
}
bool InSession()
{
   if(InpSessionStartHour <= 0 && InpSessionEndHour >= 24) return true;
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   return (t.hour >= InpSessionStartHour && t.hour < InpSessionEndHour);
}
int EffectiveMaxPositions() { return hedging ? InpMaxPositions : 1; }

//+------------------------------------------------------------------+
//| Stop modification: throttled, freeze-level aware, with back-off   |
//+------------------------------------------------------------------+
bool CanModify() { datetime n = TimeCurrent(); return n >= modBackoff && n - lastModTime >= InpModifyMinSec; }

bool FreezeOK(const double price, const double curSL, const double newSL)
{
   double fz = SymbolInfoInteger(Sym, SYMBOL_TRADE_FREEZE_LEVEL) * Pt;
   if(fz <= 0.0) return true;
   if(curSL > 0.0 && MathAbs(price - curSL) <= fz) return false;
   return MathAbs(price - newSL) > fz;
}

bool ModifyStop(const ulong ticket, const double sl, const double tp)
{
   bool ok = trade.PositionModify(ticket, sl, tp);
   lastModTime = TimeCurrent();
   if(ok) { statMods++; return true; }
   statModFail++;
   uint rc = trade.ResultRetcode();
   if(rc == TRADE_RETCODE_TOO_MANY_REQUESTS || rc == TRADE_RETCODE_FROZEN || rc == TRADE_RETCODE_INVALID_STOPS)
      modBackoff = TimeCurrent() + 3;                // back off instead of hammering the broker
   PrintFormat("PositionModify failed ticket=%I64u retcode=%u (%s)", ticket, rc, trade.ResultRetcodeDescription());
   return false;
}

//+------------------------------------------------------------------+
//| Manage open positions: breakeven (net of costs), trailing exit    |
//+------------------------------------------------------------------+
void ManagePositions()
{
   int    dg       = (int)SymbolInfoInteger(Sym, SYMBOL_DIGITS);
   double spread   = Spread();
   double comm     = CommissionPrice();
   double cost     = spread + comm + InpSlippageAllowUSD;
   double trail    = P(InpTrail_Points);
   if(InpTrailingSmart) trail = MathMax(trail, spread * 1.5 + comm);        // never trail inside spread + commission
   double stopLvl  = SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL) * Pt;
   double minDist  = MathMax(trail, stopLvl + Pt);
   double be       = InpBreakEven_Points > 0 ? MathMax(P(InpBreakEven_Points), 2.0 * cost) : 0.0;   // BE trigger is never below 2 x cost
   double lockOff  = spread + comm + InpBELockExtraUSD;                      // BE stop = entry + what the trade has cost us
   double stepMin  = MathMax(trail * InpMinTrailStepFrac, 2.0 * Pt);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != Sym) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;

      long   type  = PositionGetInteger(POSITION_TYPE);
      double open  = PositionGetDouble(POSITION_PRICE_OPEN);
      double curSL = PositionGetDouble(POSITION_SL);
      double curTP = PositionGetDouble(POSITION_TP);
      double dist  = minDist;
      double want;

      if(type == POSITION_TYPE_BUY)
      {
         double bid = SymbolInfoDouble(Sym, SYMBOL_BID);
         double profitDist = bid - open;
         double lockSL = NormalizeDouble(open + lockOff, dg);

         if(be > 0.0 && profitDist >= be && curSL < lockSL - Pt)               // breakeven that really is break-even
         {
            if(bid - lockSL >= minDist && CanModify() && FreezeOK(bid, curSL, lockSL)) ModifyStop(ticket, lockSL, curTP);
            continue;
         }
         if(InpHighProfitTrail && profitDist > trail * 5.0) dist = MathMax(trail * 2.0, minDist);
         want = NormalizeDouble(bid - MathMax(trail, dist), dg);
         if(want < lockSL) continue;                                           // the trail only works above the cost-covering level
         if(want < curSL + stepMin) continue;                                  // minimum improvement per modification
         if(CanModify() && FreezeOK(bid, curSL, want)) ModifyStop(ticket, want, curTP);
      }
      else
      {
         double ask = SymbolInfoDouble(Sym, SYMBOL_ASK);
         double profitDist = open - ask;
         double lockSL = NormalizeDouble(open - lockOff, dg);

         if(be > 0.0 && profitDist >= be && (curSL == 0.0 || curSL > lockSL + Pt))
         {
            if(lockSL - ask >= minDist && CanModify() && FreezeOK(ask, curSL, lockSL)) ModifyStop(ticket, lockSL, curTP);
            continue;
         }
         if(InpHighProfitTrail && profitDist > trail * 5.0) dist = MathMax(trail * 2.0, minDist);
         want = NormalizeDouble(ask + MathMax(trail, dist), dg);
         if(want > lockSL) continue;
         if(curSL > 0.0 && want > curSL - stepMin) continue;
         if(CanModify() && FreezeOK(ask, curSL, want)) ModifyStop(ticket, want, curTP);
      }
   }
}

//+------------------------------------------------------------------+
//| Entry permission: session, spread, cost vs volatility, cool-downs |
//+------------------------------------------------------------------+
string BlockReason()                                         // "" = entries allowed
{
   if(!AT24Gate_Allowed())          return "licence not valid";
   datetime n = TimeCurrent();
   if(n < panicUntil)               return "panic pause";
   if(n < cooldownUntil)            return "cooldown after a loss";
   if(FridayNoNew())                return "Friday - no new entries";
   if(!InSession())                 return "outside session hours";
   if(!SpreadOK())                  return "spread too wide";
   if(InpNewsFilter && SpreadSpike()) return "spread spike";
   if(CalcLot() <= 0.0)             return "lot 0: account too small for the risk cap";
   double atr;
   if(!Buf(hATR, 1, atr))           return "ATR not ready";
   if(atr < InpMinATRtoCost * CostNow()) return "cost too high vs ATR";
   return "";
}

string lastReasonPrinted = "";
bool EntryAllowed()
{
   string r = BlockReason();
   if(r != lastReasonPrinted) { lastReasonPrinted = r; Print(r == "" ? "Entries allowed" : "Entries blocked: " + r); }
   if(r == "cost too high vs ATR") statSkipCost++;
   return r == "";
}

// does the higher-timeframe MA agree with a trade in this direction?
bool TrendOK(const bool isBuy)
{
   double ma1, ma2;
   if(!Buf(hMA, 1, ma1) || !Buf(hMA, 2, ma2)) return false;                    // not ready = no trade (not "fail-open")
   double c = iClose(Sym, InpTrendTF, 1);
   bool ok = isBuy ? (c > ma1 && ma1 >= ma2) : (c < ma1 && ma1 <= ma2);
   if(!ok) statSkipTrend++;
   return ok;
}

// other bars (the bar that made the level is skipped) that came back to the level
int TouchCount(const double level, const bool isHigh, const int skipShift)
{
   int touches = 0;
   double tol = P(InpTouchTol_Points);
   for(int i = 1; i <= InpTouchLookback; i++)
   {
      if(i == skipShift) continue;
      double v = isHigh ? iHigh(Sym, _Period, i) : iLow(Sym, _Period, i);
      if(MathAbs(v - level) <= tol) touches++;
   }
   return touches;
}

//+------------------------------------------------------------------+
//| Rebuild the breakout stop orders every bar (old ones are removed) |
//+------------------------------------------------------------------+
void RefreshPendingOrders()
{
   CancelAllPendingOrders();                                   // stale levels never survive a bar
   if(CountPositions() >= EffectiveMaxPositions()) return;
   if(!EntryAllowed()) return;

   int neededBars = MathMax(InpSwingLookback, InpTouchLookback) + 2;
   if(Bars(Sym, _Period) < neededBars) return;

   int hi = iHighest(Sym, _Period, MODE_HIGH, InpSwingLookback, 1);
   int lo = iLowest (Sym, _Period, MODE_LOW,  InpSwingLookback, 1);
   if(hi < 0 || lo < 0) return;
   double swingHigh = iHigh(Sym, _Period, hi);
   double swingLow  = iLow (Sym, _Period, lo);

   bool wantBuy = true, wantSell = true;
   if(InpMode == MODE_HIGH_PROB)
   {
      wantBuy  = TouchCount(swingHigh, true,  hi) >= InpMinTouches && TrendOK(true);
      wantSell = TouchCount(swingLow,  false, lo) >= InpMinTouches && TrendOK(false);
   }
   if(!wantBuy && !wantSell) return;

   double ask = SymbolInfoDouble(Sym, SYMBOL_ASK), bid = SymbolInfoDouble(Sym, SYMBOL_BID);
   double cost = CostNow();
   double stopLvl = SymbolInfoInteger(Sym, SYMBOL_TRADE_STOPS_LEVEL) * Pt;
   double minShift = InpMinShift_Points > 0 ? P(InpMinShift_Points) : MathMax(stopLvl + Pt, 3.0 * cost);
   double slDist = P(InpSL_Points);
   if(slDist < 3.0 * cost) { statSkipCost++; return; }         // a stop that small would be hit by costs alone

   double lot = CalcLot();
   if(lot <= 0.0) return;

   int dg = (int)SymbolInfoInteger(Sym, SYMBOL_DIGITS);
   // order type / expiry as the broker allows
   long expMode = SymbolInfoInteger(Sym, SYMBOL_EXPIRATION_MODE);
   ENUM_ORDER_TYPE_TIME tmode = ORDER_TIME_GTC; datetime expiry = 0;
   if((expMode & SYMBOL_EXPIRATION_SPECIFIED) != 0) { tmode = ORDER_TIME_SPECIFIED; expiry = TimeCurrent() + (datetime)(PeriodSeconds(_Period) * InpPendingBars + 60); }
   else if((expMode & SYMBOL_EXPIRATION_DAY) != 0)  { tmode = ORDER_TIME_DAY; }

   if(wantBuy)
   {
      double buyPrice = NormalizeDouble(MathMax(swingHigh, ask + minShift), dg);
      double sl = NormalizeDouble(buyPrice - slDist, dg), tp = NormalizeDouble(buyPrice + P(InpTP_Points), dg);
      if(!trade.BuyStop(lot, buyPrice, Sym, sl, tp, tmode, expiry, "GBS breakout"))
         PrintFormat("BuyStop failed retcode=%u (%s) price=%.2f sl=%.2f tp=%.2f", trade.ResultRetcode(), trade.ResultRetcodeDescription(), buyPrice, sl, tp);
   }
   if(wantSell)
   {
      double sellPrice = NormalizeDouble(MathMin(swingLow, bid - minShift), dg);
      double sl = NormalizeDouble(sellPrice + slDist, dg), tp = NormalizeDouble(sellPrice - P(InpTP_Points), dg);
      if(!trade.SellStop(lot, sellPrice, Sym, sl, tp, tmode, expiry, "GBS breakout"))
         PrintFormat("SellStop failed retcode=%u (%s) price=%.2f sl=%.2f tp=%.2f", trade.ResultRetcode(), trade.ResultRetcodeDescription(), sellPrice, sl, tp);
   }
}

//+------------------------------------------------------------------+
//| Lot: by balance, then cut to the risk cap; below the minimum lot  |
//| the trade is SKIPPED (never rounded up into more risk)            |
//+------------------------------------------------------------------+
double CalcLot()
{
   double step = SymbolInfoDouble(Sym, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(Sym, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(Sym, SYMBOL_VOLUME_MAX);
   if(step <= 0.0) return 0.0;

   double lot;
   if(InpLotMode == LOT_FIXED) lot = InpFixedLot;
   else
   {
      if(InpAutoPerBalance <= 0.0) return 0.0;
      double money = InpAutoUseEquity ? AccountInfoDouble(ACCOUNT_EQUITY) : AccountInfoDouble(ACCOUNT_BALANCE);
      lot = InpAutoLot * money / InpAutoPerBalance;                           // account up -> lot up, account down -> lot down
   }
   lot = MathMin(lot, InpMaxLot);

   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskPerLot = P(InpSL_Points) * UsdPerLotPerUnit();                  // USD lost at the hard SL per 1 lot
   double cap = (InpMaxRiskPercent > 0.0 && riskPerLot > 0.0) ? equity * InpMaxRiskPercent / 100.0 / riskPerLot : 1e9;
   lot = MathMin(lot, cap);

   lot = MathFloor(lot / step + 1e-9) * step;
   lot = NormalizeDouble(lot, (int)MathMax(0.0, MathCeil(-MathLog10(step) - 1e-9)));
   if(lot < vmin)                                                             // below the broker minimum
   {
      if(vmin > cap + 1e-9) return 0.0;                                       // even the minimum lot is more risk than allowed: no trade
      lot = vmin;                                                             // otherwise trade the minimum lot
   }
   return MathMin(vmax, lot);
}

//+------------------------------------------------------------------+
int CountPositions()
{
   int n = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == Sym && PositionGetInteger(POSITION_MAGIC) == InpMagic) n++;
   }
   return n;
}

int CountPending()
{
   int n = 0;
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) == Sym && OrderGetInteger(ORDER_MAGIC) == InpMagic) n++;
   }
   return n;
}

//+------------------------------------------------------------------+
void CloseAllPositions()
{
   for(int pass = 0; pass < 3 && CountPositions() > 0; pass++)               // retry: a close can be rejected on a fast market
   {
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         if(PositionGetString(POSITION_SYMBOL) != Sym) continue;
         if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
         if(!trade.PositionClose(ticket, InpMaxDeviation))
            PrintFormat("PositionClose failed ticket=%I64u retcode=%u (%s)", ticket, trade.ResultRetcode(), trade.ResultRetcodeDescription());
      }
      if(CountPositions() > 0) Sleep(200);
   }
}

void CancelAllPendingOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetString(ORDER_SYMBOL) != Sym) continue;
      if(OrderGetInteger(ORDER_MAGIC) != InpMagic) continue;
      trade.OrderDelete(ticket);
   }
}

//+------------------------------------------------------------------+
//| On fill: remove the other pending orders. After a losing close    |
//| start the cool-down.                                              |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
   if(trans.symbol != Sym) return;
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if(HistoryDealGetInteger(trans.deal, DEAL_MAGIC) != InpMagic) return;

   long entry = HistoryDealGetInteger(trans.deal, DEAL_ENTRY);
   if(entry == DEAL_ENTRY_IN)
      CancelAllPendingOrders();
   else if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY)
   {
      double profit = HistoryDealGetDouble(trans.deal, DEAL_PROFIT) + HistoryDealGetDouble(trans.deal, DEAL_SWAP) + HistoryDealGetDouble(trans.deal, DEAL_COMMISSION);
      if(profit < 0.0 && InpCooldownSeconds > 0) cooldownUntil = TimeCurrent() + InpCooldownSeconds;
   }
}
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| DASHBOARD (canvas). Refreshed once per second from OnTimer, never |
//| from OnTick. Off in the Strategy Tester unless InpDashInTester.   |
//+------------------------------------------------------------------+
CCanvas  cv;
bool     dashOn = false;
double   dashTodayPL = 0.0;
datetime dashTodayAt = 0;
const int DW = 372, DH = 488;

uint RGBA(const int r, const int g, const int b, const int a = 255) { return ((uint)a << 24) | ((uint)r << 16) | ((uint)g << 8) | (uint)b; }
uint cBG()    { return RGBA(12, 17, 30); }
uint cCard()  { return RGBA(21, 29, 48); }
uint cGold()  { return RGBA(255, 196, 64); }
uint cGreen() { return RGBA(46, 204, 113); }
uint cRed()   { return RGBA(231, 76, 60); }
uint cText()  { return RGBA(236, 240, 248); }
uint cDim()   { return RGBA(139, 154, 184); }

bool Dash_Init()
{
   if(!cv.CreateBitmapLabel(0, 0, "GBS_DASH", InpDashX, InpDashY, DW, DH, COLOR_FORMAT_ARGB_NORMALIZE)) return false;
   ObjectSetInteger(0, "GBS_DASH", OBJPROP_CORNER, CORNER_LEFT_UPPER);
   return true;
}
void Dash_Deinit() { if(dashOn) cv.Destroy(); ObjectsDeleteAll(0, "GBS_"); }

void Tx(const int x, const int y, const string s, const uint col, const int size = -90, const bool bold = false, const uint al = TA_LEFT | TA_TOP)
{
   cv.FontSet("Segoe UI", size, bold ? FW_BOLD : FW_NORMAL);
   cv.TextOut(x, y, s, col, al);
}
void Card(const int x, const int y, const int w, const int h, const string title)
{
   cv.FillRectangle(x, y, x + w, y + h, cCard());
   cv.FillRectangle(x, y, x + 3, y + h, cGold());
   Tx(x + 12, y + 5, title, cGold(), -80, true);
}
void Row(const int x, const int y, const string k, const string v, const uint col)
{
   Tx(x + 12, y, k, cDim());
   Tx(x + 340, y, v, col, -90, true, TA_RIGHT | TA_TOP);
}

double TodayClosedPL()
{
   if(TimeCurrent() - dashTodayAt < 5) return dashTodayPL;                 // cached for 5 seconds
   dashTodayAt = TimeCurrent();
   datetime d0 = TimeCurrent() - (TimeCurrent() % 86400);
   double s = 0;
   if(HistorySelect(d0, TimeCurrent() + 60))
      for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
      {
         ulong tk = HistoryDealGetTicket(i);
         if(tk == 0 || HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic || HistoryDealGetString(tk, DEAL_SYMBOL) != Sym) continue;
         if(HistoryDealGetInteger(tk, DEAL_ENTRY) == DEAL_ENTRY_IN) continue;
         s += HistoryDealGetDouble(tk, DEAL_PROFIT) + HistoryDealGetDouble(tk, DEAL_SWAP) + HistoryDealGetDouble(tk, DEAL_COMMISSION);
      }
   dashTodayPL = s;
   return s;
}

string Money(const double v) { return (v >= 0 ? "+" : "") + DoubleToString(v, 2); }

void Dash_Update()
{
   if(!dashOn) return;
   cv.Erase(cBG());
   int x = 8, w = DW - 16;

   // header
   cv.FillRectangle(0, 0, DW, 46, cCard());
   cv.FillRectangle(0, 0, DW, 3, cGold());
   Tx(14, 8, "GOLD BREAKOUT SCALPER  v1.12", cGold(), -110, true);
   Tx(14, 28, Sym + "  |  " + EnumToString((ENUM_TIMEFRAMES)_Period) + "  |  " + (hedging ? "hedging" : "NETTING") + "  |  " + (string)InpMagic, cDim(), -80);
   string why = BlockReason();
   bool open = (why == "");
   cv.FillRectangle(DW - 128, 12, DW - 10, 34, open ? RGBA(24, 94, 56) : RGBA(110, 36, 30));
   Tx(DW - 69, 15, open ? "ENTRIES ON" : "ENTRIES OFF", open ? cGreen() : cRed(), -80, true, TA_CENTER | TA_TOP);
   int y = 52;

   // account
   double bal = AccountInfoDouble(ACCOUNT_BALANCE), eq = AccountInfoDouble(ACCOUNT_EQUITY), fl = eq - bal, tp = TodayClosedPL();
   Card(x, y, w, 106, "ACCOUNT");
   Row(x, y + 22, "Balance", DoubleToString(bal, 2), cText());
   Row(x, y + 40, "Equity", DoubleToString(eq, 2), cText());
   Row(x, y + 58, "Floating P/L", Money(fl), fl >= 0 ? cGreen() : cRed());
   Row(x, y + 74 - 2, "Closed today", Money(tp), tp >= 0 ? cGreen() : cRed());
   Row(x, y + 90, "Next trade lot  (" + (InpLotMode == LOT_AUTO ? "auto" : "manual") + ")", DoubleToString(CalcLot(), 2), cGold());
   y += 112;

   // positions
   int np = CountPositions(), nq = CountPending();
   Card(x, y, w, 112, "POSITIONS  " + (string)np + "/" + (string)EffectiveMaxPositions() + "   |   PENDING " + (string)nq);
   int row = 0;
   double lockOff = Spread() + CommissionPrice() + InpBELockExtraUSD;
   for(int i = PositionsTotal() - 1; i >= 0 && row < 4; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || PositionGetString(POSITION_SYMBOL) != Sym || PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      bool buy = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY;
      double pl = PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP), o = PositionGetDouble(POSITION_PRICE_OPEN), sl = PositionGetDouble(POSITION_SL);
      string st = "SL initial";
      if(sl > 0 && (buy ? sl >= o + lockOff - Pt : sl <= o - lockOff + Pt)) st = "SL locked / trailing";
      Tx(x + 12, y + 22 + row * 20, (buy ? "BUY  " : "SELL ") + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2) + "  @ " + DoubleToString(o, 2), buy ? cGreen() : cRed());
      Tx(x + 200, y + 22 + row * 20, st, cDim(), -80);
      Tx(x + 340, y + 22 + row * 20, Money(pl), pl >= 0 ? cGreen() : cRed(), -90, true, TA_RIGHT | TA_TOP);
      row++;
   }
   if(row == 0) Tx(x + 12, y + 24, "no open position", cDim());
   y += 118;

   // market + cost
   double atr = 0; Buf(hATR, 1, atr);
   double cost = CostNow(), ratio = cost > 0 ? atr / cost : 0;
   Card(x, y, w, 108, "MARKET AND COST (price units, USD)");
   Row(x, y + 22, "Spread  /  max", DoubleToString(Spread(), 2) + "  /  " + DoubleToString(P(InpMaxSpread_Points), 2), SpreadOK() ? cGreen() : cRed());
   Row(x, y + 40, "Commission  +  slippage", DoubleToString(CommissionPrice(), 2) + "  +  " + DoubleToString(InpSlippageAllowUSD, 2), cText());
   Row(x, y + 58, "Total cost per trade", DoubleToString(cost, 2), cGold());
   Row(x, y + 76, "ATR  /  cost  (need " + DoubleToString(InpMinATRtoCost, 1) + ")", DoubleToString(atr, 2) + "  /  " + DoubleToString(ratio, 1) + "x", ratio >= InpMinATRtoCost ? cGreen() : cRed());
   y += 114;

   // filters
   double ma1 = 0, ma2 = 0; bool maOk = Buf(hMA, 1, ma1) && Buf(hMA, 2, ma2);
   string trend = !maOk ? "n/a" : (iClose(Sym, InpTrendTF, 1) > ma1 && ma1 >= ma2 ? "UP" : (iClose(Sym, InpTrendTF, 1) < ma1 && ma1 <= ma2 ? "DOWN" : "FLAT"));
   Card(x, y, w, 108, "FILTERS");
   Row(x, y + 22, "Why " + (open ? "trading" : "blocked"), open ? "all clear" : why, open ? cGreen() : cRed());
   Row(x, y + 40, "Trend (" + EnumToString(InpTrendTF) + " MA" + (string)InpTrendMA_Period + ")", trend, trend == "UP" ? cGreen() : (trend == "DOWN" ? cRed() : cDim()));
   Row(x, y + 58, "Session " + (string)InpSessionStartHour + ":00 - " + (string)InpSessionEndHour + ":00", InSession() ? "inside" : "outside", InSession() ? cGreen() : cRed());
   long cd = (long)MathMax(0, (double)(cooldownUntil - TimeCurrent()));
   Row(x, y + 76, "Cooldown / panic pause", (string)cd + " s  /  " + (TimeCurrent() < panicUntil ? "ON" : "off"), cd > 0 || TimeCurrent() < panicUntil ? cRed() : cText());
   y += 114;

   // stats
   Card(x, y, w, 54, "STOP MODIFICATIONS");
   Row(x, y + 22, "done  /  rejected  |  skipped: cost  /  trend", (string)statMods + " / " + (string)statModFail + "  |  " + (string)statSkipCost + " / " + (string)statSkipTrend, cText());

   cv.Update();
}

void OnTimer() { AT24Gate_Timer(InpLicenseKey); Dash_Update(); }
