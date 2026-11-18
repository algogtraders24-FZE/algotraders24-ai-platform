//+------------------------------------------------------------------+
//| AT24_RA_SelfTest - dumps bars, features, states and statistics   |
//| of the Regime AI core to CSV for the independent Python check.   |
//+------------------------------------------------------------------+
#include "AT24_RA_Core.mqh"
input int    InpBars = 8000;

void Dump(const string InpSym)
  {
   MqlRates r[];
   int n = -1;
   for(int t = 0; t < 20 && n < 500; t++) { n = CopyRates(InpSym, PERIOD_H1, 1, InpBars, r); if(n < 500) Sleep(500); }
   if(n < 500) { Print("RA selftest: no data for ", InpSym); return; }
   double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double atr[], er[], lv[], sl[], rg[], fr[]; bool ok[]; int st[];
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   AT24RA_States(n, er, lv, sl, rg, ok, st);
   AT24RA_Forward(n, h, l, atr, ok, fr);
   AT24RA_Stat s; AT24RA_Stats(n, AT24RA_FIRST, st, fr, s);
   int f = FileOpen("RA_selftest_" + InpSym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "time", "open", "high", "low", "close", "atr14", "er", "lvol", "slope", "rngx", "state", "fr");
   for(int i = 0; i < n; i++)
      FileWrite(f, TimeToString(r[i].time, TIME_DATE | TIME_MINUTES), DoubleToString(r[i].open, 8), DoubleToString(r[i].high, 8), DoubleToString(r[i].low, 8), DoubleToString(r[i].close, 8),
                DoubleToString(atr[i], 10), DoubleToString(er[i], 10), DoubleToString(lv[i], 10), DoubleToString(sl[i], 10), DoubleToString(rg[i], 10), st[i], DoubleToString(fr[i], 10));
   FileClose(f);
   f = FileOpen("RA_stats_" + InpSym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "state", "n", "nf", "share", "meanRun", "pStay", "ratio", "allFwd");
   for(int k = 0; k < AT24RA_K; k++)
      FileWrite(f, k, s.n[k], s.nf[k], DoubleToString(s.share[k], 10), DoubleToString(s.meanRun[k], 10), DoubleToString(s.pStay[k], 10), DoubleToString(s.ratio[k], 10), DoubleToString(s.allFwd, 10));
   FileClose(f);
   PrintFormat("RA selftest %s: %d bars, last state %d (%s)", InpSym, n, st[n - 1], AT24RA_Name(st[n - 1]));
  }

//--- no look-ahead: states computed on a history cut at bar k equal the states of the full history for bars 0..k-1
void CutTest(const string sym)
  {
   MqlRates r[]; int n = CopyRates(sym, PERIOD_H1, 1, 6000, r);
   if(n < 1000) return;
   double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double atr[], er[], lv[], sl[], rg[]; bool ok[]; int full[];
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok); AT24RA_States(n, er, lv, sl, rg, ok, full);
   int cuts[3] = {n - 500, n - 100, n - 37}; int bad = 0;
   for(int q = 0; q < 3; q++)
     {
      int m = cuts[q]; double h2[], l2[], c2[]; ArrayResize(h2, m); ArrayResize(l2, m); ArrayResize(c2, m);
      for(int i = 0; i < m; i++) { h2[i] = h[i]; l2[i] = l[i]; c2[i] = c[i]; }
      double a2[], e2[], v2[], s2[], g2[]; bool o2[]; int part[];
      AT24RA_Features(m, h2, l2, c2, a2, e2, v2, s2, g2, o2); AT24RA_States(m, e2, v2, s2, g2, o2, part);
      for(int i = 0; i < m; i++) if(part[i] != full[i]) bad++;
     }
   PrintFormat("RA cut-history test %s: %d differing states (0 = no look-ahead)", sym, bad);
  }

void OnStart()
  {
   CutTest("EURUSD"); CutTest("XAUUSD");
   string syms[] = {"EURUSD", "XAUUSD", "GBPUSD", "USDJPY", "USDCHF"};
   for(int k = 0; k < ArraySize(syms); k++) Dump(syms[k]);
  }
