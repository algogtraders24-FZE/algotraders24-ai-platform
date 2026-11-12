//+------------------------------------------------------------------+
//| Self-test: the scanner engine on two symbols (XAUUSD real feed   |
//| and the labelled custom symbol BTCUSD_T built from Binance H1).  |
//| One dump per symbol in the Setup Pro format (SS_selftest_N.csv)  |
//| for the independent Python check, plus the table row values.     |
//+------------------------------------------------------------------+
#include "AT24_SS_Engine.mqh"
void OnStart()
  {
   string syms[2] = {"XAUUSD", "BTCUSD_T"};
   double slMult = 1.5, rr = 2.0, cost = 0.25; int maxHold = 40;
   for(int s = 0; s < 2; s++)
     {
      AT24SS_Row row; AT24SS_Work w;
      if(!AT24SS_Analyze(syms[s], PERIOD_H1, 8000, true, true, slMult, rr, maxHold, cost, row, w)) { PrintFormat("SSTEST FAIL %s", syms[s]); continue; }
      int n = row.bars;
      int f = FileOpen(StringFormat("SS_selftest_%d.csv", s), FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
      FileWrite(f, "meta", n, DoubleToString(slMult, 4), DoubleToString(rr, 4), maxHold, DoubleToString(cost, 4), 14);
      for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(w.o[i], 3), DoubleToString(w.h[i], 3), DoubleToString(w.l[i], 3), DoubleToString(w.c[i], 3));
      for(int k = 0; k < w.np; k++) FileWrite(f, "ev", 0, w.pi[k], w.pd[k]);
      for(int k = 0; k < w.nq; k++) FileWrite(f, "ev", 1, w.qi[k], w.qd[k]);
      for(int k = 0; k < w.cP; k++) FileWrite(f, "setup", 0, w.stP[k].idx, w.stP[k].dir, DoubleToString(w.stP[k].entry, 3), DoubleToString(w.stP[k].sl, 4), DoubleToString(w.stP[k].tp, 4), DoubleToString(w.stP[k].risk, 5), w.stP[k].exitIdx, w.stP[k].result, DoubleToString(w.stP[k].r, 8));
      for(int k = 0; k < w.cQ; k++) FileWrite(f, "setup", 1, w.stQ[k].idx, w.stQ[k].dir, DoubleToString(w.stQ[k].entry, 3), DoubleToString(w.stQ[k].sl, 4), DoubleToString(w.stQ[k].tp, 4), DoubleToString(w.stQ[k].risk, 5), w.stQ[k].exitIdx, w.stQ[k].result, DoubleToString(w.stQ[k].r, 8));
      for(int ty = 0; ty < 2; ty++) FileWrite(f, "score", ty, row.sc[ty].n, row.sc[ty].wins, DoubleToString(row.sc[ty].hitPct, 6), DoubleToString(row.sc[ty].avgR, 8), DoubleToString(row.sc[ty].sumR, 6), DoubleToString(row.sc[ty].t, 8), DoubleToString(row.sc[ty].pFlip, 8), row.sc[ty].open);
      FileClose(f);
      PrintFormat("SSTEST %s bars=%d trend=%d active=%d pull n=%d avgR=%+.3f p=%.3f squeeze n=%d avgR=%+.3f p=%.3f", syms[s], n, row.trend, row.active, row.sc[0].n, row.sc[0].avgR, row.sc[0].pFlip, row.sc[1].n, row.sc[1].avgR, row.sc[1].pFlip);
     }
   Print("SSTEST done");
  }
