//+------------------------------------------------------------------+
//| Self-test: forward-ledger rules replayed on real H1 bars from    |
//| three start dates. Dumps MQL5\Files\FL_selftest.csv for an       |
//| independent Python check (incl. zoneinfo for the New York hour). |
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_FL_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 40000, r);
   if(n < 5000) { Print("FLTEST FAIL bars=", n); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_Detect("XAUUSD", clk, 60, meas, utc)) { Print("FLTEST FAIL clock"); return; }
   datetime t[]; double o[], h[], l[], c[]; int hr[]; long gm[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(hr, n); ArrayResize(gm, n);
   for(int i = 0; i < n; i++)
     {
      t[i] = r[i].time; o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close;
      datetime g = AT24SC_ToGmt(clk, r[i].time); gm[i] = (long)g;
      hr[i] = (int)(((long)(g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600)) % 86400) / 3600);
     }
   int v0 = AT24FL_ValidFrom(n, t, 20);
   PrintFormat("FLTEST bars=%d first=%s validFrom=%d (%s)", n, TimeToString(t[0]), v0, TimeToString(t[MathMin(v0, n - 1)]));
   int f = FileOpen("FL_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, v0);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], gm[i], hr[i], DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   //--- calendar events for rule 4: raw values dumped (terminal clock = UTC offline), filtered and converted here exactly as the indicator does
   string names[10] = {"Nonfarm Payrolls", "Average Hourly Earnings m/m", "CPI m/m", "CPI y/y", "Core CPI m/m", "Core PCE Price Index m/m", "Retail Sales m/m", "ISM Manufacturing PMI", "ISM Non-Manufacturing PMI", "GDP q/q"};
   datetime evT[]; int evD[]; int evN = 0;
   MqlCalendarValue cv[];
   int cn = CalendarValueHistory(cv, D'2023.01.01', TimeTradeServer() + 86400, NULL, "USD");
   ArrayResize(evT, MathMax(cn, 1)); ArrayResize(evD, MathMax(cn, 1));
   for(int i = 0; i < cn; i++)
     {
      if(cv[i].actual_value == LONG_MIN || cv[i].forecast_value == LONG_MIN) continue;
      MqlCalendarEvent ce;
      if(!CalendarEventById(cv[i].event_id, ce) || (int)ce.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      FileWrite(f, "ev", (long)cv[i].time, ce.name, cv[i].actual_value, cv[i].forecast_value);
      bool ok = false;
      for(int k = 0; k < 10; k++) if(ce.name == names[k]) { ok = true; break; }
      if(!ok || cv[i].actual_value == cv[i].forecast_value) continue;
      datetime t = cv[i].time + (datetime)((long)AT24SC_OffsetHoursAtUtc(clk, cv[i].time) * 3600);
      evT[evN] = t; evD[evN] = (cv[i].actual_value > cv[i].forecast_value) ? -1 : 1; evN++;
     }
   for(int i = 1; i < evN; i++) { datetime tt0 = evT[i]; int dd0 = evD[i]; int j = i - 1; while(j >= 0 && evT[j] > tt0) { evT[j + 1] = evT[j]; evD[j + 1] = evD[j]; j--; } evT[j + 1] = tt0; evD[j + 1] = dd0; }
   PrintFormat("FLTEST events calendar=%d used=%d", cn, evN);
   datetime starts[3] = {D'2024.01.01', D'2025.06.01', D'2026.07.01'};
   for(int s = 0; s < 3; s++)
      for(int rule = 0; rule < 5; rule++)
        {
         AT24FL_Stat st;
         //--- bars before validFrom are excluded exactly as the indicator does
         int m = n - v0;
         datetime tt[]; double oo[], hh[], ll[], cc[]; int hrr[]; int ghh[]; long gdd[];
         ArrayResize(ghh, m); ArrayResize(gdd, m); ArrayResize(tt, m); ArrayResize(oo, m); ArrayResize(hh, m); ArrayResize(ll, m); ArrayResize(cc, m); ArrayResize(hrr, m);
         for(int i = 0; i < m; i++) { tt[i] = t[v0 + i]; oo[i] = o[v0 + i]; hh[i] = h[v0 + i]; ll[i] = l[v0 + i]; cc[i] = c[v0 + i]; hrr[i] = hr[v0 + i]; ghh[i] = (int)((gm[v0 + i] % 86400) / 3600); gdd[i] = gm[v0 + i] / 86400; }
         if(rule == 3) AT24FL_RunRelay(m, tt, oo, cc, ghh, gdd, starts[s], st); else if(rule == 4) AT24FL_RunEvents(m, tt, oo, cc, evN, evT, evD, starts[s], st); else AT24FL_Run(rule, 18, m, tt, oo, hh, ll, cc, hrr, starts[s], st);
         PrintFormat("FLTEST start=%s rule=%d n=%d mean=%.3fbp t=%.2f hit=%.1f%% drift=%.3f adj=%.3f tAdj=%.2f", TimeToString(starts[s], TIME_DATE), rule, st.n, st.meanBp, st.t, st.hitPct, st.driftBp, st.adjMeanBp, st.tAdj);
         FileWrite(f, "res", (long)starts[s], rule, st.n, DoubleToString(st.meanBp, 8), DoubleToString(st.sdBp, 8), DoubleToString(st.t, 8), DoubleToString(st.hitPct, 8), DoubleToString(st.cumBp, 6), DoubleToString(st.meanDir, 8), DoubleToString(st.driftBp, 8), DoubleToString(st.adjMeanBp, 8), DoubleToString(st.tAdj, 8));
        }
   FileClose(f);
   Print("FLTEST done");
  }
