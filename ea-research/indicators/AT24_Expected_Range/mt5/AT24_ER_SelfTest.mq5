//+------------------------------------------------------------------+
//| Self-test: runs the Expected Range core on real bars and dumps   |
//| bars + days + statistics to MQL5\Files\ER_selftest.csv for an    |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_ER_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("ERTEST FAIL bars=", n); return; }
   datetime t[]; double o[], h[], l[], c[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24ER_Day d[];
   int m = AT24ER_Days(n, t, o, h, l, c, 14, d);
   double st[]; AT24ER_Stats(d, m, st);
   PrintFormat("ERTEST days=%d measured=%.0f med=%.3f r100=%.1f%% r150=%.1f%% hits=%.0f hit125=%.1f%% hitMed=%.3f dir=%.1f%%", m, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7]);
   int f = FileOpen("ER_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "day", d[k].first, d[k].last, DoubleToString(d[k].exp, 4), d[k].hit);
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 4), DoubleToString(st[2], 3), DoubleToString(st[3], 3), DoubleToString(st[4], 0), DoubleToString(st[5], 3), DoubleToString(st[6], 4), DoubleToString(st[7], 3));
   FileClose(f);
   Print("ERTEST done");
  }
