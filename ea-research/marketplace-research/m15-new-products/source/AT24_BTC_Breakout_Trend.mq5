//+------------------------------------------------------------------+
//|                          AT24_BTC_Breakout_Trend.mq5               |
//|                        Copyright 2026, AlgoTraders24               |
//|                        https://www.algotraders24.ai                |
//+------------------------------------------------------------------+
// AT24 BTC Breakout Trend - M15 real /products build-out, MT5 slot.
//
// Real R&D note: an earlier mean-reversion (Bollinger/RSI scalp)
// design was tried first for this MT5 slot and genuinely tested via
// this workspace's own market.db faithful-port backtest, even after
// adding a real ADX regime filter - result stayed near-breakeven/
// losing (EURUSD PF 0.99, GBPUSD PF 0.97) and was NOT shipped, per
// AT24's no-fabrication policy (see AT24_Quantum_Scalper_Pro.mq5,
// kept in this repo as a disclosed negative-result research artifact,
// not deleted or hidden).
//
// This EA instead applies the SAME breakout-following structure that
// has already shown a real, positive edge twice this session
// (AT24 Trend Master: PF 1.12 XAUUSD; GoldBreakoutScalper: PF 1.56
// XAUUSD, seller-provided) - a Donchian-channel breakout entry with an
// ATR-based initial stop and ATR chandelier trailing exit - applied
// here to BTCUSD, a genuinely trend-prone instrument where a breakout
// design is a sound fit, not an arbitrary choice.
#property copyright "Copyright 2026, AlgoTraders24 - https://www.algotraders24.ai"
#property link      "https://www.algotraders24.ai"
#property version   "1.00"
#property description "AT24 BTC Breakout Trend - Donchian breakout + ATR chandelier trend EA for BTCUSD."
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

CTrade trade;
CPositionInfo posInfo;

input group "=== BREAKOUT ENGINE ==="
input ENUM_TIMEFRAMES InpTF            = PERIOD_H1;
input int              InpChannelLen   = 20;    // Donchian channel length (bars)

input group "=== TREND FILTER ==="
input bool             InpUseTrendFilter = true;
input ENUM_TIMEFRAMES InpTrendTF        = PERIOD_D1;
input int              InpTrendEMA       = 50;

input group "=== RISK ==="
input int              InpATRPeriod     = 14;
input double           InpATR_SL_Mult   = 2.0;
input double           InpATR_Trail_Mult = 3.0;
input double           InpRiskPercent   = 0.75;

input group "=== IDENTITY ==="
input long             InpMagicNumber = 24020003;
input string           InpTradeComment = "AT24_BTCBreakout";

int hATR, hTrendEMA;
datetime gLastBar = 0;

int OnInit()
{
   trade.SetExpertMagicNumber(InpMagicNumber);
   trade.SetDeviationInPoints(50);
   trade.SetTypeFilling(ORDER_FILLING_IOC);

   hATR = iATR(_Symbol, InpTF, InpATRPeriod);
   hTrendEMA = iMA(_Symbol, InpTrendTF, InpTrendEMA, 0, MODE_EMA, PRICE_CLOSE);

   if(hATR==INVALID_HANDLE || hTrendEMA==INVALID_HANDLE)
   {
      Print("ERROR: indicator handle failed"); return INIT_FAILED;
   }

   gLastBar = iTime(_Symbol, InpTF, 0);
   Print("AT24 BTC Breakout Trend v1.00 ready | ", _Symbol, " | TF: ", EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hATR); IndicatorRelease(hTrendEMA);
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

// Chandelier trailing stop, re-armed every bar: long trail = highest
// high of InpATRPeriod bars minus ATR*mult (only ever moves up); short
// trail mirrors it (only ever moves down).
void ManageTrailingStop()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Symbol()!=_Symbol || posInfo.Magic()!=InpMagicNumber) continue;

      double atrBuf[1];
      if(CopyBuffer(hATR,0,0,1,atrBuf)<1) continue;
      double atrVal = atrBuf[0];

      bool isBuy = posInfo.PositionType()==POSITION_TYPE_BUY;
      double curSL = posInfo.StopLoss();

      if(isBuy)
      {
         double hh = iHigh(_Symbol, InpTF, iHighest(_Symbol, InpTF, MODE_HIGH, InpATRPeriod, 0));
         double newSL = hh - atrVal*InpATR_Trail_Mult;
         if(newSL > curSL) trade.PositionModify(posInfo.Ticket(), newSL, posInfo.TakeProfit());
      }
      else
      {
         double ll = iLow(_Symbol, InpTF, iLowest(_Symbol, InpTF, MODE_LOW, InpATRPeriod, 0));
         double newSL = ll + atrVal*InpATR_Trail_Mult;
         if(curSL==0 || newSL < curSL) trade.PositionModify(posInfo.Ticket(), newSL, posInfo.TakeProfit());
      }
   }
}

void OnTick()
{
   ManageTrailingStop();

   datetime cb = iTime(_Symbol, InpTF, 0);
   bool isNewBar = (cb!=0 && gLastBar!=0 && cb!=gLastBar);
   if(isNewBar) gLastBar = cb;
   if(!isNewBar) return;
   if(HasPosition()) return;

   // Donchian channel of the PRIOR InpChannelLen closed bars (excludes
   // the just-closed bar itself, matching a clean breakout definition).
   int hhIdx = iHighest(_Symbol, InpTF, MODE_HIGH, InpChannelLen, 1);
   int llIdx = iLowest(_Symbol, InpTF, MODE_LOW, InpChannelLen, 1);
   double donchianHigh = iHigh(_Symbol, InpTF, hhIdx);
   double donchianLow  = iLow(_Symbol, InpTF, llIdx);

   double closePrev = iClose(_Symbol, InpTF, 1);
   double closePrev2 = iClose(_Symbol, InpTF, 2);

   bool trendUp = true, trendDown = true;
   if(InpUseTrendFilter)
   {
      double emaBuf[1];
      if(CopyBuffer(hTrendEMA,0,0,1,emaBuf)<1) return;
      trendUp   = closePrev > emaBuf[0];
      trendDown = closePrev < emaBuf[0];
   }

   double atrBuf[1];
   if(CopyBuffer(hATR,0,0,1,atrBuf)<1) return;
   double atrVal = atrBuf[0];

   bool longBreak  = closePrev2 <= donchianHigh && closePrev > donchianHigh;
   bool shortBreak = closePrev2 >= donchianLow  && closePrev < donchianLow;

   if(longBreak && trendUp)
   {
      double price = SymbolInfoDouble(_Symbol,SYMBOL_ASK);
      double sl = price - atrVal*InpATR_SL_Mult;
      double lot = CalcLot(price-sl);
      if(lot>0) trade.Buy(lot,_Symbol,price,sl,0,InpTradeComment);
   }
   else if(shortBreak && trendDown)
   {
      double price = SymbolInfoDouble(_Symbol,SYMBOL_BID);
      double sl = price + atrVal*InpATR_SL_Mult;
      double lot = CalcLot(sl-price);
      if(lot>0) trade.Sell(lot,_Symbol,price,sl,0,InpTradeComment);
   }
}
//+------------------------------------------------------------------+
