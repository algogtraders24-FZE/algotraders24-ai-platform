//+------------------------------------------------------------------+
//| Self-test: daily risk snapshot on deterministic scenarios.       |
//| Dumps MQL5\Files\DR_selftest.csv for an independent Python check.|
//+------------------------------------------------------------------+
#include "AT24_DR_Core.mqh"
void OnStart()
  {
   int f = FileOpen("DR_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   //--- scenario: n positions, each vol, entry, sl, dir, tickSize, tickValue; then dayStart, closed, floating, trades, limits
   for(int s = 0; s < 6; s++)
     {
      int n = (s == 0) ? 0 : (s % 4) + 1;
      double vol[], en[], sl[], ts[], tv[]; int dir[];
      ArrayResize(vol, n); ArrayResize(en, n); ArrayResize(sl, n); ArrayResize(dir, n); ArrayResize(ts, n); ArrayResize(tv, n);
      for(int i = 0; i < n; i++)
        {
         bool gold = ((i + s) % 2 == 0);
         ts[i] = gold ? 0.01 : 0.00001; tv[i] = gold ? 1.0 : 1.0;
         dir[i] = ((i + s) % 3 == 0) ? -1 : 1;
         vol[i] = 0.05 * (i + 1) + 0.01 * s;
         en[i] = gold ? 3950.0 + 3.0 * i : 1.0850 + 0.0010 * i;
         double d = gold ? 8.0 + 2.0 * i : 0.0040 + 0.0005 * i;
         sl[i] = (s == 2 && i == 0) ? 0.0 : (dir[i] > 0 ? en[i] - d : en[i] + d);          // scenario 2: first position has no stop
         if(s == 5 && i == 1) sl[i] = en[i] + (dir[i] > 0 ? 1.0 : -1.0) * (gold ? 5.0 : 0.002);  // stop beyond break-even
        }
      double dayStart = 10000.0 + 2500.0 * s, closed = -60.0 * s + (s == 4 ? -150.0 : 25.0), floating = (s % 2 == 0) ? -40.0 * s : 30.0;
      int trades = 2 + 2 * s;
      double dl = 3.0, mt = 1.0, mo = 3.0; int mx = 5;
      double risk[], o[];
      AT24DR_Snapshot(n, vol, en, sl, dir, ts, tv, dayStart, closed, floating, trades, dl, mt, mo, mx, risk, o);
      FileWrite(f, "scn", s, n, DoubleToString(dayStart, 2), DoubleToString(closed, 2), DoubleToString(floating, 2), trades, dl, mt, mo, mx);
      for(int i = 0; i < n; i++)
         FileWrite(f, "pos", s, DoubleToString(vol[i], 4), DoubleToString(en[i], 5), DoubleToString(sl[i], 5), dir[i], DoubleToString(ts[i], 5), DoubleToString(tv[i], 5), DoubleToString(risk[i], 6));
      FileWrite(f, "out", s, DoubleToString(o[0], 6), DoubleToString(o[1], 6), DoubleToString(o[2], 6), DoubleToString(o[3], 6), DoubleToString(o[4], 0), DoubleToString(o[5], 0), DoubleToString(o[6], 0), DoubleToString(o[7], 0), DoubleToString(o[8], 0), DoubleToString(o[9], 0));
      PrintFormat("DRTEST scn %d n=%d dailyUsed=%.2f%% openRisk=%.2f (%.2f%%) noSL=%.0f over=%.0f trades=%.0f open=%.0f limit=%.0f breaks=%.0f", s, n, o[0], o[2], o[3], o[4], o[5], o[6], o[7], o[8], o[9]);
     }
   FileClose(f);
   Print("DRTEST done");
  }
