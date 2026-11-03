//+------------------------------------------------------------------+
//| Self-test: runs the Trend Pullback core on real bars and dumps   |
//| bars + results to MQL5\Files\Pullback_selftest.csv for an        |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_Pullback_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("TPTEST FAIL bars=", n); return; }
   double h[], l[], c[], ef[], em[], es[], at[]; int tr[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(ef, n); ArrayResize(em, n); ArrayResize(es, n); ArrayResize(at, n); ArrayResize(tr, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24TP_Ema(n, c, 20, ef); AT24TP_Ema(n, c, 50, em); AT24TP_Ema(n, c, 200, es);
   AT24TP_Atr(n, h, l, c, 14, at);
   AT24TP_Trend(n, ef, em, es, at, 200, 5, 0.10, tr);
   AT24TP_Ev ev[];
   int ne = AT24TP_Events(n, h, l, c, ef, em, at, tr, 20, 20, ev);
   double st[]; AT24TP_Stats(ev, ne, st);
   PrintFormat("TPTEST events=%d resolved=%.0f resumed=%.1f%% failed=%.1f%% neither=%.1f%% depth=%.2f bars=%.1f up=%.0f down=%.0f", ne, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7]);
   int f = FileOpen("Pullback_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), DoubleToString(ef[i], 5), DoubleToString(em[i], 5), DoubleToString(es[i], 5), DoubleToString(at[i], 5), tr[i]);
   for(int k = 0; k < ne; k++) FileWrite(f, "ev", ev[k].idx, ev[k].dir, ev[k].outcome, ev[k].bars, DoubleToString(ev[k].depth, 4));
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 3), DoubleToString(st[2], 3), DoubleToString(st[3], 3), DoubleToString(st[4], 4), DoubleToString(st[5], 2), DoubleToString(st[6], 0), DoubleToString(st[7], 0));
   FileClose(f);
   Print("TPTEST done");
  }
