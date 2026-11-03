//+------------------------------------------------------------------+
//| Self-test: runs the Session Range Box core on real bars and     |
//| dumps bars + per-day results + statistics to MQL5\Files\        |
//| SessionBox_selftest.csv for an independent Python check.        |
//+------------------------------------------------------------------+
#include "AT24_SessionBox_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 12000, r);
   if(n < 1000) { Print("SBTEST FAIL bars=", n); return; }
   datetime t[]; double h[], l[], c[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   int off = 7200;
   AT24SB_Day d[];
   int nd = AT24SB_Analyze(n, t, h, l, c, off, 0, 420, 1260, 0.0, 60, d);
   double st[]; AT24SB_Stats(d, nd, st);
   PrintFormat("SBTEST days=%d valid=%.0f up=%.1f%% down=%.1f%% none=%.1f%% held=%.1f%% ran1x=%.1f%% median=%.3f", nd, st[0], st[1], st[2], st[3], st[4], st[5], st[6]);
   int f = FileOpen("SessionBox_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", off, 0, 420, 1260, 60);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < nd; k++)
      FileWrite(f, "day", d[k].key, DoubleToString(d[k].hi, 3), DoubleToString(d[k].lo, 3), d[k].brk, d[k].held, DoubleToString(d[k].ext, 4), (int)d[k].finished, (long)d[k].boxStart);
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 3), DoubleToString(st[2], 3), DoubleToString(st[3], 3), DoubleToString(st[4], 3), DoubleToString(st[5], 3), DoubleToString(st[6], 4));
   FileClose(f);
   Print("SBTEST done");
  }
