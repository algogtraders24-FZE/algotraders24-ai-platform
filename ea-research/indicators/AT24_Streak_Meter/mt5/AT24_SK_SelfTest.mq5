//+------------------------------------------------------------------+
//| Self-test: candle streak statistics on real D1 and H4 bars.      |
//| Dumps MQL5\Files\SK_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_SK_Core.mqh"
void Run(const ENUM_TIMEFRAMES tf, const string tag, const int f, const int cnt)
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", tf, 1, cnt, r);
   if(n < 300) { PrintFormat("SKTEST %s FAIL bars=%d", tag, n); return; }
   double o[], c[]; ArrayResize(o, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; c[i] = r[i].close; }
   int len[], col[]; AT24SK_Streaks(n, o, c, len, col);
   double st[]; AT24SK_Stats(n, len, col, 6, st);
   string s = StringFormat("SKTEST %s bars=%d base=%.1f%% (%.0f)", tag, n, st[13], st[12]);
   for(int k = 1; k <= 6; k++) s += StringFormat(" | k=%d n=%.0f cont=%.1f%%", k, st[(k - 1) * 2], st[(k - 1) * 2 + 1]);
   Print(s);
   FileWrite(f, "series", tag, n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", tag, DoubleToString(o[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < 14; k++) FileWrite(f, "stat", tag, k, DoubleToString(st[k], 6));
  }
void OnStart()
  {
   int f = FileOpen("SK_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   Run(PERIOD_D1, "D1", f, 5000);
   Run(PERIOD_H4, "H4", f, 12000);
   FileClose(f);
   Print("SKTEST done");
  }
