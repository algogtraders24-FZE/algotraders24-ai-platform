//+------------------------------------------------------------------+
//| Self-test: effect tracker on real H1 bars (valid history only).|
//| Dumps MQL5\Files\ET_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_ET_Core.mqh"
void OnStart()
  {
   MqlRates rr[];
   int n0 = CopyRates("XAUUSD", PERIOD_H1, 1, 40000, rr);
   if(n0 < 5000) { Print("ETTEST FAIL bars=", n0); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_DetectAny("XAUUSD", clk, 60, meas, utc)) { Print("ETTEST FAIL clock"); return; }
   int v0 = n0, i0 = 0;
   while(i0 < n0) { long dk = (long)rr[i0].time / 86400; int j = i0; while(j < n0 && (long)rr[j].time / 86400 == dk) j++; if(j - i0 >= 20) { v0 = i0; break; } i0 = j; }
   int n = n0 - v0;
   double ret[]; int hr[], day[]; long gm[];
   ArrayResize(ret, n); ArrayResize(hr, n); ArrayResize(day, n); ArrayResize(gm, n);
   for(int i = 0; i < n; i++)
     {
      MqlRates b = rr[v0 + i];
      datetime g = AT24SC_ToGmt(clk, b.time); gm[i] = (long)g;
      datetime ny = g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600);
      hr[i] = (int)(((long)ny % 86400) / 3600);
      day[i] = (int)(((long)ny + 6 * 3600) / 86400);       // trading day: the New York day starting at 18:00
      ret[i] = MathLog(b.close / b.open);
     }
   AT24ET_Hour o[]; double sum[];
   AT24ET_Analyze(n, ret, hr, day, 250, 2.0, o, sum);
   PrintFormat("ETTEST bars=%d sig=%.0f expected=%.1f alive=%.0f born=%.0f died=%.0f", n, sum[0], sum[1], sum[2], sum[3], sum[4]);
   int f = FileOpen("ET_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, 250);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", gm[i], hr[i], day[i], DoubleToString(ret[i], 10));
   for(int h = 0; h < 24; h++)
      FileWrite(f, "hour", h, o[h].nR, DoubleToString(o[h].meanR, 6), DoubleToString(o[h].tR, 6), o[h].nP, DoubleToString(o[h].meanP, 6), DoubleToString(o[h].tP, 6), o[h].status, o[h].cpIdx, o[h].cpBar, DoubleToString(o[h].meanBefore, 6), DoubleToString(o[h].meanAfter, 6), DoubleToString(o[h].cpStat, 6));
   FileWrite(f, "sum", DoubleToString(sum[0], 0), DoubleToString(sum[2], 0), DoubleToString(sum[3], 0), DoubleToString(sum[4], 0));
   FileClose(f);
   Print("ETTEST done");
  }
