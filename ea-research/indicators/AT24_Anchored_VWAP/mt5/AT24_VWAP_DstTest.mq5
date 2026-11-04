//+------------------------------------------------------------------+
//| DST self-test: Anchored VWAP core on the DST-aware GMT window    |
//| (offset 0) exactly like the indicator, dumped for Python.        |
//+------------------------------------------------------------------+
#include "AT24_VWAP_Core.mqh"
#include "AT24_ServerClock.mqh"
void OnStart()
  {
   AT24SC_Clock clk; int meas[]; datetime utc[];
   bool ok = AT24SC_Detect("XAUUSD", clk, 60, meas, utc);
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000 || !ok) { PrintFormat("VWDST FAIL bars=%d clock=%d", n, ok); return; }
   datetime tg[]; double h[], l[], c[]; long v[]; long t0[];
   ArrayResize(tg, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(v, n); ArrayResize(t0, n);
   for(int i = 0; i < n; i++) { t0[i] = (long)r[i].time; tg[i] = AT24SC_ToGmt(clk, r[i].time); h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; v[i] = r[i].tick_volume; }
   double vd[], sdd[], vw[], sdw[], vm[], sdm[]; int fd[], fw[], fm[];
   ArrayResize(vd, n); ArrayResize(sdd, n); ArrayResize(fd, n); ArrayResize(vw, n); ArrayResize(sdw, n); ArrayResize(fw, n); ArrayResize(vm, n); ArrayResize(sdm, n); ArrayResize(fm, n);
   AT24VW_Calc(n, tg, h, l, c, v, 0, 0, vd, sdd, fd);
   AT24VW_Calc(n, tg, h, l, c, v, 0, 1, vw, sdw, fw);
   AT24VW_Calc(n, tg, h, l, c, v, 0, 2, vm, sdm, fm);
   double rev[];
   AT24VW_Reversion(n, h, l, c, vd, sdd, fd, 2.0, 3.0, 10, rev);
   PrintFormat("VWDST clock base=%d rule=%d events=%.0f reverted=%.0f extended=%.0f none=%.0f above=%.1f%%", clk.base, clk.rule, rev[0], rev[1], rev[2], rev[3], rev[4]);
   int f = FileOpen("VwapDst_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, clk.base, clk.rule);
   for(int i = 0; i < n; i++)
      FileWrite(f, "bar", t0[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), v[i], DoubleToString(vd[i], 5), DoubleToString(sdd[i], 5), fd[i], DoubleToString(vw[i], 5), DoubleToString(vm[i], 5));
   FileWrite(f, "rev", DoubleToString(rev[0], 0), DoubleToString(rev[1], 0), DoubleToString(rev[2], 0), DoubleToString(rev[3], 0), DoubleToString(rev[4], 3), DoubleToString(rev[5], 0));
   FileClose(f);
   Print("VWDST done");
  }
