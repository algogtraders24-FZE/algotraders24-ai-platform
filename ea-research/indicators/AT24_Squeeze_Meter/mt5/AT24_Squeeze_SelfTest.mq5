//+------------------------------------------------------------------+
//| Self-test: runs the Squeeze Meter core on real bars and dumps    |
//| bars + results to MQL5\Files\Squeeze_selftest.csv for an         |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_Squeeze_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("SQTEST FAIL bars=", n); return; }
   double h[], l[], c[], mid[], mom[], at[], ratio[]; int sq[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(mid, n); ArrayResize(mom, n); ArrayResize(at, n); ArrayResize(ratio, n); ArrayResize(sq, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24SQ_Calc(n, h, l, c, 20, 2.0, 20, 1.5, 14, mid, mom, at, ratio, sq);
   AT24SQ_Ev ev[];
   int ne = AT24SQ_Events(n, h, l, c, mid, at, sq, 6, 20, ev);
   double base = AT24SQ_Baseline(n, h, l, at, 20, 20);
   double st[]; AT24SQ_Stats(ev, ne, base, st);
   PrintFormat("SQTEST events=%d measured=%.0f medRange=%.2f baseline=%.2f above=%.1f%% momHit=%.1f%% best=%.2f medLen=%.0f", ne, st[0], st[1], st[2], st[3], st[5], st[4], st[6]);
   int f = FileOpen("Squeeze_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), DoubleToString(mid[i], 5), DoubleToString(mom[i], 5), DoubleToString(at[i], 5), DoubleToString(ratio[i], 5), sq[i]);
   for(int k = 0; k < ne; k++) FileWrite(f, "ev", ev[k].idx, ev[k].len, ev[k].mom, DoubleToString(ev[k].up, 4), DoubleToString(ev[k].dn, 4), DoubleToString(ev[k].range, 4));
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 4), DoubleToString(st[2], 4), DoubleToString(st[3], 3), DoubleToString(st[4], 4), DoubleToString(st[5], 3), DoubleToString(st[6], 1), DoubleToString(st[7], 0));
   FileClose(f);
   Print("SQTEST done");
  }
