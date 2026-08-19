//+------------------------------------------------------------------+
//| AT24_G01_FVG.mqh                                                   |
//| PURE, PLATFORM-AGNOSTIC. Standard three-candle Fair Value Gap       |
//| detection and fill/invalidation check, on CLOSED candles supplied  |
//| by the caller.                                                      |
//+------------------------------------------------------------------+
#ifndef AT24_G01_FVG_MQH
#define AT24_G01_FVG_MQH

#include "AT24_G01_Types.mqh"

//--- BULLISH FVG: candle1.high < candle3.high  (zone: candle1.high -> candle3.low)
//--- BEARISH FVG: candle1.low  > candle3.high  (zone: candle3.high -> candle1.low)
//--- Only forms from three already-CLOSED candles. 'afterTime' gates the FVG to have
//--- formed at/after the MSS candle, so the sequence is never searched out of order.
bool G01_DetectFVG(const SBar &candle1,const SBar &candle3,double atrValue,
                    ENUM_G01_DIRECTION requiredDirection,datetime afterTime,SFVGEvent &ev)
  {
   if(candle3.time < afterTime)
      return(false);

   if(requiredDirection == DIR_BULLISH && candle1.high < candle3.low)
     {
      ev.direction     = DIR_BULLISH;
      ev.creation_time = candle3.time;
      ev.upper         = candle3.low;
      ev.lower         = candle1.high;
      ev.size_price    = candle3.low - candle1.high;
      ev.size_atr      = (atrValue > 0.0) ? ev.size_price/atrValue : 0.0;
      ev.valid         = true;
      return(true);
     }

   if(requiredDirection == DIR_BEARISH && candle1.low > candle3.high)
     {
      ev.direction     = DIR_BEARISH;
      ev.creation_time = candle3.time;
      ev.upper         = candle1.low;
      ev.lower         = candle3.high;
      ev.size_price    = candle1.low - candle3.high;
      ev.size_atr      = (atrValue > 0.0) ? ev.size_price/atrValue : 0.0;
      ev.valid         = true;
      return(true);
     }

   return(false);
  }

//--- 50% retracement level of the FVG zone -- the baseline entry trigger.
double G01_CalculateEntry(const SFVGEvent &fvg)
  {
   return((fvg.upper + fvg.lower) / 2.0);
  }

//--- FVG invalidated when a CLOSED candle closes all the way through the far boundary
//--- (i.e. price fully mitigated the gap and continued against the setup's direction).
bool G01_IsFVGInvalidatedByClose(const SFVGEvent &fvg,const SBar &candle)
  {
   if(fvg.direction == DIR_BULLISH)
      return(candle.close < fvg.lower);
   if(fvg.direction == DIR_BEARISH)
      return(candle.close > fvg.upper);
   return(false);
  }

#endif // AT24_G01_FVG_MQH
