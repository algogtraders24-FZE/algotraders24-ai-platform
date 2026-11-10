//+------------------------------------------------------------------+
//| AT24_ServerClock.mqh                                             |
//| Broker server time <-> GMT with the broker's daylight-time rule. |
//|                                                                  |
//| Many brokers run GMT+2 in winter and GMT+3 in summer, following  |
//| either the US or the European calendar (or no DST at all). The   |
//| two calendars change on different dates, so a single "current    |
//| offset" is one hour wrong for several weeks every year, and it   |
//| is wrong in the Strategy Tester (TimeGMT() = server time there). |
//|                                                                  |
//| Method: FX / metal / index CFD weeks close at 17:00 New York.    |
//| The last H1 bar before every weekend therefore ends at a known   |
//| UTC instant; comparing it with the server time of that bar gives |
//| the broker's offset for that week. Every base offset is then     |
//| tested with three rules (fixed, +1h in US summer time, +1h in EU |
//| summer time) and the rule that explains the most weekends wins.  |
//| No external data, no web calls.                                  |
//| (c) AlgoTraders24 - algotraders24.ai                             |
//+------------------------------------------------------------------+
#ifndef AT24_SERVERCLOCK_MQH
#define AT24_SERVERCLOCK_MQH

enum ENUM_AT24SC_RULE
  {
   AT24SC_UNKNOWN = 0,
   AT24SC_FIXED   = 1,    // no daylight saving
   AT24SC_US      = 2,    // +1 hour while the US is on summer time
   AT24SC_EU      = 3     // +1 hour while Europe is on summer time
  };

struct AT24SC_Clock
  {
   bool     ok;           // detection succeeded
   int      base;         // winter offset in hours (server - GMT)
   int      rule;         // ENUM_AT24SC_RULE
   int      hitsRecent;   // weekends (of the latest 8) explained by base + rule
   int      hitsAll;      // all weekends explained
   int      weeks;        // weekends used
  };

//--- calendar helpers (UTC) -------------------------------------------------------------------
//--- day of month of the n-th Sunday of a month (n = 1..4) or the last Sunday (n = 5)
int AT24SC_NthSunday(const int year, const int mon, const int n)
  {
   MqlDateTime m; m.year = year; m.mon = mon; m.day = 1; m.hour = 12; m.min = 0; m.sec = 0; m.day_of_week = 0; m.day_of_year = 0;
   datetime d1 = StructToTime(m);
   MqlDateTime q; TimeToStruct(d1, q);
   int firstSun = 1 + (7 - q.day_of_week) % 7;          // day_of_week: 0 = Sunday
   if(n <= 4) return firstSun + 7 * (n - 1);
   int dimTab[12] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
   int dim = dimTab[mon - 1];
   if(mon == 2 && ((year % 4 == 0 && year % 100 != 0) || year % 400 == 0)) dim = 29;
   int last = firstSun;
   while(last + 7 <= dim) last += 7;
   return last;
  }

datetime AT24SC_Utc(const int year, const int mon, const int day, const int hour)
  {
   MqlDateTime m; m.year = year; m.mon = mon; m.day = day; m.hour = hour; m.min = 0; m.sec = 0; m.day_of_week = 0; m.day_of_year = 0;
   return StructToTime(m);
  }

//--- US summer time: from 02:00 local (07:00 UTC) on the 2nd Sunday of March to 02:00 local (06:00 UTC) on the 1st Sunday of November
bool AT24SC_UsDst(const datetime utc)
  {
   MqlDateTime t; TimeToStruct(utc, t);
   datetime a = AT24SC_Utc(t.year, 3, AT24SC_NthSunday(t.year, 3, 2), 7);
   datetime b = AT24SC_Utc(t.year, 11, AT24SC_NthSunday(t.year, 11, 1), 6);
   return (utc >= a && utc < b);
  }

//--- EU summer time: from 01:00 UTC on the last Sunday of March to 01:00 UTC on the last Sunday of October
bool AT24SC_EuDst(const datetime utc)
  {
   MqlDateTime t; TimeToStruct(utc, t);
   datetime a = AT24SC_Utc(t.year, 3, AT24SC_NthSunday(t.year, 3, 5), 1);
   datetime b = AT24SC_Utc(t.year, 10, AT24SC_NthSunday(t.year, 10, 5), 1);
   return (utc >= a && utc < b);
  }

bool AT24SC_RuleDst(const int rule, const datetime utc)
  {
   if(rule == AT24SC_US) return AT24SC_UsDst(utc);
   if(rule == AT24SC_EU) return AT24SC_EuDst(utc);
   return false;
  }

//--- New York offset to UTC in hours (-5 winter, -4 summer)
int AT24SC_NyOffsetHours(const datetime utc) { return AT24SC_UsDst(utc) ? -4 : -5; }

//--- detection ----------------------------------------------------------------------------------
//--- Server offset in effect at a given UTC instant, for a detected clock
int AT24SC_OffsetHoursAtUtc(const AT24SC_Clock &c, const datetime utc)
  {
   return c.base + (AT24SC_RuleDst(c.rule, utc) ? 1 : 0);
  }

//--- Convert a server time to GMT (seconds-accurate; uses the rule, not the PC clock)
datetime AT24SC_ToGmt(const AT24SC_Clock &c, const datetime serverTime)
  {
   if(!c.ok) return serverTime - (datetime)((long)(TimeTradeServer() - TimeGMT()));
   long u = (long)serverTime - (long)c.base * 3600;
   int off = AT24SC_OffsetHoursAtUtc(c, (datetime)u);
   u = (long)serverTime - (long)off * 3600;
   off = AT24SC_OffsetHoursAtUtc(c, (datetime)u);
   return (datetime)((long)serverTime - (long)off * 3600);
  }

