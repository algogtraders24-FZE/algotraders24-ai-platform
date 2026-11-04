//+------------------------------------------------------------------+
//| Self-test: hour-of-day return statistics on real H1 bars, with   |
//| the DST-aware New York hour. Dumps MQL5\Files\HB_selftest.csv    |
//| for an independent Python check (incl. zoneinfo for the hour).   |
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_HB_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 20000, r);
   if(n < 2000) { Print("HBTEST FAIL bars=", n); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_Detect("XAUUSD", clk, 60, meas, utc)) { Print("HBTEST FAIL clock"); return; }
   double ret[]; int hr[]; ArrayResize(ret, n); ArrayResize(hr, n);
   long gm[]; ArrayResize(gm, n);
   for(int i = 0; i < n; i++)
     {
      datetime g = AT24SC_ToGmt(clk, r[i].time);
      gm[i] = (long)g;
      datetime ny = g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600);
      hr[i] = (int)(((long)ny % 86400) / 3600);
      ret[i] = MathLog(r[i].close / r[i].open);
     }
   double out[], sum[]; AT24HB_Stats(n, ret, hr, out, sum);
   PrintFormat("HBTEST bars=%d first=%s last=%s sig196=%.0f sig3=%.0f halvesCorr=%.3f agree=%.0f", n, TimeToString(r[0].time), TimeToString(r[n - 1].time), sum[0], sum[1], sum[2], sum[3]);
   int f = FileOpen("HB_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, clk.base, clk.rule);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, gm[i], hr[i], DoubleToString(r[i].open, 3), DoubleToString(r[i].close, 3), DoubleToString(ret[i], 10));
   for(int h = 0; h < 24; h++)
     {
      string row = "";
      FileWrite(f, "hour", h, DoubleToString(out[h * 8 + 0], 0), DoubleToString(out[h * 8 + 1], 6), DoubleToString(out[h * 8 + 2], 6), DoubleToString(out[h * 8 + 3], 6), DoubleToString(out[h * 8 + 4], 6), DoubleToString(out[h * 8 + 5], 6), DoubleToString(out[h * 8 + 6], 6));
     }
   FileWrite(f, "sum", DoubleToString(sum[0], 0), DoubleToString(sum[1], 0), DoubleToString(sum[2], 8), DoubleToString(sum[3], 0));
   FileClose(f);
   Print("HBTEST done");
  }
