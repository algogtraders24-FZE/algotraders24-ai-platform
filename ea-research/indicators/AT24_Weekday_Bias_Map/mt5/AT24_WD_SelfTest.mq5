//+------------------------------------------------------------------+
//| Self-test: weekday return statistics on real D1 bars. Dumps      |
//| MQL5\Files\WD_selftest.csv for an independent Python check.      |
//+------------------------------------------------------------------+
#include "AT24_WD_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_D1, 1, 5000, r);
   if(n < 300) { Print("WDTEST FAIL bars=", n); return; }
   double ret[]; int dow[]; ArrayResize(ret, n); ArrayResize(dow, n);
   for(int i = 0; i < n; i++)
     {
      ret[i] = MathLog(r[i].close / r[i].open);
      dow[i] = (int)((((long)r[i].time / 86400) + 4) % 7);
     }
   double out[], sum[]; AT24WD_Stats(n, ret, dow, out, sum);
   PrintFormat("WDTEST bars=%d first=%s last=%s sig196=%.0f sig258=%.0f halvesCorr=%.3f agree=%.0f used=%.0f", n, TimeToString(r[0].time), TimeToString(r[n - 1].time), sum[0], sum[1], sum[2], sum[3], sum[4]);
   for(int d = 1; d <= 5; d++) PrintFormat("WDTEST dow=%d n=%.0f mean=%.2fbp t=%.2f up=%.1f%% halves=%.2f/%.2f", d, out[d * 7], out[d * 7 + 1], out[d * 7 + 2], out[d * 7 + 3], out[d * 7 + 4], out[d * 7 + 5]);
   int f = FileOpen("WD_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(r[i].open, 3), DoubleToString(r[i].close, 3));
   for(int d = 0; d < 7; d++) FileWrite(f, "dow", d, DoubleToString(out[d * 7], 0), DoubleToString(out[d * 7 + 1], 6), DoubleToString(out[d * 7 + 2], 6), DoubleToString(out[d * 7 + 3], 6), DoubleToString(out[d * 7 + 4], 6), DoubleToString(out[d * 7 + 5], 6), DoubleToString(out[d * 7 + 6], 6));
   FileWrite(f, "sum", DoubleToString(sum[0], 0), DoubleToString(sum[1], 0), DoubleToString(sum[2], 8), DoubleToString(sum[3], 0), DoubleToString(sum[4], 0));
   FileClose(f);
   Print("WDTEST done");
  }
