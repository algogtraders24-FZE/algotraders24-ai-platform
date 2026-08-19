//+------------------------------------------------------------------+
//| AT24_G01_Filters.mqh                                                |
//| PURE, PLATFORM-AGNOSTIC. Spread guard and session classification   |
//| take plain numeric inputs (current spread, current hour) instead   |
//| of calling SymbolInfoInteger/TimeToStruct themselves, so the       |
//| adapter is the only thing that changes on an MT4 port.             |
//+------------------------------------------------------------------+
#ifndef AT24_G01_FILTERS_MQH
#define AT24_G01_FILTERS_MQH

#include "AT24_G01_Types.mqh"

//--- True if the current spread (broker points) exceeds the configured maximum.
bool G01_IsSpreadBlocked(double currentSpreadPoints,double maxSpreadPoints)
  {
   return(currentSpreadPoints > maxSpreadPoints);
  }

//--- Classify an hour-of-day (broker/server time) into a named session window.
//--- Ranges are half-open [start,end). The Asia window may wrap past midnight
//--- (asiaStart >= asiaEnd, e.g. 22..7), all others are assumed non-wrapping.
ENUM_G01_SESSION G01_ClassifySessionFromHour(int hour,
                                              int asiaStart,int asiaEnd,
                                              int londonStart,int londonEnd,
                                              int overlapStart,int overlapEnd,
                                              int nyStart,int nyEnd)
  {
   if(hour >= overlapStart && hour < overlapEnd)
      return(SESSION_LONDON_NY_OVERLAP);
   if(hour >= londonStart && hour < londonEnd)
      return(SESSION_LONDON);
   if(hour >= nyStart && hour < nyEnd)
      return(SESSION_NEW_YORK);

   bool inAsia;
   if(asiaStart <= asiaEnd)
      inAsia = (hour >= asiaStart && hour < asiaEnd);
   else
      inAsia = (hour >= asiaStart || hour < asiaEnd);
   if(inAsia)
      return(SESSION_ASIA);

   return(SESSION_OUTSIDE);
  }

//--- allowedSession == SESSION_ALL passes every session (baseline testing mode).
bool G01_IsSessionAllowed(ENUM_G01_SESSION current,ENUM_G01_SESSION allowedSession)
  {
   if(allowedSession == SESSION_ALL)
      return(true);
   return(current == allowedSession);
  }

//--- News filter stub. v0.1 baseline always OFF (returns false = not blocked). Kept as its
//--- own pure function so a future sprint can implement real calendar-based blocking without
//--- touching the state machine; explicitly out of scope for the v0.1 raw-strategy baseline.
bool G01_IsNewsBlocked(bool newsFilterEnabled)
  {
   if(!newsFilterEnabled)
      return(false);
   return(false);
  }

#endif // AT24_G01_FILTERS_MQH
