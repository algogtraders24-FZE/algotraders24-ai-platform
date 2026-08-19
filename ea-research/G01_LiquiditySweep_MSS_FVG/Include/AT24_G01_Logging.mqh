//+------------------------------------------------------------------+
//| AT24_G01_Logging.mqh                                                |
//| Structured research telemetry: Print() logging + CSV export.       |
//| File/Print I/O is near-identical on MT4 and MT5 (FileOpen flag     |
//| names and CSV delimiter argument are the same); this module needs  |
//| no platform-specific split.                                        |
//+------------------------------------------------------------------+
#ifndef AT24_G01_LOGGING_MQH
#define AT24_G01_LOGGING_MQH

#include "AT24_G01_Types.mqh"

int g_G01_csvHandle = INVALID_HANDLE;

string G01_SessionToString(ENUM_G01_SESSION s)
  {
   switch(s)
     {
      case SESSION_ASIA:              return("ASIA");
      case SESSION_LONDON:            return("LONDON");
      case SESSION_LONDON_NY_OVERLAP: return("LONDON_NY_OVERLAP");
      case SESSION_NEW_YORK:          return("NEW_YORK");
      case SESSION_ALL:               return("ALL_SESSIONS");
      default:                        return("OUTSIDE");
     }
  }

string G01_DirectionToString(ENUM_G01_DIRECTION d)
  {
   if(d == DIR_BULLISH) return("BULLISH");
   if(d == DIR_BEARISH) return("BEARISH");
   return("NONE");
  }

string G01_LiquidityTypeToString(ENUM_G01_LIQUIDITY_TYPE t)
  {
   switch(t)
     {
      case LIQ_PDH:            return("PDH");
      case LIQ_PDL:            return("PDL");
      case LIQ_PWH:            return("PWH");
      case LIQ_PWL:            return("PWL");
      case LIQ_EQH:            return("EQH");
      case LIQ_EQL:            return("EQL");
      case LIQ_SWING_HIGH_M15: return("M15_SWING_HIGH");
      case LIQ_SWING_LOW_M15:  return("M15_SWING_LOW");
      default:                 return("NONE");
     }
  }

string G01_InvalidationToString(ENUM_G01_INVALIDATION_REASON r)
  {
   switch(r)
     {
      case INVALID_SEQUENCE_TIMEOUT:         return("SEQUENCE_TIMEOUT");
      case INVALID_OPPOSING_SWEEP:           return("OPPOSING_SWEEP");
      case INVALID_OPPOSING_MSS:             return("OPPOSING_MSS");
      case INVALID_FVG_INVALIDATED_BY_CLOSE: return("FVG_INVALIDATED_BY_CLOSE");
      case INVALID_SPREAD_BLOCK:             return("SPREAD_BLOCK");
      case INVALID_SESSION_BLOCK:            return("SESSION_BLOCK");
      case INVALID_DAILY_LIMIT_REACHED:      return("DAILY_LIMIT_REACHED");
      case INVALID_MAX_POSITIONS_OPEN:       return("MAX_POSITIONS_OPEN");
      case INVALID_LIQUIDITY_STALE:          return("LIQUIDITY_STALE");
      default:                               return("NONE");
     }
  }

void G01_LogEvent(string tag,string message)
  {
   PrintFormat("[G01][%s] %s",tag,message);
  }

void G01_LogInvalidation(ENUM_G01_INVALIDATION_REASON reason,string context)
  {
   PrintFormat("[G01][INVALIDATED] reason=%s context=%s",G01_InvalidationToString(reason),context);
  }

bool G01_OpenCSV(string filename)
  {
   g_G01_csvHandle = FileOpen(filename,FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(g_G01_csvHandle == INVALID_HANDLE)
      return(false);
   FileWrite(g_G01_csvHandle,
             "timestamp","symbol","liquidity_type","liquidity_price","sweep_direction",
             "sweep_penetration","atr","displacement_ratio","mss_price","fvg_high","fvg_low",
             "fvg_size","entry","sl","tp","risk","session","spread","result","R_multiple","exit_reason");
   FileFlush(g_G01_csvHandle);
   return(true);
  }

void G01_CloseCSV()
  {
   if(g_G01_csvHandle != INVALID_HANDLE)
     {
      FileClose(g_G01_csvHandle);
      g_G01_csvHandle = INVALID_HANDLE;
     }
  }

void G01_WriteTradeCSV(int digits,datetime ts,string symbol,const SLiquidityLevel &liq,
                        const SSweepEvent &sweep,double atrValue,double displacementRatio,
                        double mssPrice,const SFVGEvent &fvg,double entry,double sl,double tp,
                        double riskPercent,ENUM_G01_SESSION session,double spread,
                        string result,double rMultiple,string exitReason)
  {
   if(g_G01_csvHandle == INVALID_HANDLE)
      return;
   FileWrite(g_G01_csvHandle,
             TimeToString(ts,TIME_DATE|TIME_SECONDS),
             symbol,
             G01_LiquidityTypeToString(liq.type),
             DoubleToString(liq.price,digits),
             G01_DirectionToString(sweep.direction),
             DoubleToString(sweep.penetration_atr,3),
             DoubleToString(atrValue,digits),
             DoubleToString(displacementRatio,3),
             DoubleToString(mssPrice,digits),
             DoubleToString(fvg.upper,digits),
             DoubleToString(fvg.lower,digits),
             DoubleToString(fvg.size_price,digits),
             DoubleToString(entry,digits),
             DoubleToString(sl,digits),
             DoubleToString(tp,digits),
             DoubleToString(riskPercent,2),
             G01_SessionToString(session),
             DoubleToString(spread,1),
             result,
             DoubleToString(rMultiple,3),
             exitReason);
   FileFlush(g_G01_csvHandle);
  }

#endif // AT24_G01_LOGGING_MQH
