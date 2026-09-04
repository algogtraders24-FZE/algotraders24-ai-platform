//+------------------------------------------------------------------+
//|                              AT24_Quantum_Scalper_Pro.mq5          |
//|                        Copyright 2026, AlgoTraders24              |
//|                        https://www.algotraders24.ai               |
//+------------------------------------------------------------------+
// AT24 Quantum Scalper Pro - Product #2 of the M15 real /products
// build-out, replacing the fabricated "Quantum Scalper Pro" placeholder
// (data/products.ts). Honest naming note: the original placeholder
// marketed "Ultra-fast execution" / "HFT" - this build does NOT claim
// true high-frequency/low-latency execution (nothing in this session can
// verify sub-second broker execution quality), and "HFT" is dropped from
// the real description. What IS real: a disclosed M5 mean-reversion
// scalp system - Bollinger Band extremes + RSI exhaustion, targeting the
// band's own mean, with a real spread filter and a real time-based exit
// so scalp trades don't linger.
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 Quantum Scalper Pro - M5 Bollinger/RSI mean-reversion scalper with spread filter and time-based exit (Forex)."
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

CTrade trade;
CPositionInfo posInfo;

input group "=== SCALP ENGINE (M5) ==="
input ENUM_TIMEFRAMES InpTF          = PERIOD_M5;
input int              InpBBPeriod    = 20;
input double           InpBBDeviation = 2.0;
input int              InpRSIPeriod   = 7;
input double           InpRSIOversold = 25.0;
input double           InpRSIOverbought = 75.0;
input int              InpADXPeriod   = 14;
input double           InpADXMaxForRange = 20.0; // real regime filter: mean-reversion is only taken when ADX is BELOW this (a genuinely ranging market) - a trending market (high ADX) tends to keep extending past a Bollinger touch instead of reverting, so entries are skipped there

input group "=== RISK ==="
input int              InpATRPeriod  = 14;
input double           InpATR_SL_Mult = 1.2;   // tight scalp stop
input double           InpRiskPercent = 0.5;    // smaller per-trade risk - scalping trades more often
input int              InpMaxHoldMinutes = 60;  // time-based exit - a scalp that hasn't resolved isn't a scalp anymore

input group "=== FILTERS ==="
input int              InpMaxSpreadPoints = 20;  // real spread filter - skip entries when spread widens
input bool             InpSessionFilter   = true; // London/NY liquidity window only (GMT)
input int              InpSessionStartHour = 7;
input int              InpSessionEndHour   = 20;
input bool             InpFridayClose      = true;
input int              InpFridayCloseHour  = 20;

input group "=== IDENTITY ==="
input long             InpMagicNumber = 24020002;
input string           InpTradeComment = "AT24_ScalperPro";

int hBB, hRSI, hATR, hADX;
datetime gLastBar = 0;

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(20);
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   hBB  = iBands(_Symbol, InpTF, InpBBPeriod, 0, InpBBDeviation, PRICE_CLOSE);
   hRSI = iRSI(_Symbol, InpTF, InpRSIPeriod, PRICE_CLOSE);
   hATR = iATR(_Symbol, InpTF, InpATRPeriod);
   hADX = iADX(_Symbol, InpTF, InpADXPeriod);

   if(hBB==INVALID_HANDLE || hRSI==INVALID_HANDLE || hATR==INVALID_HANDLE || hADX==INVALID_HANDLE)
   {
      Print("ERROR: indicator handle failed"); return INIT_FAILED;
   }

   gLastBar = iTime(_Symbol, InpTF, 0);
   Print("AT24 Quantum Scalper Pro v1.00 ready | ", _Symbol, " | TF: ", EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hBB); IndicatorRelease(hRSI); IndicatorRelease(hATR); IndicatorRelease(hADX);
}

bool HasPosition()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()==_Symbol && posInfo.Magic()==InpMagicNumber) return true;
   }
   return false;
}

bool CheckSpread() { return (InpMaxSpreadPoints<=0 || (long)SymbolInfoInteger(_Symbol,SYMBOL_SPREAD)<=InpMaxSpreadPoints); }

