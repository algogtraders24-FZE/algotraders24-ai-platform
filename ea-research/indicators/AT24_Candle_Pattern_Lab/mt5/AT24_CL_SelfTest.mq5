//+------------------------------------------------------------------+
//| Self-test: candlestick patterns and follow-through on real bars. |
//| Dumps MQL5\Files\CL_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_CL_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("CLTEST FAIL bars=", n); return; }
   double o[], h[], l[], c[], atr[]; int fl[];
   ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24CL_Atr(n, h, l, c, 14, atr);
   AT24CL_Detect(n, o, h, l, c, atr, 0.5, fl);
   int H = 6;
   double st[]; AT24CL_Stats(n, c, fl, H, st);
   string nm[4] = {"bull_engulf", "bear_engulf", "bull_pin", "bear_pin"};
   for(int k = 0; k < 4; k++) PrintFormat("CLTEST %-12s n=%.0f hit=%.1f%% base=%.1f%% meanMove=%.3f", nm[k], st[k * 4], st[k * 4 + 1], st[k * 4 + 2], st[k * 4 + 3]);
   int f = FileOpen("CL_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, H);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), fl[i]);
   for(int k = 0; k < 4; k++) FileWrite(f, "stat", nm[k], DoubleToString(st[k * 4], 0), DoubleToString(st[k * 4 + 1], 6), DoubleToString(st[k * 4 + 2], 6), DoubleToString(st[k * 4 + 3], 8));
   FileClose(f);
   Print("CLTEST done");
  }
