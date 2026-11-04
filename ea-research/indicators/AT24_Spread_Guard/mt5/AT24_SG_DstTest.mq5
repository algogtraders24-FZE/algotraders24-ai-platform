//+------------------------------------------------------------------+
//| DST self-test: the Spread Guard hourly profile on the DST-aware  |
//| GMT window (offset 0) exactly like the indicator, with bars +    |
//| spreads dumped for an independent Python check.                  |
//+------------------------------------------------------------------+
#include "AT24_SpreadGuard_Core.mqh"
#include "AT24_ServerClock.mqh"
void OnStart()
  {
   AT24SC_Clock clk; int meas[]; datetime utc[];
   bool ok = AT24SC_Detect("XAUUSD", clk, 60, meas, utc);
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 6000, r);
   if(n < 1000 || !ok) { PrintFormat("SGDST FAIL bars=%d clock=%d", n, ok); return; }
   datetime tg[]; int sp[]; ArrayResize(tg, n); ArrayResize(sp, n);
   for(int i = 0; i < n; i++) { tg[i] = AT24SC_ToGmt(clk, r[i].time); sp[i] = r[i].spread; }
   double avg[]; int cnt[];
   int used = AT24SG_Profile(n, tg, sp, 0, 20, avg, cnt);
   //--- old: constant +2 h on server times
   datetime ts[]; ArrayResize(ts, n);
   for(int i = 0; i < n; i++) ts[i] = r[i].time;
   double avgo[]; int cnto[];
   int usedo = AT24SG_Profile(n, ts, sp, 7200, 20, avgo, cnto);
   PrintFormat("SGDST clock base=%d rule=%d used new=%d old=%d", clk.base, clk.rule, used, usedo);
   int f = FileOpen("SpreadDst_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, clk.base, clk.rule, used, usedo);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, sp[i]);
   for(int h = 0; h < 24; h++) FileWrite(f, "new", h, DoubleToString(avg[h], 6), cnt[h]);
   for(int h = 0; h < 24; h++) FileWrite(f, "old", h, DoubleToString(avgo[h], 6), cnto[h]);
   FileClose(f);
   Print("SGDST done");
  }
