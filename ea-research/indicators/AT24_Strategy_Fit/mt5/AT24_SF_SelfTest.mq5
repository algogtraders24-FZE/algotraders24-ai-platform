//+------------------------------------------------------------------+
//| AT24_SF_SelfTest - dumps bars, states, signals and the per-cell  |
//| statistics of the Strategy Fit core for the independent check.   |
//+------------------------------------------------------------------+
#include "AT24_SF_Core.mqh"
input int InpBars = 20000;

void Dump(const string sym, const double cost, const double stopAtr, const string tag)
  {
   MqlRates r[]; int n = -1;
   for(int t = 0; t < 20 && n < 3000; t++) { n = CopyRates(sym, PERIOD_H1, 1, InpBars, r); if(n < 3000) Sleep(500); }
   if(n < 3000) { Print("SF selftest: no data for ", sym); return; }
   double o[], h[], l[], c[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double atr[], er[], lv[], sl[], rg[]; bool ok[]; int st[], sig[];
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   AT24RA_States(n, er, lv, sl, rg, ok, st);
   AT24SF_Signals(n, h, l, c, sig);
   AT24SF_Res res; AT24SF_Run(n, o, h, l, atr, ok, st, sig, cost, stopAtr, 0, res);
   int f = FileOpen("SF_selftest_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "time", "open", "high", "low", "close", "atr14", "state", "sT", "sB", "sR");
   for(int i = 0; i < n; i++)
      FileWrite(f, TimeToString(r[i].time, TIME_DATE | TIME_MINUTES), DoubleToString(o[i], 8), DoubleToString(h[i], 8), DoubleToString(l[i], 8), DoubleToString(c[i], 8),
                DoubleToString(atr[i], 10), st[i], sig[i * 3], sig[i * 3 + 1], sig[i * 3 + 2]);
   FileClose(f);
   f = FileOpen("SF_stats_" + sym + "_" + tag + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "rule", "state", "n", "avg", "hit", "p", "cls", "cost", "stop", "nStop");
   for(int q = 0; q < AT24SF_NR; q++)
      for(int s = 0; s < AT24RA_K; s++)
        {
         AT24SF_Cell cc = res.c[q * AT24RA_K + s];
         FileWrite(f, q, s, cc.n, DoubleToString(cc.avg, 10), DoubleToString(cc.hit, 10), DoubleToString(cc.p, 10), cc.cls, DoubleToString(cost, 8), DoubleToString(stopAtr, 4), cc.nStop);
        }
   FileClose(f);
   PrintFormat("SF selftest %s stop %.1f: %d bars, %d trades, %d stopped", sym, stopAtr, n, res.trades, res.stopped);
  }

//--- no look-ahead: signals of a history cut at k equal those of the full history for bars 0..k-1
void CutTest(const string sym)
  {
   MqlRates r[]; int n = CopyRates(sym, PERIOD_H1, 1, 6000, r);
   if(n < 1000) return;
   double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   int full[]; AT24SF_Signals(n, h, l, c, full);
   int cuts[3] = {n - 500, n - 100, n - 37}; int bad = 0;
   for(int q = 0; q < 3; q++)
     {
      int m = cuts[q]; double h2[], l2[], c2[]; ArrayResize(h2, m); ArrayResize(l2, m); ArrayResize(c2, m);
      for(int i = 0; i < m; i++) { h2[i] = h[i]; l2[i] = l[i]; c2[i] = c[i]; }
      int part[]; AT24SF_Signals(m, h2, l2, c2, part);
      for(int i = 0; i < m * 3; i++) if(part[i] != full[i]) bad++;
     }
   PrintFormat("SF cut-history test %s: %d differing signals (0 = no look-ahead)", sym, bad);
  }

void OnStart()
  {
   CutTest("EURUSD"); CutTest("XAUUSD");
   string sy[5] = {"EURUSD", "XAUUSD", "GBPUSD", "USDJPY", "USDCHF"}; double co[5] = {0.00012, 0.30, 0.00015, 0.012, 0.00015};
   for(int k = 0; k < 5; k++) { Dump(sy[k], co[k], 0.0, "s0"); Dump(sy[k], co[k], 2.0, "s2"); }
  }
