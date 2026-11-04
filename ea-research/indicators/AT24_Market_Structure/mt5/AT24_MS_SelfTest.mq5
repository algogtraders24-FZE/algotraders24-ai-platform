//+------------------------------------------------------------------+
//| Self-test: runs the Market Structure core on real bars and dumps |
//| bars + events + statistics to MQL5\Files\MS_selftest.csv for an  |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_MS_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("MSTEST FAIL bars=", n); return; }
   double h[], l[], c[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24MS_Event ev[]; int trend; double hp, lp; int hb, lb;
   int m = AT24MS_Scan(n, h, l, c, 5, ev, trend, hp, hb, lp, lb);
   double st[]; AT24MS_Stats(n, c, ev, m, 20, st);
   PrintFormat("MSTEST events=%d bos=%.0f (%.1f%% of %.0f) choch=%.0f (%.1f%% of %.0f) base=%.2f trend=%d", m, st[0], st[1], st[5], st[2], st[3], st[6], st[4], trend);
   int f = FileOpen("MS_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "ev", ev[k].bar, ev[k].lvlBar, DoubleToString(ev[k].level, 3), ev[k].dir, ev[k].type);
   FileWrite(f, "state", trend, DoubleToString(hp, 3), hb, DoubleToString(lp, 3), lb);
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 3), DoubleToString(st[2], 0), DoubleToString(st[3], 3), DoubleToString(st[4], 3), DoubleToString(st[5], 0), DoubleToString(st[6], 0));
   FileClose(f);
   Print("MSTEST done");
  }
