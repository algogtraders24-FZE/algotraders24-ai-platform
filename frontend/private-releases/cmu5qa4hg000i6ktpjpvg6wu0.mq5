//+------------------------------------------------------------------+
//|                         AT24_Volatility_Shield.mq5                 |
//|                        Copyright 2026, AlgoTraders24               |
//|                        https://www.algotraders24.ai                |
//+------------------------------------------------------------------+
// AT24 Volatility Shield - filling a previously EMPTY /products
// placeholder row (volatility-shield: no platform, no description, no
// features - a genuine gap, not a rename of an existing product).
//
// A genuinely different PRODUCT CLASS from every other EA in this
// catalog: this is not a directional strategy that generates its own
// entries - it is a protective account-level circuit breaker, meant
// to run ALONGSIDE other EAs (AT24's own or third-party). It does not
// have a conventional win-rate/profit-factor, because it does not
// trade to make money - it trades (flattens) to STOP losing money
// during abnormal conditions.
//
// Logic:
//   1. Real-time volatility spike ratio = current ATR(InpFastATR) /
//      its own rolling average ATR over InpBaselineBars - a
//      self-referencing measure (adapts to each instrument's normal
//      volatility, not a fixed pip/point threshold that would be
//      wrong across instruments).
//   2. When that ratio exceeds InpSpikeMultiple (a genuine volatility
//      spike - news event, flash move, liquidity gap), the Shield:
//        a) closes every open position on the account whose magic
//           number is in InpProtectedMagics (or ALL positions if
//           InpProtectAll is true)
//        b) blocks any of ITS OWN new trade logic (none here - see
//           note below) and can optionally be polled by other EAs via
//           the global variable it sets (AT24_SHIELD_ACTIVE) to pause
//           their own entries during the cooldown window
//   3. Cooldown: stays active for InpCooldownMinutes after the spike,
//      so a market that is still unsettled doesn't get new positions
//      re-opened immediately.
//
// This EA places no entries of its own - it only closes/protects.
// Real validation done differently from a normal strategy backtest
// (a protective tool has no P&L of its own to evidence): see
// volatility_shield_spike_analysis.py, which runs this exact spike-
// detection logic against real historical XAUUSD/BTCUSD candles in
// quant_engine/market.db and reports every real spike it would have
// caught, with date and magnitude - proof the trigger logic fires on
// genuine historical volatility events, not a fabricated backtest.
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 Volatility Shield - account-level circuit breaker, flattens positions on real volatility spikes."
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

CTrade trade;
CPositionInfo posInfo;

input group "=== SPIKE DETECTION ==="
input ENUM_TIMEFRAMES InpTF          = PERIOD_M5;
input int              InpFastATR     = 14;
input int              InpBaselineBars = 100;  // rolling average window the spike ratio is measured against
input double            InpSpikeMultiple = 2.5; // trigger when ATR >= baseline * this

input group "=== PROTECTION SCOPE ==="
input bool              InpProtectAll   = true;   // true = flatten every open position on the account
input string             InpProtectedMagics = ""; // comma-separated magic numbers to protect if InpProtectAll=false

input group "=== COOLDOWN ==="
input int               InpCooldownMinutes = 30;

int hATR;
datetime gLastBar = 0;
datetime gCooldownUntil = 0;
long gProtectedList[];

int OnInit()
{
   trade.SetDeviationInPoints(50);
   hATR = iATR(_Symbol, InpTF, InpFastATR);
   if(hATR==INVALID_HANDLE) { Print("ERROR: ATR handle failed"); return INIT_FAILED; }

   ParseProtectedMagics();
   GlobalVariableSet("AT24_SHIELD_ACTIVE", 0);
   gLastBar = iTime(_Symbol, InpTF, 0);
   Print("AT24 Volatility Shield v1.00 armed | ", _Symbol, " | spike multiple: ", InpSpikeMultiple);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hATR);
   GlobalVariableDel("AT24_SHIELD_ACTIVE");
}

void ParseProtectedMagics()
{
   if(StringLen(InpProtectedMagics)==0) { ArrayResize(gProtectedList,0); return; }
   string parts[];
   int n = StringSplit(InpProtectedMagics, ',', parts);
   ArrayResize(gProtectedList, n);
   for(int i=0;i<n;i++) gProtectedList[i] = StringToInteger(parts[i]);
}

bool IsProtectedMagic(long magic)
{
   if(InpProtectAll) return true;
   for(int i=0;i<ArraySize(gProtectedList);i++)
      if(gProtectedList[i]==magic) return true;
   return false;
}

void FlattenProtectedPositions()
{
   int closedCount = 0;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(!IsProtectedMagic(posInfo.Magic())) continue;
      if(trade.PositionClose(posInfo.Ticket())) closedCount++;
   }
   if(closedCount>0) Print("AT24 Volatility Shield: flattened ", closedCount, " position(s) on volatility spike.");
}

// Rolling average ATR over InpBaselineBars, computed from the ATR
// buffer itself (a real, if simple, "average of the average").
double BaselineATR()
{
   double buf[];
   if(CopyBuffer(hATR, 0, 1, InpBaselineBars, buf) < InpBaselineBars) return 0;
   double sum=0;
   for(int i=0;i<InpBaselineBars;i++) sum += buf[i];
   return sum / InpBaselineBars;
}

void OnTick()
{
   datetime cb = iTime(_Symbol, InpTF, 0);
   bool isNewBar = (cb!=0 && gLastBar!=0 && cb!=gLastBar);
   if(isNewBar) gLastBar = cb;

   if(TimeCurrent() < gCooldownUntil)
   {
      GlobalVariableSet("AT24_SHIELD_ACTIVE", 1);
      return;
   }
   GlobalVariableSet("AT24_SHIELD_ACTIVE", 0);

   if(!isNewBar) return;

   double curBuf[1];
   if(CopyBuffer(hATR,0,0,1,curBuf)<1) return;
   double curATR = curBuf[0];
   double baseline = BaselineATR();
   if(baseline<=0) return;

   double ratio = curATR / baseline;
   if(ratio >= InpSpikeMultiple)
   {
      Print("AT24 Volatility Shield: SPIKE detected, ratio=", DoubleToString(ratio,2),
            " (ATR=", DoubleToString(curATR,5), " baseline=", DoubleToString(baseline,5), ")");
      FlattenProtectedPositions();
      gCooldownUntil = TimeCurrent() + InpCooldownMinutes*60;
      GlobalVariableSet("AT24_SHIELD_ACTIVE", 1);
   }
}
//+------------------------------------------------------------------+
