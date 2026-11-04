//+------------------------------------------------------------------+
//| Self-test: daily volume profile levels and the level study on    |
//| real bars. Dumps MQL5\Files\VP_selftest.csv for a Python check.  |
//+------------------------------------------------------------------+
#include "AT24_VP_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("VPTEST FAIL bars=", n); return; }
   datetime t[]; double o[], h[], l[], c[], v[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(v, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; v[i] = (double)r[i].tick_volume; }
   AT24VP_Day d[];
   int m = AT24VP_Days(n, t, h, l, v, 60, 0.70, d);
   double st[]; AT24VP_Study(n, o, h, l, c, d, m, 24, 0.15, st);
   string nm[3] = {"POC", "VAH", "VAL"};
   for(int k = 0; k < 3; k++) PrintFormat("VPTEST %s days=%.0f touch=%.1f%% ctrlTouch=%.1f%% react=%.1f%% ctrlReact=%.1f%% decided=%.0f", nm[k], st[k * 6], st[k * 6 + 1], st[k * 6 + 2], st[k * 6 + 3], st[k * 6 + 4], st[k * 6 + 5]);
   int f = FileOpen("VP_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, m);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), DoubleToString(v[i], 0));
   for(int k = 0; k < m; k++) FileWrite(f, "day", d[k].first, d[k].last, DoubleToString(d[k].poc, 5), DoubleToString(d[k].vah, 5), DoubleToString(d[k].val, 5), d[k].ok ? 1 : 0);
   for(int k = 0; k < 3; k++) FileWrite(f, "study", nm[k], DoubleToString(st[k * 6], 0), DoubleToString(st[k * 6 + 1], 6), DoubleToString(st[k * 6 + 2], 6), DoubleToString(st[k * 6 + 3], 6), DoubleToString(st[k * 6 + 4], 6), DoubleToString(st[k * 6 + 5], 0));
   FileClose(f);
   Print("VPTEST done");
  }
