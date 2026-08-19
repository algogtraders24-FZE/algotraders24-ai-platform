//+------------------------------------------------------------------+
//| AT24_G01_Risk.mqh                                                   |
//| PURE, PLATFORM-AGNOSTIC. SL / TP / position-size formulas. Takes   |
//| equity and the symbol's trading spec as plain parameters instead   |
//| of calling AccountInfoDouble/SymbolInfo* itself, so it is unchanged|
//| by an MT4 port (the adapter supplies these numbers on both         |
//| platforms).                                                          |
//+------------------------------------------------------------------+
#ifndef AT24_G01_RISK_MQH
#define AT24_G01_RISK_MQH

#include "AT24_G01_Types.mqh"

//--- SL = sweep extreme +/- an ATR-relative buffer.
//--- BUY (bullish sweep):  SL below the sweep low.
//--- SELL (bearish sweep): SL above the sweep high.
double G01_CalculateSL(const SSweepEvent &sweep,double atrValue,double bufferATRMultiple)
  {
   double buffer = atrValue * bufferATRMultiple;
   if(sweep.direction == DIR_BULLISH)
      return(sweep.candle_low - buffer);
   return(sweep.candle_high + buffer);
  }

//--- TP = entry +/- rMultiple * R, where R = |entry - SL|. Baseline rMultiple = 2.0 (2R).
double G01_CalculateTP(double entry,double sl,double rMultiple)
  {
   double r = MathAbs(entry - sl);
   if(entry > sl)
      return(entry + r*rMultiple);
   return(entry - r*rMultiple);
  }

//--- Position size from risk % of equity, using the symbol's dynamic tick value/size and
//--- respecting broker min/max/step lot constraints. Returns 0.0 if risk is too small to
//--- open even the minimum lot, or if inputs are invalid.
double G01_CalculateLotSize(double riskPercent,double entry,double sl,double equity,
                             const SSymbolSpec &spec)
  {
   double slDistance = MathAbs(entry - sl);
   if(slDistance <= 0.0 || spec.tick_size <= 0.0 || spec.tick_value <= 0.0 || spec.volume_step <= 0.0)
      return(0.0);

   double riskAmount = equity * (riskPercent / 100.0);
   double ticksInSL  = slDistance / spec.tick_size;
   double lossPerLot = ticksInSL * spec.tick_value;
   if(lossPerLot <= 0.0)
      return(0.0);

   double lots = riskAmount / lossPerLot;
   lots = MathFloor(lots / spec.volume_step) * spec.volume_step;

   if(lots < spec.volume_min)
      return(0.0);
   if(spec.volume_max > 0.0 && lots > spec.volume_max)
      lots = spec.volume_max;

   return(NormalizeDouble(lots,2));
  }

#endif // AT24_G01_RISK_MQH
