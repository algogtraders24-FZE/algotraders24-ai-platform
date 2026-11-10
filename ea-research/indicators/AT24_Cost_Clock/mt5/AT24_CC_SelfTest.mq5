//+------------------------------------------------------------------+
//| Self-test: cost clock on real XAUUSD H1 bars (last 365 days).    |
//| Dumps MQL5\Files\CC_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_CC_Core.mqh"
void OnStart()
  {
   MqlRates rr[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 40000, rr);
   if(n < 5000) { Print("CCTEST FAIL bars=", n); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   if(!AT24SC_DetectAny("XAUUSD", clk, 60, meas, utc)) { Print("CCTEST FAIL clock"); return; }
   double point = SymbolInfoDouble("XAUUSD", SYMBOL_POINT);
   datetime t[]; double h[], l[]; int sp[], hr[]; long gm[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(sp, n); ArrayResize(hr, n); ArrayResize(gm, n);
   for(int i = 0; i < n; i++)
     {
      t[i] = rr[i].time; h[i] = rr[i].high; l[i] = rr[i].low; sp[i] = (int)rr[i].spread;
      datetime g = AT24SC_ToGmt(clk, rr[i].time); gm[i] = (long)g;
      hr[i] = (int)(((long)(g + (datetime)((long)AT24SC_NyOffsetHours(g) * 3600)) % 86400) / 3600);
     }
   AT24CC_Hour o[];
   AT24CC_Analyze(n, t, h, l, sp, hr, 365, point, 20, o);
   int f = FileOpen("CC_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, DoubleToString(point, 8), 365, 20);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], gm[i], hr[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3), sp[i]);
   for(int k = 0; k < 24; k++) FileWrite(f, "hour", k, o[k].n, DoubleToString(o[k].medSpread, 8), DoubleToString(o[k].medRange, 8), DoubleToString(o[k].medRatio, 10), o[k].rank);
   FileClose(f);
   PrintFormat("CCTEST point=%.5f cheapest=%d", point, 0);
   Print("CCTEST done");
  }