bool InSession()
{
   if(!InpSessionFilter) return true;
   MqlDateTime t; TimeGMT(t);
   return (t.hour>=InpSessionStartHour && t.hour<InpSessionEndHour);
}

bool IsFridayCloseWindow()
{
   if(!InpFridayClose) return false;
   MqlDateTime t; TimeGMT(t);
   return (t.day_of_week==5 && t.hour>=InpFridayCloseHour);
}

double CalcLot(double slDistance)
{
   double minL=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxL=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(slDistance<=0) return minL;
   double bal=AccountInfoDouble(ACCOUNT_BALANCE);
   double riskMoney=bal*InpRiskPercent/100.0;
   double tickValue=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(tickValue<=0 || tickSize<=0) return minL;
   double valuePerLot=(slDistance/tickSize)*tickValue;
   if(valuePerLot<=0) return minL;
   if(step<=0) step=minL>0?minL:0.01;
   double lot=MathFloor((riskMoney/valuePerLot)/step)*step;
   return NormalizeDouble(MathMax(minL,MathMin(maxL,lot)),2);
}

void ManageOpenPosition()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=InpMagicNumber) continue;

      // Time-based exit - a scalp trade that hasn't resolved in the
      // configured window is closed regardless of P&L (real, disclosed
      // mechanism, not a "let it ride" strategy in disguise).
      datetime openTime = posInfo.Time();
      int heldMinutes = (int)((TimeCurrent()-openTime)/60);
      if(heldMinutes >= InpMaxHoldMinutes)
      {
         trade.PositionClose(posInfo.Ticket());
         continue;
      }

      // Mean-reversion target: close once price reaches the BB middle band.
      double mid[1];
      if(CopyBuffer(hBB,0,0,1,mid) < 1) continue;
      bool isBuy = posInfo.PositionType()==POSITION_TYPE_BUY;
      double price = isBuy ? SymbolInfoDouble(_Symbol,SYMBOL_BID) : SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      if((isBuy && price>=mid[0]) || (!isBuy && price<=mid[0]))
         trade.PositionClose(posInfo.Ticket());
   }
}

void OnTick()
{
   ManageOpenPosition();

   datetime cb = iTime(_Symbol, InpTF, 0);
   bool isNewBar = (cb!=0 && gLastBar!=0 && cb!=gLastBar);
   if(isNewBar) gLastBar = cb;
   if(!isNewBar) return;

   if(!CheckSpread()) return;
   if(!InSession()) return;
   if(IsFridayCloseWindow()) return;
   if(HasPosition()) return;

   double bbUpper[2], bbLower[2], rsi[2], atr[2], adx[2];
   if(CopyBuffer(hBB,1,0,2,bbUpper)<2) return; // upper band
   if(CopyBuffer(hBB,2,0,2,bbLower)<2) return; // lower band
   if(CopyBuffer(hRSI,0,0,2,rsi)<2) return;
   if(CopyBuffer(hATR,0,0,2,atr)<2) return;
   if(CopyBuffer(hADX,0,0,2,adx)<2) return;

   // Regime filter - mean-reversion is only attempted in a genuinely
   // ranging market (see this input's own comment above).
   if(adx[1] > InpADXMaxForRange) return;

   double closePrev = iClose(_Symbol, InpTF, 1);
   double slDist = atr[1]*InpATR_SL_Mult;

   // BUY: price closed at/below the lower band AND RSI confirms oversold
   // exhaustion -> bet on reversion back toward the mean.
   if(closePrev <= bbLower[1] && rsi[1] <= InpRSIOversold)
   {
      double price = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      double sl = price - slDist;
      double lot = CalcLot(slDist);
      if(lot>0) trade.Buy(lot,_Symbol,price,sl,0,InpTradeComment);
   }
   // SELL: price closed at/above the upper band AND RSI confirms overbought.
   else if(closePrev >= bbUpper[1] && rsi[1] >= InpRSIOverbought)
   {
      double price = SymbolInfoDouble(_Symbol,SYMBOL_BID);
      double sl = price + slDist;
      double lot = CalcLot(slDist);
      if(lot>0) trade.Sell(lot,_Symbol,price,sl,0,InpTradeComment);
   }
}
//+------------------------------------------------------------------+
