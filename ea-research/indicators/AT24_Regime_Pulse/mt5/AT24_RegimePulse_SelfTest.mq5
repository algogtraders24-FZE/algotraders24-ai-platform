//+------------------------------------------------------------------+
//| Self-test: runs the Regime Pulse core on real bars and dumps     |
//| OHLC + results to Common\Files\RegimePulse_selftest.csv          |
//+------------------------------------------------------------------+

#include "AT24_RegimePulse_Core.mqh"
input string InpSymbol = "XAUUSD";
input int    InpBars   = 4000;
void OnStart()
  {
   MqlRates r[];
   ArraySetAsSeries(r, false);
   int n = CopyRates(InpSymbol, PERIOD_M5, 1, InpBars, r);
   if(n < 600) { Print("SELFTEST FAIL: only ", n, " bars"); return; }
   double h[], l[], c[], atr[], er[], pct[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   ArrayResize(atr, n); ArrayResize(er, n); ArrayResize(pct, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   bool ok = AT24RP_Calc(n, 0, 0, h, l, c, 20, 14, 500, atr, er, pct);
   // incremental check: recompute only the last 50 bars and compare
   double atr2[], er2[], pct2[];
   ArrayCopy(atr2, atr); ArrayCopy(er2, er); ArrayCopy(pct2, pct);
   AT24RP_Calc(n, n - 50, 0, h, l, c, 20, 14, 500, atr2, er2, pct2);
   double maxd = 0;
   for(int i = n - 50; i < n; i++) maxd = MathMax(maxd, MathAbs(atr[i] - atr2[i]) + MathAbs(er[i] - er2[i]) + MathAbs(pct[i] - pct2[i]));
   PrintFormat("SELFTEST calc_ok=%d bars=%d incremental_max_diff=%g", ok, n, maxd);
   int f = FileOpen("RegimePulse_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI | FILE_COMMON, ',');
   if(f == INVALID_HANDLE) { Print("SELFTEST FAIL: cannot write csv"); return; }
   FileWrite(f, "time", "high", "low", "close", "atr", "er", "pct", "regime");
   for(int i = 0; i < n; i++)
     {
      int reg = (er[i] == EMPTY_VALUE || pct[i] == EMPTY_VALUE) ? 0 : AT24RP_Classify(er[i], pct[i], 0.35, 0.20, 70, 25);
      FileWrite(f, TimeToString(r[i].time, TIME_DATE | TIME_MINUTES), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3),
                (atr[i] == EMPTY_VALUE ? "" : DoubleToString(atr[i], 6)), (er[i] == EMPTY_VALUE ? "" : DoubleToString(er[i], 6)),
                (pct[i] == EMPTY_VALUE ? "" : DoubleToString(pct[i], 3)), reg);
     }
   FileClose(f);
   Print("SELFTEST done");
  }
