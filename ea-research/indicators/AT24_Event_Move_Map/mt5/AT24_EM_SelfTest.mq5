//+------------------------------------------------------------------+
//| Self-test: event move map on real XAUUSD M15 bars and the        |
//| terminal's own USD high-importance calendar history. Dumps       |
//| MQL5\Files\EM_selftest.csv for an independent Python check of    |
//| the per-release measurement, the baseline and the grouping.      |
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_Pullback_Core.mqh"
#include "AT24_EM_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 40000, r);
   if(n < 5000) { Print("EMTEST FAIL bars=", n); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_DetectAny("XAUUSD", clk, 60, meas, utc)) { Print("EMTEST FAIL clock"); return; }
   datetime t[]; double o[], h[], l[], c[], at[]; ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(at, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24TP_Atr(n, h, l, c, 14, at);
   MqlCalendarValue v[]; int cn = CalendarValueHistory(v, t[0] - 86400, t[n - 1], NULL, "USD");
   string names[]; AT24EM_Occ occ[]; datetime evs[]; int m = 0;
   ArrayResize(names, MathMax(cn, 1)); ArrayResize(occ, MathMax(cn, 1)); ArrayResize(evs, MathMax(cn, 1));
   for(int i = 0; i < cn; i++)
     {
      MqlCalendarEvent e;
      if(!CalendarEventById(v[i].event_id, e) || (int)e.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      datetime ts = v[i].time + (datetime)((long)AT24SC_OffsetHoursAtUtc(clk, v[i].time) * 3600);   // the offline terminal reports UTC
      names[m] = e.name; evs[m] = ts;
      AT24EM_Measure(n, t, o, h, l, c, at, ts, 900, 4, occ[m]);
      m++;
     }
   double base = AT24EM_Baseline(n, h, l, at, 4);
   AT24EM_Stat st[]; int ng = AT24EM_Group(names, occ, m, base, st);
   int f = FileOpen("EM_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, m, DoubleToString(base, 8), ng);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int i = 0; i < m; i++) FileWrite(f, "ev", (long)evs[i], names[i], occ[i].ok ? 1 : 0, DoubleToString(occ[i].moveBp, 6), DoubleToString(occ[i].rangeBp, 6), DoubleToString(occ[i].rangeAtr, 6));
   for(int k = 0; k < ng; k++) FileWrite(f, "stat", st[k].name, st[k].n, DoubleToString(st[k].meanAbsMove, 6), DoubleToString(st[k].meanRange, 6), DoubleToString(st[k].meanRangeX, 6), DoubleToString(st[k].maxRange, 6));
   FileClose(f);
   int ok = 0; for(int i = 0; i < m; i++) if(occ[i].ok) ok++;
   PrintFormat("EMTEST bars=%d calendar=%d high=%d measured=%d groups=%d baselineATR=%.3f", n, cn, m, ok, ng, base);
   Print("EMTEST done");
  }
