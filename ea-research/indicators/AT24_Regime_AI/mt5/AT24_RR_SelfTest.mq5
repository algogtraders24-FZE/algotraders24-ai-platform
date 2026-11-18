//+------------------------------------------------------------------+
//| AT24_RR_SelfTest - dumps bars, features and the expected-range   |
//| result for the independent Python check; plus a cut-history test |
//+------------------------------------------------------------------+
#include "AT24_RA_Range.mqh"
input int InpBars = 20000;

void Dump(const string sym)
  {
   MqlRates r[]; int n = -1;
   for(int k = 0; k < 20 && n < 3000; k++) { n = CopyRates(sym, PERIOD_H1, 1, InpBars, r); if(n < 3000) Sleep(500); }
   if(n < 3000) { Print("RR selftest: no data for ", sym); return; }
   double h[], l[], c[]; datetime t[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(t, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double la14[], la24[], la120[], y[]; bool ok[], yok[];
   AT24RR_Series(n, h, l, c, la14, la24, la120, y, ok, yok);
   AT24RR_Out o; AT24RR_Run(n, 0, t, h, l, c, o);
   int f = FileOpen("RR_selftest_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "t", "high", "low", "close", "ok", "yok", "la14", "la24", "la120", "y");
   for(int i = 0; i < n; i++)
      FileWrite(f, (long)t[i], DoubleToString(h[i], 8), DoubleToString(l[i], 8), DoubleToString(c[i], 8), (int)ok[i], (int)yok[i],
                DoubleToString(la14[i], 12), DoubleToString(la24[i], 12), DoubleToString(la120[i], 12), DoubleToString(y[i], 12));
   FileClose(f);
   f = FileOpen("RR_out_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "ok", "pred", "q10", "q50", "q90", "mid", "lo", "hi", "midPct", "cover", "nCover", "nTrain");
   FileWrite(f, (int)o.ok, DoubleToString(o.pred, 12), DoubleToString(o.q10, 12), DoubleToString(o.q50, 12), DoubleToString(o.q90, 12), DoubleToString(o.mid, 10), DoubleToString(o.lo, 10), DoubleToString(o.hi, 10),
             DoubleToString(o.midPct, 10), DoubleToString(o.cover, 10), o.nCover, o.nTrain);
   FileClose(f);
   PrintFormat("RR selftest %s: %d bars, range %.5f (80 %% %.5f - %.5f) = %.2f %%, held %.1f %% of %d, train %d", sym, n, o.mid, o.lo, o.hi, o.midPct, o.cover * 100.0, o.nCover, o.nTrain);
  }

//--- no look-ahead: features of bars before a cut are the same with the history cut there; a model fitted with the last 24 + k bars removed predicts the same for bar k
void CutTest(const string sym)
  {
   MqlRates r[]; int n = CopyRates(sym, PERIOD_H1, 1, 6000, r);
   if(n < 3000) return;
   double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double a1[], a2[], a3[], y1[]; bool o1[], yo1[];
   AT24RR_Series(n, h, l, c, a1, a2, a3, y1, o1, yo1);
   int cuts[3] = {n - 500, n - 100, n - 37}; int bad = 0;
   for(int q = 0; q < 3; q++)
     {
      int m = cuts[q]; double h2[], l2[], c2[]; ArrayResize(h2, m); ArrayResize(l2, m); ArrayResize(c2, m);
      for(int i = 0; i < m; i++) { h2[i] = h[i]; l2[i] = l[i]; c2[i] = c[i]; }
      double b1[], b2[], b3[], y2[]; bool o2[], yo2[];
      AT24RR_Series(m, h2, l2, c2, b1, b2, b3, y2, o2, yo2);
      for(int i = 0; i < m; i++) if(o1[i] != o2[i] || MathAbs(a1[i] - b1[i]) > 1e-12 || MathAbs(a2[i] - b2[i]) > 1e-12 || MathAbs(a3[i] - b3[i]) > 1e-12) bad++;
     }
   PrintFormat("RR cut-history test %s: %d differing feature rows (0 = no look-ahead)", sym, bad);
  }

void OnStart()
  {
   CutTest("EURUSD"); CutTest("XAUUSD");
   Dump("EURUSD"); Dump("XAUUSD"); Dump("GBPUSD"); Dump("USDJPY"); Dump("USDCHF");
  }
