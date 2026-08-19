//+------------------------------------------------------------------+
//| AT24_G01_MSS.mqh                                                   |
//| PURE, PLATFORM-AGNOSTIC. Market Structure Shift detection: a       |
//| CLOSED candle's CLOSE (never its wick) must break the most recent  |
//| confirmed M5 swing in the required direction.                      |
//+------------------------------------------------------------------+
#ifndef AT24_G01_MSS_MQH
#define AT24_G01_MSS_MQH

#include "AT24_G01_Types.mqh"
#include "AT24_G01_Swings.mqh"

//--- BULLISH MSS: candle.close closes ABOVE the most recent confirmed M5 swing high.
//--- BEARISH MSS: candle.close closes BELOW the most recent confirmed M5 swing low.
//--- Wick breaks do not qualify -- only the close is compared.
bool G01_DetectMSS(ENUM_G01_DIRECTION requiredDirection,const SBar &candle,
                    const SSwingPoint &m5Highs[],const SSwingPoint &m5Lows[],
                    SMSSEvent &ev)
  {
   if(requiredDirection == DIR_BULLISH)
     {
      SSwingPoint sw;
      if(!G01_GetMostRecentSwing(m5Highs,sw))
         return(false);
      if(candle.close <= sw.price)
         return(false);
      ev.direction          = DIR_BULLISH;
      ev.broken_swing_price = sw.price;
      ev.broken_swing_time  = sw.time;
      ev.mss_candle_time    = candle.time;
      ev.mss_close          = candle.close;
      ev.break_distance     = candle.close - sw.price;
      ev.valid              = true;
      return(true);
     }

   if(requiredDirection == DIR_BEARISH)
     {
      SSwingPoint sw;
      if(!G01_GetMostRecentSwing(m5Lows,sw))
         return(false);
      if(candle.close >= sw.price)
         return(false);
      ev.direction          = DIR_BEARISH;
      ev.broken_swing_price = sw.price;
      ev.broken_swing_time  = sw.time;
      ev.mss_candle_time    = candle.time;
      ev.mss_close          = candle.close;
      ev.break_distance     = sw.price - candle.close;
      ev.valid              = true;
      return(true);
     }

   return(false);
  }

#endif // AT24_G01_MSS_MQH
