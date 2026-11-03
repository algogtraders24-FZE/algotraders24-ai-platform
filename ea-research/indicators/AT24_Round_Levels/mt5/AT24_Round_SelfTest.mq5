//+------------------------------------------------------------------+
//| Self-test: runs the Round Levels core on real bars and dumps     |
//| bars + scan results to MQL5\Files\Round_selftest.csv for an      |
//| independent Python check.                                        |
//+------------------------------------------------------------------+
#include "AT24_Round_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 8000, r);
   if(n < 1000) { Print("RNTEST FAIL bars=", n); return; }
   double h[], l[], c[], at[];
   ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(at, n);
   for(int i = 0; i < n; i++) { h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24RN_Atr(n, h, l, c, 14, at);
   int f = FileOpen("Round_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)r[i].time, DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), DoubleToString(at[i], 5));
   double steps[3]; steps[0] = 10; steps[1] = 50; steps[2] = 100;
   for(int s = 0; s < 3; s++)
      for(int ctl = 0; ctl < 2; ctl++)
        {
         int o[];
         AT24RN_Scan(n, h, l, c, at, steps[s], ctl == 0 ? 0.0 : 0.5, 20, 1.0, 14, o);
         FileWrite(f, "scan", steps[s], ctl, o[0], o[1], o[2], o[3]);
         PrintFormat("RNTEST step=%.0f %s events=%d bounce=%d break=%d neither=%d", steps[s], ctl == 0 ? "real" : "ctrl", o[0], o[1], o[2], o[3]);
        }
   FileClose(f);
   Print("RNTEST done");
  }
