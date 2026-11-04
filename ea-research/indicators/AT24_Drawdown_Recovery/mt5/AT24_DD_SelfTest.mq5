//+------------------------------------------------------------------+
//| Self-test: drawdown / recovery core on a deterministic synthetic |
//| P/L series and fixed tables. Dumps MQL5\Files\DD_selftest.csv    |
//| for an independent Python check.                                 |
//+------------------------------------------------------------------+
#include "AT24_DD_Core.mqh"
void OnStart()
  {
   int f = FileOpen("DD_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   double dds[] = {1, 5, 10, 20, 25, 33.3333, 50, 75, 90, 99};
   for(int i = 0; i < ArraySize(dds); i++) FileWrite(f, "rec", DoubleToString(dds[i], 6), DoubleToString(AT24DD_Recovery(dds[i]), 8));
   double rs[] = {0.5, 1.0, 2.0, 5.0};
   int ns[] = {1, 5, 10, 20};
   for(int a = 0; a < 4; a++)
     {
      for(int b = 0; b < 4; b++) FileWrite(f, "streak", DoubleToString(rs[a], 2), ns[b], DoubleToString(AT24DD_Streak(rs[a], ns[b]), 8));
      FileWrite(f, "lossesto", DoubleToString(rs[a], 2), 10, AT24DD_LossesTo(rs[a], 10.0), 20, AT24DD_LossesTo(rs[a], 20.0), 50, AT24DD_LossesTo(rs[a], 50.0));
     }
   //--- deterministic pseudo-random P/L series (linear congruential), 3 series of different drift
   for(int s = 0; s < 3; s++)
     {
      int n = 400 + s * 150;
      double pnl[]; ArrayResize(pnl, n);
      uint x = 12345 + 777 * s;
      for(int i = 0; i < n; i++)
        {
         x = x * 1664525u + 1013904223u;
         double u = (double)(x >> 8) / 16777216.0;                // 0..1
         pnl[i] = (u - (0.46 - 0.04 * s)) * 200.0;                 // win ~54..62 %, +/- up to 200
        }
      double base = 10000.0, floating = -150.0 * (s + 1);
      double o[]; AT24DD_Analyze(n, pnl, base, floating, o);
      FileWrite(f, "series", s, n, DoubleToString(base, 2), DoubleToString(floating, 2), (long)(12345 + 777 * s));
      for(int i = 0; i < n; i++) FileWrite(f, "pnl", s, DoubleToString(pnl[i], 6));
      FileWrite(f, "out", s, DoubleToString(o[0], 6), DoubleToString(o[1], 8), DoubleToString(o[2], 8), DoubleToString(o[3], 8), DoubleToString(o[4], 6), DoubleToString(o[5], 8), DoubleToString(o[6], 0), DoubleToString(o[7], 0));
      PrintFormat("DDTEST series %d n=%d peak=%.2f maxDD=%.3f%% curDD=%.3f%% need=%.3f%% equity=%.2f", s, n, o[0], o[1], o[2], o[3], o[4]);
     }
   FileClose(f);
   Print("DDTEST done");
  }
