//+------------------------------------------------------------------+
//| Self-test: runs the Anchored VWAP core on real bars and dumps    |
//| bars + results to MQL5\Files\VWAP_selftest.csv for an            |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_VWAP_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("VWTEST FAIL bars=", n); return; }
   datetime t[]; double h[], l[], c[]; long v[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(v, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; v[i] = r[i].tick_volume; }
   int off = 7200;
   double vd[], sdd[], vw[], sdw[], vm[], sdm[]; int fd[], fw[], fm[];
   ArrayResize(vd, n); ArrayResize(sdd, n); ArrayResize(fd, n); ArrayResize(vw, n); ArrayResize(sdw, n); ArrayResize(fw, n); ArrayResize(vm, n); ArrayResize(sdm, n); ArrayResize(fm, n);
   AT24VW_Calc(n, t, h, l, c, v, off, 0, vd, sdd, fd);
   AT24VW_Calc(n, t, h, l, c, v, off, 1, vw, sdw, fw);
   AT24VW_Calc(n, t, h, l, c, v, off, 2, vm, sdm, fm);
   double rev[];
   AT24VW_Reversion(n, h, l, c, vd, sdd, fd, 2.0, 3.0, 10, rev);
   PrintFormat("VWTEST events=%.0f reverted=%.0f extended=%.0f none=%.0f above=%.1f%% bars=%.0f", rev[0], rev[1], rev[2], rev[3], rev[4], rev[5]);
   int f = FileOpen("VWAP_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, off);
   for(int i = 0; i < n; i++)
      FileWrite(f, "bar", (long)t[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), v[i], DoubleToString(vd[i], 5), DoubleToString(sdd[i], 5), fd[i], DoubleToString(vw[i], 5), DoubleToString(sdw[i], 5), DoubleToString(vm[i], 5), DoubleToString(sdm[i], 5));
   FileWrite(f, "rev", DoubleToString(rev[0], 0), DoubleToString(rev[1], 0), DoubleToString(rev[2], 0), DoubleToString(rev[3], 0), DoubleToString(rev[4], 3), DoubleToString(rev[5], 0));
   FileClose(f);
   Print("VWTEST done");
  }
