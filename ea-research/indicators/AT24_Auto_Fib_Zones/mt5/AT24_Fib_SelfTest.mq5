//+------------------------------------------------------------------+
//| Self-test: runs the Auto Fib core on real bars and dumps bars +  |
//| swings + statistics to MQL5\Files\Fib_selftest.csv for an        |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_Fib_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("FBTEST FAIL bars=", n); return; }
   double h[], l[];
   ArrayResize(h, n); ArrayResize(l, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; }
   AT24FB_Swing sw[];
   int m = AT24FB_Swings(n, h, l, 5, sw);
   double st[]; AT24FB_Stats(sw, m, st);
   PrintFormat("FBTEST swings=%d legs=%.0f med=%.4f r236=%.1f r382=%.1f r50=%.1f r618=%.1f r786=%.1f beyond=%.1f resumed=%.1f shallowRes=%.1f (%.0f)", m, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7], st[8], st[9], st[10]);
   int f = FileOpen("Fib_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(h[i], 3), DoubleToString(l[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "sw", sw[k].idx, sw[k].conf, DoubleToString(sw[k].price, 3), sw[k].dir);
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 4), DoubleToString(st[2], 3), DoubleToString(st[3], 3), DoubleToString(st[4], 3), DoubleToString(st[5], 3), DoubleToString(st[6], 3), DoubleToString(st[7], 3), DoubleToString(st[8], 3), DoubleToString(st[9], 3), DoubleToString(st[10], 0));
   FileClose(f);
   Print("FBTEST done");
  }
