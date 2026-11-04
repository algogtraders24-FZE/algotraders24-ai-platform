//+------------------------------------------------------------------+
//| Self-test: DST-aware server -> GMT -> New York conversion plus   |
//| the Opening Range core on real bars; dumps everything to         |
//| MQL5\Files\NYOR_selftest.csv for an independent Python check.    |
//+------------------------------------------------------------------+
#include "AT24_ServerClock.mqh"
#include "AT24_NYOR_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("NYTEST FAIL bars=", n); return; }
   AT24SC_Clock clk; int meas[]; datetime utc[];
   bool okc = AT24SC_Detect("XAUUSD", clk, 60, meas, utc);
   if(!okc) { Print("NYTEST FAIL clock"); return; }
   datetime lt[]; double h[], l[], c[]; datetime g[];
   ArrayResize(lt, n); ArrayResize(g, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++)
     {
      g[i] = AT24SC_ToGmt(clk, r[i].time);
      lt[i] = g[i] + (datetime)((long)AT24SC_NyOffsetHours(g[i]) * 3600);
      h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close;
     }
   AT24OR_Day d[], dc[];
   int m = AT24OR_Analyze(n, lt, h, l, c, 570, 30, 960, 0.0, 4, d);
   int mc = AT24OR_Analyze(n, lt, h, l, c, 660, 30, 960, 0.0, 4, dc);
   double st[], sc[]; AT24OR_Stats(d, m, st); AT24OR_Stats(dc, mc, sc);
   PrintFormat("NYTEST clock base=%d rule=%d days=%d measured=%.0f up=%.1f%% dn=%.1f%% none=%.1f%% held=%.1f%% fake=%.1f%% ran=%.1f%% | control measured=%.0f held=%.1f%% fake=%.1f%% ran=%.1f%%",
               clk.base, clk.rule, m, st[0], st[1], st[2], st[3], st[4], st[5], st[6], sc[0], sc[4], sc[5], sc[6]);
   int f = FileOpen("NYOR_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, clk.base, clk.rule);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, (long)g[i], (long)lt[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < m; k++) FileWrite(f, "day", d[k].key, d[k].first, d[k].orEnd, DoubleToString(d[k].hi, 3), DoubleToString(d[k].lo, 3), d[k].brk, d[k].brkBar, d[k].held, d[k].fake, d[k].ran, d[k].lastBar, d[k].complete ? 1 : 0);
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 3), DoubleToString(st[2], 3), DoubleToString(st[3], 3), DoubleToString(st[4], 3), DoubleToString(st[5], 3), DoubleToString(st[6], 3), DoubleToString(st[7], 4), DoubleToString(st[8], 0));
   FileWrite(f, "control", DoubleToString(sc[0], 0), DoubleToString(sc[1], 3), DoubleToString(sc[2], 3), DoubleToString(sc[3], 3), DoubleToString(sc[4], 3), DoubleToString(sc[5], 3), DoubleToString(sc[6], 3), DoubleToString(sc[7], 4), DoubleToString(sc[8], 0));
   FileClose(f);
   Print("NYTEST done");
  }
