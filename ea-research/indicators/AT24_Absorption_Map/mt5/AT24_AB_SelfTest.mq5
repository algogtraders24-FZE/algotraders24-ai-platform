//+------------------------------------------------------------------+
//| Self-test: absorption zones, first touches, trades and           |
//| scorecards on real XAUUSD H1 bars (last 8000, with tick volume). |
//| Dumps MQL5\Files\AB_selftest.csv for an independent Python check |
//| of the whole chain (the detector is new in this indicator).      |
//+------------------------------------------------------------------+
#include "AT24_Pullback_Core.mqh"
#include "AT24_AB_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 8000, r);
   if(n < 3000) { Print("ABTEST FAIL bars=", n); return; }
   double o[], h[], l[], c[], at[]; long tv[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(at, n); ArrayResize(tv, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; tv[i] = r[i].tick_volume; }
   AT24TP_Atr(n, h, l, c, 14, at);
   double volK = 1.5, maxRange = 1.0, moveAtr = 1.0, slBuf = 0.25, rr = 2.0, cost = 0.25; int volN = 20, lookback = 6, maxHold = 40, maxAge = 200;
   AT24ZN_Zone zs[]; int nz = AT24AB_Detect(n, o, h, l, c, tv, at, volK, volN, maxRange, lookback, moveAtr, zs);
   AT24ZN_Touches(n, h, l, zs, nz, maxAge);
   int f = FileOpen("AB_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, DoubleToString(volK, 4), volN, DoubleToString(maxRange, 4), lookback, DoubleToString(moveAtr, 4), DoubleToString(slBuf, 4), DoubleToString(rr, 4), maxHold, maxAge, DoubleToString(cost, 4));
   for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3), tv[i]);
   for(int z = 0; z < nz; z++) FileWrite(f, "zone", zs[z].idx, zs[z].dir, DoubleToString(zs[z].top, 3), DoubleToString(zs[z].bottom, 3), DoubleToString(zs[z].atr, 6), zs[z].touch);
   int filt[3] = {0, 1, -1};
   for(int q = 0; q < 3; q++)
     {
      AT24SP_Setup st[]; int cnt = AT24ZN_Trades(n, o, h, l, c, zs, nz, filt[q], slBuf, rr, maxHold, cost, st);
      for(int k = 0; k < cnt; k++) FileWrite(f, "trade", filt[q], st[k].idx, st[k].dir, DoubleToString(st[k].entry, 3), DoubleToString(st[k].sl, 4), DoubleToString(st[k].tp, 4), DoubleToString(st[k].risk, 5), st[k].exitIdx, st[k].result, DoubleToString(st[k].r, 8));
      AT24SP_Score sc; AT24SP_ScoreOf(st, cnt, 20261111, sc);
      FileWrite(f, "score", filt[q], sc.n, sc.wins, DoubleToString(sc.hitPct, 6), DoubleToString(sc.avgR, 8), DoubleToString(sc.sumR, 6), DoubleToString(sc.t, 8), DoubleToString(sc.pFlip, 8), sc.open);
      PrintFormat("ABTEST filter=%d zones=%d trades=%d resolved=%d hit=%.1f%% avgR=%+.3f p=%.3f", filt[q], nz, cnt, sc.n, sc.hitPct, sc.avgR, sc.pFlip);
     }
   FileClose(f);
   Print("ABTEST done");
  }
