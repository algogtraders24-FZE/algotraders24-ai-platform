//+------------------------------------------------------------------+
//| AT24_AF_SelfTest - dumps bars, features and the Analog Finder    |
//| results (live query + self-test) for the independent Python check|
//+------------------------------------------------------------------+
#include "AT24_AF_Core.mqh"
input int InpBars = 9000;

void Dump(const string sym)
  {
   MqlRates r[]; int n = -1;
   for(int k = 0; k < 20 && n < 3000; k++) { n = CopyRates(sym, PERIOD_H1, 1, InpBars, r); if(n < 3000) Sleep(500); }
   if(n < 3000) { Print("AF selftest: no data for ", sym); return; }
   double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double f[], atr[], y[]; bool ok[], yok[];
   AT24AF_Series(n, h, l, c, f, atr, y, ok, yok);
   double mu[], sd[]; int sEnd;
   if(!AT24AF_Scale(n, f, ok, yok, mu, sd, sEnd)) { Print("AF selftest: scale failed ", sym); return; }
   AT24AF_Stat st; AT24AF_Search(n - 1, n - 1 - AT24AF_FWD, f, ok, yok, y, mu, sd, st);
   AT24AF_Self sf; AT24AF_SelfTest(n, f, ok, yok, y, mu, sd, sEnd, sf);
   int fh = FileOpen("AF_selftest_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(fh, "open_unused", "high", "low", "close");
   for(int i = 0; i < n; i++) FileWrite(fh, 0, DoubleToString(h[i], 8), DoubleToString(l[i], 8), DoubleToString(c[i], 8));
   FileClose(fh);
   fh = FileOpen("AF_feat_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(fh, "i", "ok", "yok", "y", "f0", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11");
   for(int i = AT24AF_FIRST; i < n; i += 7)
      FileWrite(fh, i, (int)ok[i], (int)yok[i], DoubleToString(y[i], 12), DoubleToString(f[i * 12], 12), DoubleToString(f[i * 12 + 1], 12), DoubleToString(f[i * 12 + 2], 12), DoubleToString(f[i * 12 + 3], 12),
                DoubleToString(f[i * 12 + 4], 12), DoubleToString(f[i * 12 + 5], 12), DoubleToString(f[i * 12 + 6], 12), DoubleToString(f[i * 12 + 7], 12), DoubleToString(f[i * 12 + 8], 12),
                DoubleToString(f[i * 12 + 9], 12), DoubleToString(f[i * 12 + 10], 12), DoubleToString(f[i * 12 + 11], 12));
   FileClose(fh);
   fh = FileOpen("AF_out_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(fh, "sEnd", "k", "mean", "q10", "q25", "q50", "q75", "q90", "shareUp", "meanDist", "idx", "nTest", "nSel", "bandHeld", "hit", "avgR", "p", "cls", "alwaysLong");
   string ids = ""; for(int i = 0; i < st.k; i++) ids += IntegerToString(st.idx[i]) + (i + 1 < st.k ? " " : "");
   FileWrite(fh, sEnd, st.k, DoubleToString(st.mean, 12), DoubleToString(st.q10, 12), DoubleToString(st.q25, 12), DoubleToString(st.q50, 12), DoubleToString(st.q75, 12), DoubleToString(st.q90, 12),
             DoubleToString(st.shareUp, 12), DoubleToString(st.meanDist, 12), ids, sf.nTest, sf.nSel, DoubleToString(sf.bandHeld, 12), DoubleToString(sf.hit, 12), DoubleToString(sf.avgR, 12), DoubleToString(sf.p, 12), sf.cls, DoubleToString(sf.alwaysLong, 12));
   FileClose(fh);
   PrintFormat("AF selftest %s: %d bars, %d analogs, median %.3f ATR, up %.0f %%, self-test %d points, band held %.1f %%, hit %.1f %% (n %d, p %.3f)", sym, n, st.k, st.q50, st.shareUp * 100.0, sf.nTest, sf.bandHeld * 100.0, sf.hit * 100.0, sf.nSel, sf.p);
  }

//--- no look-ahead: features and known-flags of bars before a cut are the same with the history cut there
void CutTest(const string sym)
  {
   MqlRates r[]; int n = CopyRates(sym, PERIOD_H1, 1, 6000, r);
   if(n < 3000) return;
   double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double f1[], a1[], y1[]; bool o1[], yo1[];
   AT24AF_Series(n, h, l, c, f1, a1, y1, o1, yo1);
   int cuts[3] = {n - 500, n - 100, n - 37}; int bad = 0;
   for(int q = 0; q < 3; q++)
     {
      int m = cuts[q]; double h2[], l2[], c2[]; ArrayResize(h2, m); ArrayResize(l2, m); ArrayResize(c2, m);
      for(int i = 0; i < m; i++) { h2[i] = h[i]; l2[i] = l[i]; c2[i] = c[i]; }
      double f2[], a2[], y2[]; bool o2[], yo2[];
      AT24AF_Series(m, h2, l2, c2, f2, a2, y2, o2, yo2);
      for(int i = 0; i < m; i++)
        {
         if(o1[i] != o2[i]) bad++;
         for(int a = 0; a < 12; a++) if(MathAbs(f1[i * 12 + a] - f2[i * 12 + a]) > 1e-12) bad++;
        }
     }
   PrintFormat("AF cut-history test %s: %d differing feature values (0 = no look-ahead)", sym, bad);
  }

void OnStart()
  {
   CutTest("EURUSD"); CutTest("XAUUSD");
   Dump("EURUSD"); Dump("XAUUSD"); Dump("GBPUSD"); Dump("USDJPY"); Dump("USDCHF");
  }
