//+------------------------------------------------------------------+
//| AT24_G01_StateMachine.mqh                                          |
//| PURE, PLATFORM-AGNOSTIC. State-transition/logging/reset helpers    |
//| shared by the sequencing logic. Print()/TimeToStruct() are         |
//| available on both MT4 and MT5 with identical semantics.            |
//+------------------------------------------------------------------+
#ifndef AT24_G01_STATEMACHINE_MQH
#define AT24_G01_STATEMACHINE_MQH

#include "AT24_G01_Types.mqh"
#include "AT24_G01_Logging.mqh"

string G01_StateToString(ENUM_G01_STATE s)
  {
   switch(s)
     {
      case STATE_IDLE:                  return("IDLE");
      case STATE_LIQUIDITY_IDENTIFIED:  return("LIQUIDITY_IDENTIFIED");
      case STATE_SWEEP_CONFIRMED:       return("SWEEP_CONFIRMED");
      case STATE_DISPLACEMENT_CONFIRMED:return("DISPLACEMENT_CONFIRMED");
      case STATE_MSS_CONFIRMED:         return("MSS_CONFIRMED");
      case STATE_FVG_CONFIRMED:         return("FVG_CONFIRMED");
      case STATE_WAITING_RETEST:        return("WAITING_RETEST");
      case STATE_ENTRY:                 return("ENTRY");
      case STATE_INVALIDATED:           return("INVALIDATED");
      default:                          return("UNKNOWN");
     }
  }

void G01_TransitionTo(ENUM_G01_STATE &state,ENUM_G01_STATE next)
  {
   if(state != next)
      G01_LogEvent("STATE",G01_StateToString(state) + " -> " + G01_StateToString(next));
   state = next;
  }

//--- Reset all working case data and return to IDLE, logging the reason.
void G01_InvalidateCase(ENUM_G01_STATE &state,SCaseData &c,ENUM_G01_INVALIDATION_REASON reason,
                         string context)
  {
   G01_LogInvalidation(reason,context);
   ZeroMemory(c);
   G01_TransitionTo(state,STATE_IDLE);
  }

//--- Roll the daily trade counter over when the calendar date changes (broker/server time).
void G01_UpdateDailyCounter(datetime now,datetime &lastDay,int &count)
  {
   MqlDateTime a,b;
   TimeToStruct(now,a);
   TimeToStruct(lastDay,b);
   if(a.day != b.day || a.mon != b.mon || a.year != b.year)
     {
      count = 0;
      lastDay = now;
     }
  }

#endif // AT24_G01_STATEMACHINE_MQH
