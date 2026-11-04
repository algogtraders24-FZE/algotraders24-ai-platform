//+------------------------------------------------------------------+
//| AT24_PropGuard_Core.mqh                                          |
//| Pure maths for the AT24 Prop Guard dashboard (no account calls). |
//+------------------------------------------------------------------+
#ifndef AT24_PROPGUARD_CORE_MQH
#define AT24_PROPGUARD_CORE_MQH

//--- trading-day key (yyyymmdd) for a server time and a daily reset hour (server time)
int AT24PG_DayKey(const datetime serverTime, const int resetHour)
  {
   MqlDateTime m;
   TimeToStruct(serverTime - resetHour * 3600, m);
   return m.year * 10000 + m.mon * 100 + m.day;
  }

//--- start of the current trading day (server time)
datetime AT24PG_DayStart(const datetime serverTime, const int resetHour)
  {
   MqlDateTime m;
   TimeToStruct(serverTime - resetHour * 3600, m);
   m.hour = 0; m.min = 0; m.sec = 0;
   return StructToTime(m) + resetHour * 3600;
  }

//--- out[0] daily limit $, [1] daily P/L $, [2] daily buffer left $, [3] daily used (0..1+),
//--- [4] total limit $, [5] total buffer left $, [6] total used (0..1+), [7] profit-target progress (0..1+)
void AT24PG_Calc(const double dayStartBase, const double equity, const double initial,
                 const double dailyPct, const double maxPct, const double targetPct, double &out[])
  {
   ArrayResize(out, 8);
   double dl = dayStartBase * dailyPct / 100.0;
   out[0] = dl;
   out[1] = equity - dayStartBase;
   out[2] = dl + out[1];
   out[3] = (dl > 0.0) ? MathMax(0.0, 1.0 - out[2] / dl) : 0.0;
   double tl = initial * maxPct / 100.0;
   out[4] = tl;
   out[5] = equity - (initial - tl);
   out[6] = (tl > 0.0) ? MathMax(0.0, 1.0 - out[5] / tl) : 0.0;
   out[7] = (targetPct > 0.0 && initial > 0.0) ? (equity - initial) / (initial * targetPct / 100.0) : 0.0;
  }

//--- 1 safe, 2 caution (>=50%), 3 danger (>=80%), 4 breach (>=100%)
int AT24PG_Status(const double used)
  {
   if(used >= 1.0) return 4;
   if(used >= 0.8) return 3;
   if(used >= 0.5) return 2;
   return 1;
  }

string AT24PG_StatusName(const int s)
  {
   switch(s)
     {
      case 1: return "WITHIN LIMITS";
      case 2: return "CAUTION";
      case 3: return "DANGER";
      case 4: return "LIMIT REACHED";
     }
   return "...";
  }

#endif // AT24_PROPGUARD_CORE_MQH
