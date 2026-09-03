//+------------------------------------------------------------------+
//|                                   AT24_AI_Trend_Master.mq5        |
//|                        Copyright 2026, AlgoTraders24              |
//|                        https://www.algotraders24.ai               |
//+------------------------------------------------------------------+
// AT24 AI Trend Master - Product #1 of the M15 "real /products build-out"
// program. Honest naming note: the original placeholder listing this
// replaces (data/products.ts) marketed "AI trend detection" / "deep
// learning" - this build does NOT contain any trained neural network
// (nothing in this repo could train and validate one for real this
// session). It is a real, disclosed multi-factor RULE-BASED trend system:
// a macro EMA(50/200) trend filter on H4, an EMA(21/55) + ADX(14)
// strength gate on the entry timeframe, and an RSI(14) pullback-entry
// timing filter - "AI" is dropped from the real product description;
// only the honest mechanism is described there. Position sizing IS
// genuinely adaptive (ATR-distance-based risk-% sizing, not a fixed lot).
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 Trend Master - multi-timeframe EMA/ADX trend-following EA with ATR-adaptive risk-% sizing (Forex & Gold)."
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

CTrade trade;
CPositionInfo posInfo;

//+------------------------------------------------------------------+
//| INPUTS                                                            |
//+------------------------------------------------------------------+
input group "=== TREND FILTER (macro, H4) ==="
input ENUM_TIMEFRAMES InpMacroTF        = PERIOD_H4;   // Macro trend timeframe
input int              InpMacroFastEMA  = 50;          // Macro fast EMA
input int              InpMacroSlowEMA  = 200;         // Macro slow EMA

input group "=== ENTRY TIMING (H1) ==="
input ENUM_TIMEFRAMES InpEntryTF        = PERIOD_H1;   // Entry timeframe
input int              InpEntryFastEMA  = 21;          // Entry fast EMA
input int              InpEntrySlowEMA  = 55;          // Entry slow EMA
input int              InpADXPeriod     = 14;          // ADX period
input double           InpADXMin        = 25.0;        // Minimum ADX (trend strength gate)
input int              InpRSIPeriod     = 14;          // RSI period
input double           InpRSIPullbackLo = 40.0;         // Pullback zone low (buy-the-dip entries)
input double           InpRSIPullbackHi = 55.0;         // Pullback zone high

input group "=== RISK (adaptive, ATR-based) ==="
input int              InpATRPeriod     = 14;          // ATR period
input double           InpATR_SL_Mult   = 2.0;          // SL = ATR x this
input double           InpATR_TP_Mult   = 3.0;          // TP = ATR x this
input double           InpRiskPercent   = 1.0;          // Risk % of balance per trade
input bool              InpUseTrailing   = true;
input double            InpTrailATRMult  = 1.5;

input group "=== FILTERS ==="
input int               InpMaxSpreadPoints = 40;         // Max allowed spread
input bool              InpFridayClose      = true;      // Close/skip new entries near Friday close (GMT)
input int               InpFridayCloseHour  = 20;

input group "=== IDENTITY ==="
input long              InpMagicNumber = 24020001;
input string            InpTradeComment = "AT24_TrendMaster";

//+------------------------------------------------------------------+
//| GLOBALS                                                            |
//+------------------------------------------------------------------+
int hMacroFast, hMacroSlow, hEntryFast, hEntrySlow, hADX, hRSI, hATR;
datetime gLastBar = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   hMacroFast = iMA(_Symbol, InpMacroTF, InpMacroFastEMA, 0, MODE_EMA, PRICE_CLOSE);
   hMacroSlow = iMA(_Symbol, InpMacroTF, InpMacroSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
   hEntryFast = iMA(_Symbol, InpEntryTF, InpEntryFastEMA, 0, MODE_EMA, PRICE_CLOSE);
   hEntrySlow = iMA(_Symbol, InpEntryTF, InpEntrySlowEMA, 0, MODE_EMA, PRICE_CLOSE);
   hADX       = iADX(_Symbol, InpEntryTF, InpADXPeriod);
   hRSI       = iRSI(_Symbol, InpEntryTF, InpRSIPeriod, PRICE_CLOSE);
   hATR       = iATR(_Symbol, InpEntryTF, InpATRPeriod);

   if(hMacroFast==INVALID_HANDLE || hMacroSlow==INVALID_HANDLE || hEntryFast==INVALID_HANDLE ||
      hEntrySlow==INVALID_HANDLE || hADX==INVALID_HANDLE || hRSI==INVALID_HANDLE || hATR==INVALID_HANDLE)
   {
      Print("ERROR: indicator handle failed"); return INIT_FAILED;
   }

   gLastBar = iTime(_Symbol, InpEntryTF, 0);
   Print("AT24 Trend Master v1.00 ready | ", _Symbol, " | Entry TF: ", EnumToString(InpEntryTF));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hMacroFast); IndicatorRelease(hMacroSlow);
   IndicatorRelease(hEntryFast); IndicatorRelease(hEntrySlow);
   IndicatorRelease(hADX); IndicatorRelease(hRSI); IndicatorRelease(hATR);
}

