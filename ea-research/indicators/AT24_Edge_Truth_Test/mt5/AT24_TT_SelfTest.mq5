//+------------------------------------------------------------------+
//| Self-test: four synthetic trade lists (noise, real edge, few     |
//| trades, losing). Dumps MQL5\Files\TT_selftest.csv for an         |
//| independent Python check of every statistic.                     |
//+------------------------------------------------------------------+
#include "AT24_TT_Core.mqh"
void Gen(const uint seed, const int n, const double shift, double &p[])
  {
   uint s = seed; ArrayResize(p, n);
   for(int i = 0; i < n; i++) p[i] = ((double)((int)(AT24TT_Next(s) % 2001) - 1000)) / 10.0 + shift;
  }
void OnStart()
  {
   int f = FileOpen("TT_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   string names[4] = {"noise", "edge", "few", "losing"};
   int ns[4] = {200, 200, 25, 400};
   double sh[4] = {0.0, 8.0, 15.0, -5.0};
   uint sd[4] = {12345, 777, 4242, 99991};
   for(int c = 0; c < 4; c++)
     {
      double p[]; Gen(sd[c], ns[c], sh[c], p);
      for(int i = 0; i < ns[c]; i++) FileWrite(f, "trade", names[c], DoubleToString(p[i], 1));
      AT24TT_Res r; AT24TT_Run(p, ns[c], 20261111, r);
      FileWrite(f, "res", names[c], r.n, r.wins, DoubleToString(r.total, 6), DoubleToString(r.mean, 8), DoubleToString(r.sd, 8), DoubleToString(r.t, 8), DoubleToString(r.pf, 8),
                DoubleToString(r.pFlip, 8), DoubleToString(r.bootLo, 6), DoubleToString(r.bootHi, 6), DoubleToString(r.pLoss, 8), DoubleToString(r.maxDD, 6), DoubleToString(r.ddMedian, 6), DoubleToString(r.ddRank, 8));
      PrintFormat("TTTEST %s n=%d total=%.1f t=%.2f pFlip=%.4f boot=[%.0f,%.0f] pLoss=%.3f dd=%.0f ddMed=%.0f ddRank=%.2f", names[c], r.n, r.total, r.t, r.pFlip, r.bootLo, r.bootHi, r.pLoss, r.maxDD, r.ddMedian, r.ddRank);
     }
   FileClose(f);
   Print("TTTEST done");
  }
