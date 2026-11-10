//+------------------------------------------------------------------+
//| Self-test: history audit on the real XAUUSD H1 history, with a   |
//| deliberately corrupted copy to prove the checks catch problems.  |
//| Dumps MQL5\Files\HD_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_HD_Core.mqh"
void Dump(const int f, const string tag, const AT24HD_Audit &a)
  {
   FileWrite(f, "audit", tag, a.n, a.validFrom, a.invalid, a.nonMonotonic, a.gapCount, a.gapHours, a.spreadFrom, a.baseYear);
   for(int y = 0; y < AT24HD_YEARS; y++)
      if(a.years[y].bars > 0) FileWrite(f, "year", tag, a.years[y].year, a.years[y].bars, a.years[y].days, a.years[y].fullDays, a.years[y].zeroSpread, a.years[y].flat);
  }
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 40000, r);
   if(n < 5000) { Print("HDTEST FAIL bars=", n); return; }
   datetime t[]; double o[], h[], l[], c[]; int sp[];
   ArrayResize(t, n); ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(sp, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; sp[i] = (int)r[i].spread; }
   AT24HD_Audit a; AT24HD_Run(n, t, o, h, l, c, sp, a);
   PrintFormat("HDTEST real: bars=%d validFrom=%d (%s) invalid=%d nonMono=%d gaps=%d (%d h) spreadFrom=%d", n, a.validFrom, TimeToString(t[MathMax(a.validFrom, 0)]), a.invalid, a.nonMonotonic, a.gapCount, a.gapHours, a.spreadFrom);
   int f = FileOpen("HD_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), sp[i]);
   Dump(f, "real", a);
   //--- corrupted copy: invalid OHLC, duplicated time, a 6-hour hole, flat bars, zero spread
   double h2[], l2[]; datetime t2[]; int sp2[]; ArrayCopy(h2, h); ArrayCopy(l2, l); ArrayCopy(t2, t); ArrayCopy(sp2, sp);
   h2[20000] = l[20000] - 1.0; t2[21000] = t2[20999]; for(int i = 25000; i < 25400; i++) { h2[i] = l2[i]; sp2[i] = 0; }
   for(int i = 30000; i < n; i++) t2[i] = t2[i] + 6 * 3600;        // a 6-hour hole before bar 30000
   AT24HD_Audit b; AT24HD_Run(n, t2, o, h2, l2, c, sp2, b);
   PrintFormat("HDTEST corrupted: invalid=%d nonMono=%d gaps=%d (%d h)", b.invalid, b.nonMonotonic, b.gapCount, b.gapHours);
   FileWrite(f, "bar2", "see python");
   for(int i = 0; i < n; i++) FileWrite(f, "c2", (long)t2[i], DoubleToString(h2[i], 3), DoubleToString(l2[i], 3), sp2[i]);
   Dump(f, "corrupt", b);
   FileClose(f);
   Print("HDTEST done");
  }
