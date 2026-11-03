//+------------------------------------------------------------------+
//| Self-test: runs the Range Detector core on real bars and dumps   |
//| bars + ADX + ranges + statistics to MQL5\Files\Range_selftest.csv|
//| for an independent Python check.                                 |
//+------------------------------------------------------------------+
#include "AT24_Range_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("RGTEST FAIL bars=", n); return; }
   double h[], l[], c[], adx[], atr[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(adx, n); ArrayResize(atr, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24RG_Adx(n, h, l, c, 14, adx, atr);
   AT24RG_Range rg[];
   int nr = AT24RG_Find(n, h, l, c, adx, atr, 2, 2, 25.0, 40, 30.0, false, 8, 5, rg);
   double st[]; AT24RG_Stats(rg, nr, st);
   PrintFormat("RGTEST ranges=%d finished=%.0f medLen=%.0f medHt=%.2f up=%.1f%% down=%.1f%% rise=%.1f%% withPrior=%.1f%% fake=%.1f%% (%.0f/%.0f)", nr, st[0], st[1], st[2], st[3], st[4], st[5], st[6], st[7], st[8], st[9]);
   int f = FileOpen("Range_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), DoubleToString(adx[i], 5), DoubleToString(atr[i], 5));
   for(int k = 0; k < nr; k++)
      FileWrite(f, "rg", rg[k].start, rg[k].last, DoubleToString(rg[k].hi, 3), DoubleToString(rg[k].lo, 3), rg[k].end, rg[k].prior, rg[k].fake, DoubleToString(rg[k].heightAtr, 4));
   FileWrite(f, "stats", DoubleToString(st[0], 0), DoubleToString(st[1], 2), DoubleToString(st[2], 4), DoubleToString(st[3], 3), DoubleToString(st[4], 3), DoubleToString(st[5], 3), DoubleToString(st[6], 3), DoubleToString(st[7], 3), DoubleToString(st[8], 0), DoubleToString(st[9], 0));
   FileClose(f);
   Print("RGTEST done");
  }
