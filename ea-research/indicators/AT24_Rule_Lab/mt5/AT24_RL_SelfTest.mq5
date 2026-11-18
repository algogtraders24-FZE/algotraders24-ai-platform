//+------------------------------------------------------------------+
//| AT24_RL_SelfTest - dumps bars, states, signals and the per-cell  |
//| statistics of the Rule Lab core for the independent Python check |
//+------------------------------------------------------------------+
#include "AT24_RL_Core.mqh"
input int InpBars = 20000;

void Dump(const string sym, const double cost, const double stopAtr, const string tag)
  {
   MqlRates r[]; int n = -1;
   for(int t = 0; t < 20 && n < 3000; t++) { n = CopyRates(sym, PERIOD_H1, 1, InpBars, r); if(n < 3000) Sleep(500); }
   if(n < 3000) { Print("RL selftest: no data for ", sym); return; }
   double o[], h[], l[], c[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double atr[], er[], lv[], sl[], rg[]; bool ok[]; int st[], sig[];
   AT24RA_Features(n, h, l, c, atr, er, lv, sl, rg, ok);
   AT24RA_States(n, er, lv, sl, rg, ok, st);
   AT24RL_Signals(n, h, l, c, sig);
   AT24RL_Res res; AT24RL_Run(n, o, h, l, atr, ok, st, sig, cost, stopAtr, 0, res);
   if(tag == "s0")
     {
      int f = FileOpen("RL_selftest_" + sym + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
      FileWrite(f, "time", "open", "high", "low", "close", "atr14", "state", "s0", "s1", "s2", "s3", "s4", "s5");
      for(int i = 0; i < n; i++)
         FileWrite(f, TimeToString(r[i].time, TIME_DATE | TIME_MINUTES), DoubleToString(o[i], 8), DoubleToString(h[i], 8), DoubleToString(l[i], 8), DoubleToString(c[i], 8), DoubleToString(atr[i], 10), st[i],
                   sig[i * 6], sig[i * 6 + 1], sig[i * 6 + 2], sig[i * 6 + 3], sig[i * 6 + 4], sig[i * 6 + 5]);
      FileClose(f);
     }
   int f2 = FileOpen("RL_stats_" + sym + "_" + tag + ".csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f2, "rule", "state", "n", "avg", "hit", "p", "cls", "cost", "stop", "nStop");
   for(int q = 0; q < AT24RL_NR; q++)
      for(int s = 0; s < AT24RA_K; s++)
        {
         AT24SF_Cell cc = res.c[q * AT24RA_K + s];
         FileWrite(f2, q, s, cc.n, DoubleToString(cc.avg, 10), DoubleToString(cc.hit, 10), DoubleToString(cc.p, 10), cc.cls, DoubleToString(cost, 8), DoubleToString(stopAtr, 4), cc.nStop);
        }
   FileClose(f2);
   PrintFormat("RL selftest %s stop %.1f: %d bars, %d trades, %d stopped", sym, stopAtr, n, res.trades, res.stopped);
  }

//--- no look-ahead: signals of a history cut at k equal those of the full history for bars 0..k-1
void CutTest(const string sym)
  {
   MqlRates r[]; int n = CopyRates(sym, PERIOD_H1, 1, 6000, r);
   if(n < 1000) return;
   double h[], l[], c[]; ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   int full[]; AT24RL_Signals(n, h, l, c, full);
   int cuts[3] = {n - 500, n - 100, n - 37}; int bad = 0;
   for(int q = 0; q < 3; q++)
     {
      int m = cuts[q]; double h2[], l2[], c2[]; ArrayResize(h2, m); ArrayResize(l2, m); ArrayResize(c2, m);
      for(int i = 0; i < m; i++) { h2[i] = h[i]; l2[i] = l[i]; c2[i] = c[i]; }
      int part[]; AT24RL_Signals(m, h2, l2, c2, part);
      for(int i = 0; i < m * 6; i++) if(part[i] != full[i]) bad++;
     }
   PrintFormat("RL cut-history test %s: %d differing signals (0 = no look-ahead)", sym, bad);
  }

void OnStart()
  {
   CutTest("EURUSD"); CutTest("XAUUSD");
   string sy[5] = {"EURUSD", "XAUUSD", "GBPUSD", "USDJPY", "USDCHF"}; double co[5] = {0.00012, 0.30, 0.00015, 0.012, 0.00015};
   for(int k = 0; k < 5; k++) { Dump(sy[k], co[k], 0.0, "s0"); Dump(sy[k], co[k], 2.0, "s2"); }
  }
