//+------------------------------------------------------------------+
//| DST self-test: runs the Session Range Box on the DST-aware GMT   |
//| window exactly like the indicator does, and also with the old    |
//| constant offset, and dumps both for an independent Python check. |
//+------------------------------------------------------------------+
#include "AT24_SessionBox_Core.mqh"
#include "AT24_ServerClock.mqh"
void OnStart()
  {
   AT24SC_Clock clk; int meas[]; datetime utc[];
   bool ok = AT24SC_Detect("XAUUSD", clk, 60, meas, utc);
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 12000, r);
   if(n < 1000 || !ok) { PrintFormat("SBDST FAIL bars=%d clock=%d", n, ok); return; }
   datetime t[], tg[]; double h[], l[], c[];
   ArrayResize(t, n); ArrayResize(tg, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; tg[i] = AT24SC_ToGmt(clk, r[i].time); h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   //--- new: DST-aware
   AT24SB_Day dn[];
   int nn = AT24SB_Analyze(n, tg, h, l, c, 0, 0, 420, 1260, 0.0, 60, dn);
   double sn[]; AT24SB_Stats(dn, nn, sn);
   //--- old: constant +2 h on server times
   AT24SB_Day dold[];
   int no = AT24SB_Analyze(n, t, h, l, c, 7200, 0, 420, 1260, 0.0, 60, dold);
   double so[]; AT24SB_Stats(dold, no, so);
   PrintFormat("SBDST clock base=%d rule=%d | NEW days=%.0f up=%.1f%% down=%.1f%% none=%.1f%% held=%.1f%% ran=%.1f%% median=%.2f | OLD days=%.0f up=%.1f%% down=%.1f%% none=%.1f%% held=%.1f%% ran=%.1f%% median=%.2f",
               clk.base, clk.rule, sn[0], sn[1], sn[2], sn[3], sn[4], sn[5], sn[6], so[0], so[1], so[2], so[3], so[4], so[5], so[6]);
   int f = FileOpen("SessionBoxDst_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, clk.base, clk.rule);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < nn; k++)
      FileWrite(f, "new", dn[k].key, DoubleToString(dn[k].hi, 3), DoubleToString(dn[k].lo, 3), dn[k].brk, dn[k].held, DoubleToString(dn[k].ext, 4), (int)dn[k].finished,
                (long)AT24SC_OffsetHoursAtUtc(clk, dn[k].boxStart) * 0 + (long)(dn[k].boxStart + (datetime)((long)AT24SC_OffsetHoursAtUtc(clk, dn[k].boxStart) * 3600)));
   FileWrite(f, "newstats", DoubleToString(sn[0], 0), DoubleToString(sn[1], 3), DoubleToString(sn[2], 3), DoubleToString(sn[3], 3), DoubleToString(sn[4], 3), DoubleToString(sn[5], 3), DoubleToString(sn[6], 4));
   FileWrite(f, "oldstats", DoubleToString(so[0], 0), DoubleToString(so[1], 3), DoubleToString(so[2], 3), DoubleToString(so[3], 3), DoubleToString(so[4], 3), DoubleToString(so[5], 3), DoubleToString(so[6], 4));
   FileClose(f);
   Print("SBDST done");
  }
