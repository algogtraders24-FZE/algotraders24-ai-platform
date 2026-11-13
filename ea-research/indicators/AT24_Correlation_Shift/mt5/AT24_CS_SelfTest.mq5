//+------------------------------------------------------------------+
//| Self-test: correlation shift between XAUUSD (real daily bars)    |
//| and BTCUSD_T (custom symbol from Binance data), plus a pair of   |
//| the same symbol with itself shifted (known answer). Dumps one CSV |
//| for an independent Python check of the alignment and every field. |
//+------------------------------------------------------------------+
#include "AT24_CS_Core.mqh"
void OnStart()
  {
   MqlRates a[], b[];
   int na = CopyRates("XAUUSD", PERIOD_D1, 1, 1500, a), nb = CopyRates("BTCUSD_T", PERIOD_D1, 1, 3000, b);
   if(na < 300 || nb < 300) { PrintFormat("CSTEST FAIL na=%d nb=%d", na, nb); return; }
   datetime ta[], tb[]; double ca[], cb[]; ArrayResize(ta, na); ArrayResize(ca, na); ArrayResize(tb, nb); ArrayResize(cb, nb);
   for(int i = 0; i < na; i++) { ta[i] = a[i].time; ca[i] = a[i].close; }
   for(int i = 0; i < nb; i++) { tb[i] = b[i].time; cb[i] = b[i].close; }
   double oa[], ob[]; int m = AT24CS_Align(na, ta, ca, nb, tb, cb, oa, ob);
   AT24CS_Row r; AT24CS_Calc(oa, ob, m, 20, 120, 750, r);
   int f = FileOpen("CS_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", na, nb, 20, 120, 750);
   for(int i = 0; i < na; i++) FileWrite(f, "a", (long)ta[i], DoubleToString(ca[i], 3));
   for(int i = 0; i < nb; i++) FileWrite(f, "b", (long)tb[i], DoubleToString(cb[i], 3));
   FileWrite(f, "row", m, r.ok ? 1 : 0, r.n, DoubleToString(r.corrS, 8), DoubleToString(r.corrL, 8), DoubleToString(r.delta, 8), DoubleToString(r.pct, 6));
   //--- known answer: a series against itself gives correlation 1 and delta 0
   AT24CS_Row s; AT24CS_Calc(oa, oa, m, 20, 120, 750, s);
   FileWrite(f, "self", DoubleToString(s.corrS, 8), DoubleToString(s.corrL, 8), DoubleToString(s.delta, 8));
   FileClose(f);
   PrintFormat("CSTEST matched=%d returns=%d corr20=%.3f corr120=%.3f delta=%+.3f pct=%.0f | self corr=%.4f", m, r.n, r.corrS, r.corrL, r.delta, r.pct, s.corrS);
   Print("CSTEST done");
  }
