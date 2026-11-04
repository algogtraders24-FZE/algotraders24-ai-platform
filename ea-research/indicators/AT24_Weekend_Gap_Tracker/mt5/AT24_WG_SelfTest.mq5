//+------------------------------------------------------------------+
//| Self-test: weekend gaps on real H1 bars. Dumps                   |
//| MQL5\Files\WG_selftest.csv for an independent Python check.      |
//+------------------------------------------------------------------+
#include "AT24_WG_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 20000, r);
   if(n < 2000) { Print("WGTEST FAIL bars=", n); return; }
   datetime t[]; double o[], h[], l[], c[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24WG_Gap g[];
   int m = AT24WG_Find(n, t, o, h, l, c, 12 * 3600, 0.1, g);
   int win[4] = {1, 4, 24, 120};
   double st[]; AT24WG_Stats(n, g, m, win, 4, st);
   PrintFormat("WGTEST bars=%d gaps=%d measured=%.0f up=%.1f%% medATR=%.2f fill1=%.1f/%.1f fill4=%.1f/%.1f fill24=%.1f/%.1f fill120=%.1f/%.1f (gap/control)", n, m, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7], st[8], st[9], st[10]);
   int f = FileOpen("WG_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, m);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "gap", g[k].bar, DoubleToString(g[k].prevClose, 3), DoubleToString(g[k].open, 3), DoubleToString(g[k].size, 3), DoubleToString(g[k].atr, 6), g[k].fillBar, g[k].ctrlBar);
   string row = "stats";
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 6), DoubleToString(st[2], 6), DoubleToString(st[3], 6), DoubleToString(st[4], 6), DoubleToString(st[5], 6), DoubleToString(st[6], 6), DoubleToString(st[7], 6), DoubleToString(st[8], 6), DoubleToString(st[9], 6), DoubleToString(st[10], 6));
   FileClose(f);
   Print("WGTEST done");
  }
