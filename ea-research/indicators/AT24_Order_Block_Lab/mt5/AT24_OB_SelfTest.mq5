//+------------------------------------------------------------------+
//| Self-test: order blocks and the touch / reaction study on real   |
//| H1 bars. Dumps MQL5\Files\OB_selftest.csv for a Python check.    |
//+------------------------------------------------------------------+
#include "AT24_OB_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 20000, r);
   if(n < 2000) { Print("OBTEST FAIL bars=", n); return; }
   double o[], h[], l[], c[];
   ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24OB_Block b[];
   int m = AT24OB_Find(n, o, h, l, c, 1.0, 100, 24, 0.5, b);
   double st[]; AT24OB_Stats(n, b, m, 100, 24, st);
   PrintFormat("OBTEST bars=%d blocks=%d measured=%.0f touched=%.1f%% (control %.1f%%) reacted=%.1f%% of %.0f (control %.1f%% of %.0f)", n, m, st[0], st[1], st[2], st[3], st[5], st[4], st[6]);
   int f = FileOpen("OB_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, m);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "ob", b[k].bar, b[k].conf, b[k].dir, DoubleToString(b[k].top, 3), DoubleToString(b[k].bottom, 3), DoubleToString(b[k].atr, 6), b[k].touch, b[k].ctrl, b[k].res, b[k].cres);
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 6), DoubleToString(st[2], 6), DoubleToString(st[3], 6), DoubleToString(st[4], 6), DoubleToString(st[5], 0), DoubleToString(st[6], 0));
   FileClose(f);
   Print("OBTEST done");
  }
