//+------------------------------------------------------------------+
//| AT24_G01_Displacement.mqh                                          |
//| PURE, PLATFORM-AGNOSTIC. Objective displacement-candle measurement |
//| on a single CLOSED candle supplied by the caller.                  |
//+------------------------------------------------------------------+
#ifndef AT24_G01_DISPLACEMENT_MQH
#define AT24_G01_DISPLACEMENT_MQH

#include "AT24_G01_Types.mqh"

//--- Baseline rule: BodySize >= bodyAtrMultiple * ATR(14)
//---               AND directional close-location-ratio >= closeLocationThreshold.
//--- BULLISH: close in the upper (closeLocationThreshold) portion of the candle range.
//--- BEARISH: close in the lower (closeLocationThreshold) portion of the candle range.
//--- expectedDirection (DIR_NONE to allow either) restricts the result to the direction
//--- required by the active sweep.
bool G01_CalculateDisplacement(const SBar &candle,double atrValue,double bodyAtrMultiple,
                                double closeLocationThreshold,ENUM_G01_DIRECTION expectedDirection,
                                SDisplacementEvent &ev)
  {
   if(atrValue <= 0.0)
      return(false);

   double range = candle.high - candle.low;
   if(range <= 0.0)
      return(false);

   double body = MathAbs(candle.close - candle.open);
   double bodyAtrRatio = body / atrValue;

   double closeLocation = (candle.close - candle.low) / range; // 0 = at low, 1 = at high

   ENUM_G01_DIRECTION dir = DIR_NONE;
   double dirRatio = 0.0;
   if(closeLocation >= closeLocationThreshold)
     {
      dir = DIR_BULLISH;
      dirRatio = closeLocation;
     }
   else if((1.0 - closeLocation) >= closeLocationThreshold)
     {
      dir = DIR_BEARISH;
      dirRatio = 1.0 - closeLocation;
     }
   else
      return(false);

   if(expectedDirection != DIR_NONE && dir != expectedDirection)
      return(false);

   if(bodyAtrRatio < bodyAtrMultiple)
      return(false);

   ev.direction            = dir;
   ev.candle_time          = candle.time;
   ev.body_size             = body;
   ev.atr_value             = atrValue;
   ev.body_atr_ratio        = bodyAtrRatio;
   ev.close_location_ratio  = dirRatio;
   ev.valid                 = true;
   return(true);
  }

#endif // AT24_G01_DISPLACEMENT_MQH
