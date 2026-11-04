//+------------------------------------------------------------------+
//| Self-test: high-impact USD news windows vs quiet days, on real   |
//| bars. Dumps bars + events + results to MQL5\Files\NW_selftest.csv|
//| for an independent Python check. The test terminal has no broker |
//| login, so calendar times (UTC there) are converted to the broker |
//| server clock with the DST-aware clock, as a logged-in terminal   |
//| would deliver them.                                              |
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_NW_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("NWTEST FAIL bars=", n); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_Detect("XAUUSD", clk, 60, meas, utc)) { Print("NWTEST FAIL clock"); return; }
   datetime t[]; double h[], l[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; h[i] = r[i].high; l[i] = r[i].low; }
   MqlCalendarValue v[];
   //--- calendar clock = the terminal's trade-server clock (UTC + tsOff); TimeTradeServer() is the terminal's notion of it
   long tsOff = (long)MathRound((double)(TimeTradeServer() - TimeGMT()) / 1800.0) * 1800;
   datetime from = AT24SC_ToGmt(clk, t[0]) + (datetime)tsOff - 86400, to = AT24SC_ToGmt(clk, t[n - 1]) + (datetime)tsOff;
   int cn = CalendarValueHistory(v, from, to, NULL, "USD");
   datetime ev[]; int m = 0;
   for(int i = 0; i < cn; i++)
     {
      MqlCalendarEvent e;
      if(!CalendarEventById(v[i].event_id, e) || e.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      datetime utcT = v[i].time - (datetime)tsOff;
      datetime srv = utcT + (datetime)((long)AT24SC_OffsetHoursAtUtc(clk, utcT) * 3600);
      if(srv < t[0] || srv > t[n - 1]) continue;
      ArrayResize(ev, m + 1); ev[m] = srv; m++;
     }
   //--- sort (calendar returns time order, but be sure) and de-duplicate identical times kept: simultaneous releases are separate events
   ArraySort(ev);
   double ratio[], st[];
   AT24NW_Study(n, t, h, l, ev, m, 2, 3600, ratio, st);
   PrintFormat("NWTEST tsOff=%d calendar=%d events=%d measured=%.0f medEvent=%.3f medCtrl=%.3f medRatio=%.3f r15=%.1f%% r2=%.1f%% lt1=%.1f%% ctrl=%.0f", (int)tsOff, cn, m, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7]);
   int f = FileOpen("NW_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, m);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "ev", (long)ev[k], DoubleToString(ratio[k], 5));
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 4), DoubleToString(st[2], 4), DoubleToString(st[3], 5), DoubleToString(st[4], 3), DoubleToString(st[5], 3), DoubleToString(st[6], 3), DoubleToString(st[7], 0));
   FileClose(f);
   Print("NWTEST done");
  }