//+------------------------------------------------------------------+
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

//+------------------------------------------------------------------+
void OnTick()
{
   if(!CheckSpread()) return;

   datetime cb = iTime(_Symbol, InpEntryTF, 0);
   bool isNewBar = (cb!=0 && gLastBar!=0 && cb!=gLastBar);
   if(isNewBar) gLastBar = cb;

   if(InpUseTrailing) DoTrail();

   if(!isNewBar) return;
   if(HasPosition()) return;
   if(IsFridayCloseWindow()) return;

   double macroF[2], macroS[2], entryF[2], entryS[2], adx[2], rsi[3], atr[2];
   if(CopyBuffer(hMacroFast,0,0,2,macroF)<2) return;
   if(CopyBuffer(hMacroSlow,0,0,2,macroS)<2) return;
   if(CopyBuffer(hEntryFast,0,0,2,entryF)<2) return;
   if(CopyBuffer(hEntrySlow,0,0,2,entryS)<2) return;
   if(CopyBuffer(hADX,0,0,2,adx)<2) return;
   if(CopyBuffer(hRSI,0,0,3,rsi)<3) return;
   if(CopyBuffer(hATR,0,0,2,atr)<2) return;

   // 1. Macro trend direction (H4 EMA stack) - index[1] = last CLOSED bar
   int macroTrend = 0;
   if(macroF[1]>macroS[1]) macroTrend = 1;
   else if(macroF[1]<macroS[1]) macroTrend = -1;
   if(macroTrend==0) return;

   // 2. Entry-TF trend agrees with macro + ADX confirms real strength
   bool entryUp   = entryF[1]>entryS[1];
   bool entryDown = entryF[1]<entryS[1];
   if(adx[1] < InpADXMin) return; // choppy - no real trend to ride

   // 3. RSI pullback-entry timing: price paused (RSI in the pullback zone)
   //    then turning back in the trend direction (rsi[1] > rsi[2] for buys).
   bool pullbackZone = (rsi[1] >= InpRSIPullbackLo && rsi[1] <= InpRSIPullbackHi);

   double atrNow = atr[1];
   double slDist = atrNow * InpATR_SL_Mult;
   double tpDist = atrNow * InpATR_TP_Mult;

   if(macroTrend==1 && entryUp && pullbackZone && rsi[1]>rsi[2])
      OpenTrade(true, slDist, tpDist);
   else if(macroTrend==-1 && entryDown && pullbackZone && rsi[1]<rsi[2])
      OpenTrade(false, slDist, tpDist);
}

void OpenTrade(bool isBuy, double slDist, double tpDist)
{
   double price = isBuy ? SymbolInfoDouble(_Symbol,SYMBOL_ASK) : SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double dig = (double)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   double sl = isBuy ? price - slDist : price + slDist;
   double tp = isBuy ? price + tpDist : price - tpDist;
   sl = NormalizeDouble(sl,(int)dig); tp = NormalizeDouble(tp,(int)dig);

   double lot = CalcLot(slDist);
   if(lot<=0) return;

   bool ok = isBuy ? trade.Buy(lot,_Symbol,price,sl,tp,InpTradeComment)
                    : trade.Sell(lot,_Symbol,price,sl,tp,InpTradeComment);
   if(ok) Print("AT24 Trend Master: ", (isBuy?"BUY":"SELL"), " ", _Symbol, " lot=", lot, " SL=", sl, " TP=", tp);
}

void DoTrail()
{
   double atr[2]; if(CopyBuffer(hATR,0,0,2,atr)<2) return;
   double trailDist = atr[1]*InpTrailATRMult;
   int dig = (int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);

   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=InpMagicNumber) continue;
      double open=posInfo.PriceOpen(), curSL=posInfo.StopLoss(), tp=posInfo.TakeProfit();
      if(posInfo.PositionType()==POSITION_TYPE_BUY)
      {
         double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
         double newSL = NormalizeDouble(bid-trailDist,dig);
         if(bid>open && newSL>curSL) trade.PositionModify(posInfo.Ticket(),newSL,tp);
      }
      else
      {
         double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
         double newSL = NormalizeDouble(ask+trailDist,dig);
         if(ask<open && (curSL==0.0 || newSL<curSL)) trade.PositionModify(posInfo.Ticket(),newSL,tp);
      }
   }
}
//+------------------------------------------------------------------+
