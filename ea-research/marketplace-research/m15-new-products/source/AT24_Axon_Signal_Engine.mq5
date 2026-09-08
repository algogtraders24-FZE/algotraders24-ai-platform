//+------------------------------------------------------------------+
//|                        AT24_Axon_Signal_Engine.mq5                 |
//|                        Copyright 2026, AlgoTraders24               |
//|                        https://www.algotraders24.ai                |
//+------------------------------------------------------------------+
// AT24 Axon Signal Engine - filling a previously EMPTY /products
// placeholder row (axon-signal-engine: no platform, no description,
// no features - a genuine gap, not a rename of an existing product).
//
// Honest naming note: "Axon" evokes neural/AI branding, but this is
// NOT a trained neural network or ML model - nothing in this session
// can train or validate one. What it actually is: a real rule-based
// MULTI-FACTOR CONFLUENCE engine - four independent, standard
// technical signals (trend direction, momentum, trend strength,
// momentum acceleration) each cast one vote, and a trade is only
// taken when a configurable minimum number of them agree. This is a
// genuinely different entry mechanism from every single-indicator
// crossover/breakout shipped elsewhere in this catalog - it trades
// less often, but only on more corroborated setups.
//
// The four signal votes (each +1 bullish / -1 bearish / 0 neutral):
//   1. Trend:     EMA(InpEmaFast) vs EMA(InpEmaSlow) on the entry TF
//   2. Momentum:  RSI(InpRSIPeriod) above/below 50
//   3. Strength:  +DI vs -DI from ADX (which side is dominant)
//   4. Accel.:    MACD histogram rising/falling over the last 2 bars
// Composite score = sum of the 4 votes (range -4..+4). Enter long when
// score >= InpMinScore, short when score <= -InpMinScore.
//
// Risk: ATR-based stop, fixed R:R take-profit.
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 Axon Signal Engine - 4-factor confluence entry EA (trend + momentum + strength + acceleration)."
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

CTrade trade;
CPositionInfo posInfo;

input group "=== SIGNAL ENGINE ==="
input ENUM_TIMEFRAMES InpTF        = PERIOD_H1;
input int              InpEmaFast   = 20;
input int              InpEmaSlow   = 50;
input int              InpRSIPeriod = 14;
input int              InpADXPeriod = 14;
input int              InpMinScore  = 3;   // of 4 possible votes - require strong agreement

input group "=== RISK ==="
input int              InpATRPeriod   = 14;
input double           InpATR_SL_Mult = 2.0;
input double           InpRR          = 2.0;
input double           InpRiskPercent = 0.75;

input group "=== IDENTITY ==="
input long             InpMagicNumber  = 24020006;
input string           InpTradeComment = "AT24_AxonSignal";

int hEmaFast, hEmaSlow, hRSI, hADX, hMACD, hATR;
datetime gLastBar = 0;

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   hEmaFast = iMA(_Symbol, InpTF, InpEmaFast, 0, MODE_EMA, PRICE_CLOSE);
   hEmaSlow = iMA(_Symbol, InpTF, InpEmaSlow, 0, MODE_EMA, PRICE_CLOSE);
   hRSI     = iRSI(_Symbol, InpTF, InpRSIPeriod, PRICE_CLOSE);
   hADX     = iADX(_Symbol, InpTF, InpADXPeriod);
   hMACD    = iMACD(_Symbol, InpTF, 12, 26, 9, PRICE_CLOSE);
   hATR     = iATR(_Symbol, InpTF, InpATRPeriod);

   if(hEmaFast==INVALID_HANDLE || hEmaSlow==INVALID_HANDLE || hRSI==INVALID_HANDLE ||
      hADX==INVALID_HANDLE || hMACD==INVALID_HANDLE || hATR==INVALID_HANDLE)
   {
      Print("ERROR: indicator handle failed"); return INIT_FAILED;
   }

   gLastBar = iTime(_Symbol, InpTF, 0);
   Print("AT24 Axon Signal Engine v1.00 ready | ", _Symbol, " | TF: ", EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hEmaFast); IndicatorRelease(hEmaSlow); IndicatorRelease(hRSI);
   IndicatorRelease(hADX); IndicatorRelease(hMACD); IndicatorRelease(hATR);
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

// Returns composite score in [-4, +4] for the last CLOSED bar (shift 1).
int ComputeScore()
{
   double emaFast[2], emaSlow[2], rsi[2], plusDI[2], minusDI[2], macdMain[3], macdSignal[3];
   if(CopyBuffer(hEmaFast,0,1,2,emaFast)<2) return 0;
   if(CopyBuffer(hEmaSlow,0,1,2,emaSlow)<2) return 0;
   if(CopyBuffer(hRSI,0,1,2,rsi)<2) return 0;
   if(CopyBuffer(hADX,1,1,2,plusDI)<2) return 0;   // +DI buffer
   if(CopyBuffer(hADX,2,1,2,minusDI)<2) return 0;  // -DI buffer
   if(CopyBuffer(hMACD,1,1,3,macdSignal)<3) return 0; // signal (unused directly, kept for clarity)
   double macdMainBuf[3];
   if(CopyBuffer(hMACD,0,1,3,macdMainBuf)<3) return 0;

   int score = 0;

   // 1. Trend vote
   score += (emaFast[1] > emaSlow[1]) ? 1 : (emaFast[1] < emaSlow[1] ? -1 : 0);

   // 2. Momentum vote
   score += (rsi[1] > 50.0) ? 1 : (rsi[1] < 50.0 ? -1 : 0);

   // 3. Strength/direction vote
   score += (plusDI[1] > minusDI[1]) ? 1 : (plusDI[1] < minusDI[1] ? -1 : 0);

   // 4. Acceleration vote - MACD histogram (main - signal) rising or falling
   double hist0 = macdMainBuf[2] - macdSignal[2]; // most recent closed bar's histogram
   double hist1 = macdMainBuf[1] - macdSignal[1]; // bar before that
   score += (hist0 > hist1) ? 1 : (hist0 < hist1 ? -1 : 0);

   return score;
}

void OnTick()
{
   datetime cb = iTime(_Symbol, InpTF, 0);
   bool isNewBar = (cb!=0 && gLastBar!=0 && cb!=gLastBar);
   if(isNewBar) gLastBar = cb;
   if(!isNewBar) return;
   if(HasPosition()) return;

   int score = ComputeScore();
   double atrBuf[1];
   if(CopyBuffer(hATR,0,0,1,atrBuf)<1) return;
   double atrVal = atrBuf[0];

   if(score >= InpMinScore)
   {
      double price = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      double sl = price - atrVal*InpATR_SL_Mult;
      double tp = price + atrVal*InpATR_SL_Mult*InpRR;
      double lot = CalcLot(price-sl);
      if(lot>0) trade.Buy(lot,_Symbol,price,sl,tp,InpTradeComment);
   }
   else if(score <= -InpMinScore)
   {
      double price = SymbolInfoDouble(_Symbol,SYMBOL_BID);
      double sl = price + atrVal*InpATR_SL_Mult;
      double tp = price - atrVal*InpATR_SL_Mult*InpRR;
      double lot = CalcLot(sl-price);
      if(lot>0) trade.Sell(lot,_Symbol,price,sl,tp,InpTradeComment);
   }
}
//+------------------------------------------------------------------+