//--- Offset (seconds, server - GMT) in effect at a server time
int AT24SC_OffsetSecAtServer(const AT24SC_Clock &c, const datetime serverTime)
  {
   return (int)((long)serverTime - (long)AT24SC_ToGmt(c, serverTime));
  }

//--- Detect the clock from the H1 history of `sym`. weeksBack: how many weeks of history to look at (max ~120).
//--- `measuredOut`/`utcOut` (optional, may be empty arrays) receive the measured offset (hours) and the UTC close instant of each weekend.
bool AT24SC_Detect(const string sym, AT24SC_Clock &c, const int weeksBack, int &measuredOut[], datetime &utcOut[])
  {
   c.ok = false; c.base = 0; c.rule = AT24SC_UNKNOWN; c.hitsRecent = 0; c.hitsAll = 0; c.weeks = 0;
   ArrayResize(measuredOut, 0); ArrayResize(utcOut, 0);
   MqlRates r[];
   int want = MathMin(weeksBack, 120) * 5 * 24 + 200;
   int n = CopyRates(sym, PERIOD_H1, 1, want, r);
   if(n < 24 * 5 * 6) return false;
   ArraySetAsSeries(r, false);
   int hint = 2;   // MT4: TimeCurrent() is stale when the market is closed, so a fixed hint (candidate offsets are 24 h apart)
   int cnt = 0;
   for(int i = 1; i < n; i++)
     {
      long gap = (long)(r[i].time - r[i - 1].time);
      if(gap < 44 * 3600 || gap > 54 * 3600) continue;       // an ordinary weekend break
      datetime endServer = r[i - 1].time + 3600;             // the weekly close
      //--- the UTC date of that Friday: try the neighbouring dates, keep the one giving an offset closest to the hint
      int bestOff = 99; datetime bestUtc = 0;
      for(int dd = -1; dd <= 1; dd++)
        {
         long dayStart = (((long)endServer - (long)hint * 3600) / 86400 + dd) * 86400;
         int nyOff = AT24SC_NyOffsetHours((datetime)(dayStart + 17 * 3600));
         datetime closeUtc = (datetime)(dayStart + (long)(17 - nyOff) * 3600);
         long diff = (long)endServer - (long)closeUtc;
         if(diff % 3600 != 0) continue;
         int off = (int)(diff / 3600);
         if(off < -12 || off > 14) continue;
         if(MathAbs(off - hint) < MathAbs(bestOff - hint)) { bestOff = off; bestUtc = closeUtc; }
        }
      if(bestOff == 99) continue;
      ArrayResize(measuredOut, cnt + 1); ArrayResize(utcOut, cnt + 1);
      measuredOut[cnt] = bestOff; utcOut[cnt] = bestUtc;
      cnt++;
     }
   c.weeks = cnt;
   if(cnt < 6) return false;
   int bestScore = -1, bestAll = -1, bBase = 0, bRule = AT24SC_UNKNOWN;
   int rules[3]; rules[0] = AT24SC_FIXED; rules[1] = AT24SC_US; rules[2] = AT24SC_EU;
   for(int bs = -12; bs <= 14; bs++)
      for(int k = 0; k < 3; k++)
        {
         int recent = 0, all = 0;
         for(int w = 0; w < cnt; w++)
           {
            int pred = bs + (AT24SC_RuleDst(rules[k], utcOut[w]) ? 1 : 0);
            if(pred == measuredOut[w]) { all++; if(w >= cnt - 8) recent++; }
           }
         bool better = (recent > bestScore) || (recent == bestScore && all > bestAll);
         if(better) { bestScore = recent; bestAll = all; bBase = bs; bRule = rules[k]; }
        }
   c.base = bBase; c.rule = bRule; c.hitsRecent = bestScore; c.hitsAll = bestAll;
   c.ok = (bestAll >= (cnt * 3) / 4);
   return c.ok;
  }

string AT24SC_RuleName(const int rule)
  {
   switch(rule) { case AT24SC_FIXED: return "fixed (no DST)"; case AT24SC_US: return "US daylight time"; case AT24SC_EU: return "EU daylight time"; }
   return "unknown";
  }

//--- fallbacks (added 2026-11-10): some brokers close metals at other hours than 17:00 New York, which makes detection on the chart symbol fail.
//--- the server clock is the same for every symbol, so try the major FX pairs (they always close Friday 17:00 New York) when the chart symbol does not work.
bool AT24SC_DetectAny(const string sym, AT24SC_Clock &c, const int weeksBack, int &measuredOut[], datetime &utcOut[])
  {
   if(AT24SC_Detect(sym, c, weeksBack, measuredOut, utcOut)) return true;
   string alt[6] = {"EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF"};
   for(int i = 0; i < 6; i++)
     {
      if(alt[i] == sym) continue;
      if(!SymbolSelect(alt[i], true)) continue;
      if(AT24SC_Detect(alt[i], c, weeksBack, measuredOut, utcOut)) return true;
     }
   return false;
  }

//--- manual clock: winter offset in hours (server - GMT) and the daylight rule (ENUM_AT24SC_RULE: 1 none, 2 US, 3 EU)
void AT24SC_SetManual(AT24SC_Clock &c, const int baseHours, const int rule)
  {
   c.ok = true; c.base = baseHours; c.rule = rule; c.hitsRecent = 0; c.hitsAll = 0; c.weeks = 0;
  }

#endif // AT24_SERVERCLOCK_MQH
