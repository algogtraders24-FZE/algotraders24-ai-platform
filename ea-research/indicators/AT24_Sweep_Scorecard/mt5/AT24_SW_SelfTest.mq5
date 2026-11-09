//+------------------------------------------------------------------+
//| Self-test: Asian-range sweeps graded in R on real H1 bars.       |
//| Dumps MQL5\Files\SW_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_SW_Core.mqh"
int ValidFrom(const MqlRates &r[], const int n)
  {
   int i = 0;
   while(i < n)
     {
      long dk = (long)r[i].time / 86400; int j = i;
      while(j < n && (long)r[j].time / 86400 == dk) j++;
      if(j - i >= 20) return i;
      i = j;
     }
   return n;
  }
void OnStart()
  {
   MqlRates rr[];
   int n0 = CopyRates("XAUUSD", PERIOD_H1, 1, 40000, rr);
   if(n0 < 5000) { Print("SWTEST FAIL bars=", n0); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_Detect("XAUUSD", clk, 60, meas, utc)) { Print("SWTEST FAIL clock"); return; }
   int v0 = ValidFrom(rr, n0), n = n0 - v0;
   double o[], h[], l[], c[]; long gday[]; int ghour[]; long gm[]; datetime tt[];
   ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(gday, n); ArrayResize(ghour, n); ArrayResize(gm, n); ArrayResize(tt, n);
   for(int i = 0; i < n; i++)
     {
      MqlRates b = rr[v0 + i];
      o[i] = b.open; h[i] = b.high; l[i] = b.low; c[i] = b.close; tt[i] = b.time;
      datetime g = AT24SC_ToGmt(clk, b.time); gm[i] = (long)g; gday[i] = (long)g / 86400; ghour[i] = (int)(((long)g % 86400) / 3600);
     }
   AT24SW_Event ev[];
   int m = AT24SW_Find(n, gday, ghour, o, h, l, c, 7, 12, 16, 0.25, 0.5, ev);
   double st[], st1[]; AT24SW_Stats(ev, m, 0, st); AT24SW_Stats(ev, m, MathMax(0, m - 250), st1);
   PrintFormat("SWTEST bars=%d events=%d | all: rev %.4fR (t %.2f hit %.1f%%) cont %.4fR control %.4fR rev-control %.4fR (t %.2f) risk %.2f | last250: rev %.4fR", n, m, st[1], st[2], st[3], st[4], st[7], st[8], st[9], st[10], st1[1]);
   int f = FileOpen("SW_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, m);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", gm[i], DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "ev", ev[k].bar, ev[k].day, ev[k].dir, DoubleToString(ev[k].ext, 3), DoubleToString(ev[k].entry, 3), DoubleToString(ev[k].risk, 4), DoubleToString(ev[k].rev, 8), DoubleToString(ev[k].cont, 8));
   for(int z = 0; z < 11; z++) FileWrite(f, "st", z, DoubleToString(st[z], 8), DoubleToString(st1[z], 8));
   FileClose(f);
   Print("SWTEST done");
  }
