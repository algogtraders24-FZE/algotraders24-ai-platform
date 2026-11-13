//+------------------------------------------------------------------+
//| Self-test: heatmap row on two symbols (XAUUSD real daily bars    |
//| and the labelled custom symbol BTCUSD_T). Dumps one CSV per      |
//| symbol for an independent Python check of every field.           |
//+------------------------------------------------------------------+
#include "AT24_HM_Core.mqh"
void OnStart()
  {
   string syms[2] = {"XAUUSD", "BTCUSD_T"};
   for(int s = 0; s < 2; s++)
     {
      MqlRates r[]; int n = CopyRates(syms[s], PERIOD_D1, 1, 1500, r);
      if(n < 300) { PrintFormat("HMTEST FAIL %s bars=%d", syms[s], n); continue; }
      double o[], h[], l[], c[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
      for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
      AT24HM_Row row; AT24HM_Calc(n, o, h, l, c, row);
      int f = FileOpen(StringFormat("HM_selftest_%d.csv", s), FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
      FileWrite(f, "meta", n);
      for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
      FileWrite(f, "row", row.ok ? 1 : 0, DoubleToString(row.last, 3), DoubleToString(row.ch1, 8), DoubleToString(row.ch5, 8), DoubleToString(row.ch21, 8), DoubleToString(row.atrPct, 8), DoubleToString(row.moveAtr, 8), row.trend, DoubleToString(row.rsi, 8), DoubleToString(row.rangePos, 8), DoubleToString(row.fromHigh, 8));
      FileClose(f);
      PrintFormat("HMTEST %s n=%d 1d=%.2f%% 5d=%.2f%% 21d=%.2f%% atr=%.2f%% trend=%d rsi=%.1f pos=%.0f", syms[s], n, row.ch1, row.ch5, row.ch21, row.atrPct, row.trend, row.rsi, row.rangePos);
     }
   Print("HMTEST done");
  }
