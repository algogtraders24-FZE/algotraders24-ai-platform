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
   datetime starts[3] = {D'2024.01.01', D'2025.06.01', D'2026.07.01'};
   for(int s = 0; s < 3; s++)
      for(int rule = 0; rule < 3; rule++)
        {
         AT24FL_Stat st;
         //--- bars before validFrom are excluded exactly as the indicator does
         int m = n - v0;
         datetime tt[]; double oo[], hh[], ll[], cc[]; int hrr[];
         ArrayResize(tt, m); ArrayResize(oo, m); ArrayResize(hh, m); ArrayResize(ll, m); ArrayResize(cc, m); ArrayResize(hrr, m);
         for(int i = 0; i < m; i++) { tt[i] = t[v0 + i]; oo[i] = o[v0 + i]; hh[i] = h[v0 + i]; ll[i] = l[v0 + i]; cc[i] = c[v0 + i]; hrr[i] = hr[v0 + i]; }
         AT24FL_Run(rule, 18, m, tt, oo, hh, ll, cc, hrr, starts[s], st);
         PrintFormat("FLTEST start=%s rule=%d n=%d mean=%.3fbp t=%.2f hit=%.1f%% drift=%.3f adj=%.3f tAdj=%.2f", TimeToString(starts[s], TIME_DATE), rule, st.n, st.meanBp, st.t, st.hitPct, st.driftBp, st.adjMeanBp, st.tAdj);
         FileWrite(f, "res", (long)starts[s], rule, st.n, DoubleToString(st.meanBp, 8), DoubleToString(st.sdBp, 8), DoubleToString(st.t, 8), DoubleToString(st.hitPct, 8), DoubleToString(st.cumBp, 6), DoubleToString(st.meanDir, 8), DoubleToString(st.driftBp, 8), DoubleToString(st.adjMeanBp, 8), DoubleToString(st.tAdj, 8));
        }
   FileClose(f);
   Print("FLTEST done");
  }
