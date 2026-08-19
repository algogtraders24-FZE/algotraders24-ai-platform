//+------------------------------------------------------------------+
//| AT24_G01_Sweep.mqh                                                  |
//| PURE, PLATFORM-AGNOSTIC. Liquidity sweep detection on a single      |
//| CLOSED candle supplied by the caller.                               |
//+------------------------------------------------------------------+
#ifndef AT24_G01_SWEEP_MQH
#define AT24_G01_SWEEP_MQH

#include "AT24_G01_Types.mqh"

//--- BEARISH SWEEP: candle.high > level  AND  candle.close < level (closes back inside).
//--- BULLISH SWEEP: candle.low  < level  AND  candle.close > level (closes back inside).
//--- A wick that merely touches the level without the close re-entering is NOT a sweep.
//--- Penetration is measured relative to ATR and must clear minPenetrationATR.
bool G01_DetectSweep(const SLiquidityLevel &level,const SBar &candle,double atrValue,
                      double minPenetrationATR,SSweepEvent &ev)
  {
   if(!level.valid || atrValue <= 0.0)
      return(false);

   double range = candle.high - candle.low;
   double body  = MathAbs(candle.close - candle.open);
   double upperWick = candle.high - MathMax(candle.open,candle.close);
   double lowerWick = MathMin(candle.open,candle.close) - candle.low;

   ENUM_G01_DIRECTION dir = DIR_NONE;
   double penetrationPrice = 0.0;

   if(candle.high > level.price && candle.close < level.price)
     {
      dir = DIR_BEARISH;
      penetrationPrice = candle.high - level.price;
     }
   else if(candle.low < level.price && candle.close > level.price)
     {
      dir = DIR_BULLISH;
      penetrationPrice = level.price - candle.low;
     }
   else
      return(false);

   double penetrationATR = penetrationPrice / atrValue;
   if(penetrationATR < minPenetrationATR)
      return(false);

   ev.liquidity_type    = level.type;
   ev.liquidity_price   = level.price;
   ev.direction         = dir;
   ev.candle_time       = candle.time;
   ev.candle_high       = candle.high;
   ev.candle_low        = candle.low;
   ev.candle_open       = candle.open;
   ev.candle_close      = candle.close;
   ev.penetration_price = penetrationPrice;
   ev.penetration_atr   = penetrationATR;
   ev.candle_range      = range;
   ev.candle_body       = body;
   ev.upper_wick        = upperWick;
   ev.lower_wick        = lowerWick;
   ev.rejection_ratio   = (range > 0.0) ? ((dir == DIR_BEARISH) ? upperWick/range : lowerWick/range) : 0.0;
   ev.valid             = true;
   return(true);
  }

#endif // AT24_G01_SWEEP_MQH
