//+------------------------------------------------------------------+
//| Self-test: runs the FVG core on real bars and dumps bars + gaps  |
//| + statistics to MQL5\Files\FVG_selftest.csv for an independent   |
//| Python check.                                                    |
//+------------------------------------------------------------------+
#include "AT24_FVG_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("FVTEST FAIL bars=", n); return; }
   double h[], l[], c[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24FV_Gap g[];
   int m = AT24FV_Find(n, h, l, c, 14, 0.3, g);
   double st[]; AT24FV_Stats(n, h, l, c, g, m, 50, 20, st);
   PrintFormat("FVTEST gaps=%d measured=%.0f touched=%.1f%% filled=%.1f%% medWait=%.1f control=%.1f%% reacted=%.1f%% (%.0f)", m, st[0], st[1], st[2], st[3], st[4], st[5], st[6]);
   int f = FileOpen("FVG_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "gap", g[k].bar, g[k].dir, DoubleToString(g[k].top, 3), DoubleToString(g[k].bottom, 3), g[k].touch, g[k].fill);
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 3), DoubleToString(st[2], 3), DoubleToString(st[3], 2), DoubleToString(st[4], 3), DoubleToString(st[5], 3), DoubleToString(st[6], 0));
   FileClose(f);
   Print("FVTEST done");
  }
