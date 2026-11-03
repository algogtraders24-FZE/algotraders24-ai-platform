//+------------------------------------------------------------------+
//| Self-test: runs the Liquidity Levels core on real bars and dumps |
//| bars + per-period results to MQL5\Files\Levels_selftest.csv for  |
//| an independent Python check.                                     |
//+------------------------------------------------------------------+
#include "AT24_Levels_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 20000, r);
   if(n < 1000) { Print("LVTEST FAIL bars=", n); return; }
   datetime t[]; double h[], l[], c[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   int off = 7200;
   int f = FileOpen("Levels_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", off, n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int mode = 0; mode < 3; mode++)
     {
      AT24LV_Period p[];
      int np = AT24LV_Analyze(n, t, h, l, c, off, mode, mode == 0 ? 62 : (mode == 1 ? 20 : 10), p);
      for(int k = 0; k < np; k++)
         FileWrite(f, "per", mode, p[k].key, DoubleToString(p[k].hi, 3), DoubleToString(p[k].lo, 3), DoubleToString(p[k].cl, 3), DoubleToString(p[k].pHi, 3), DoubleToString(p[k].pLo, 3),
                   (int)(p[k].swHiT != 0), (int)(p[k].swLoT != 0), (int)(p[k].clHiT != 0), (int)(p[k].clLoT != 0), p[k].outHi, p[k].outLo, (int)p[k].finished);
      if(mode == 0)
        {
         double st[]; AT24LV_Stats(p, np, st);
         FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 3), DoubleToString(st[2], 3), DoubleToString(st[3], 3), DoubleToString(st[4], 3), DoubleToString(st[5], 3), DoubleToString(st[6], 3), DoubleToString(st[7], 0));
         PrintFormat("LVTEST days=%d periods=%.0f sweptHi=%.1f%% sweptLo=%.1f%% either=%.1f%% both=%.1f%% rejected=%.1f%% accepted=%.1f%% sweeps=%.0f", np, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7]);
        }
     }
   FileClose(f);
   Print("LVTEST done");
  }
