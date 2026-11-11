//+------------------------------------------------------------------+
//| Self-test: 150 synthetic trades (deterministic xorshift) on real |
//| XAUUSD M15 bars. Dumps MQL5\Files\TA_selftest.csv for an         |
//| independent Python check of MFE, MAE, capture, post-exit move.   |
//+------------------------------------------------------------------+
#include "AT24_TA_Core.mqh"
uint Nx(uint &s) { s ^= (s << 13); s ^= (s >> 17); s ^= (s << 5); return s; }
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_M15, 1, 30000, r);
   if(n < 5000) { Print("TATEST FAIL bars=", n); return; }
   datetime t[]; double h[], l[], o[], c[];
   ArrayResize(t, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(o, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { t[i] = r[i].time; h[i] = r[i].high; l[i] = r[i].low; o[i] = r[i].open; c[i] = r[i].close; }
   uint s = 20261117;
   int m = 150; AT24TA_Trade tr[]; ArrayResize(tr, m);
   for(int k = 0; k < m; k++)
     {
      int i0 = 50 + (int)(Nx(s) % (uint)(n - 200));
      int len = 1 + (int)(Nx(s) % 40);
      int dir = ((Nx(s) >> 8) & 1) == 1 ? 1 : -1;
      double slDist = 3.0 + (double)(Nx(s) % 90) / 10.0;      // 3.0 .. 11.9 USD
      bool hasSl = (Nx(s) % 4) != 0;                          // 75 % with a stop
      tr[k].dir = dir; tr[k].tIn = t[i0]; tr[k].tOut = t[i0 + len]; tr[k].pIn = o[i0]; tr[k].pOut = c[i0 + len];
      tr[k].sl = hasSl ? (dir > 0 ? o[i0] - slDist : o[i0] + slDist) : 0.0; tr[k].profit = 0.0;
     }
   AT24TA_Sum sm; AT24TA_Analyze(tr, m, n, t, h, l, 900, 16, sm);
   PrintFormat("TATEST n=%d win=%d lose=%d capture=%.3f giveBack=%.1f%% early=%.1f%% recover=%.1f%% mae=%.1f%% R=%.3f stops=%d", sm.n, sm.winners, sm.losers, sm.captureWin, sm.giveBackPct, sm.earlyPct, sm.recoverPct, sm.avgMaePct, sm.avgR, sm.withStop);
   int f = FileOpen("TA_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, 900, 16, m);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", (long)t[i], DoubleToString(h[i], 3), DoubleToString(l[i], 3));
   for(int k = 0; k < m; k++)
     {
      AT24TA_Res x; AT24TA_One(tr[k], n, t, h, l, 900, 16, x);
      FileWrite(f, "trade", tr[k].dir, (long)tr[k].tIn, (long)tr[k].tOut, DoubleToString(tr[k].pIn, 3), DoubleToString(tr[k].pOut, 3), DoubleToString(tr[k].sl, 3),
                x.ok ? 1 : 0, DoubleToString(x.move, 6), DoubleToString(x.mfe, 6), DoubleToString(x.mae, 6), DoubleToString(x.post, 6), DoubleToString(x.r, 8));
     }
   FileWrite(f, "sum", sm.n, sm.winners, sm.losers, DoubleToString(sm.captureWin, 8), DoubleToString(sm.giveBackPct, 8), DoubleToString(sm.earlyPct, 8), DoubleToString(sm.recoverPct, 8), DoubleToString(sm.avgMaePct, 8), DoubleToString(sm.avgR, 8), sm.withStop);
   FileClose(f);
   Print("TATEST done");
  }
