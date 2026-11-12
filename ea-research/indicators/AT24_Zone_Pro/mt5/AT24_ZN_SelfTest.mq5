//+------------------------------------------------------------------+
//| Self-test: supply/demand zones, first touches, trades and        |
//| scorecards on real XAUUSD H1 bars (last 8000). Dumps             |
//| MQL5\Files\ZN_selftest.csv for an independent Python check of    |
//| the whole chain (the detection logic is new in this indicator).  |
//+------------------------------------------------------------------+
#include "AT24_Pullback_Core.mqh"
#include "AT24_ZN_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 8000, r);
   if(n < 3000) { Print("ZNTEST FAIL bars=", n); return; }
   double o[], h[], l[], c[], at[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(at, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24TP_Atr(n, h, l, c, 14, at);
   double impK = 1.5, baseMax = 0.9, maxH = 2.0, slBuf = 0.25, rr = 2.0, cost = 0.25; int maxBase = 3, maxHold = 40, maxAge = 200;
   AT24ZN_Zone zs[]; int nz = AT24ZN_Detect(n, o, h, l, c, at, impK, baseMax, maxBase, maxH, zs);
   AT24ZN_Touches(n, h, l, zs, nz, maxAge);
   int f = FileOpen("ZN_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, DoubleToString(impK, 4), DoubleToString(baseMax, 4), maxBase, DoubleToString(maxH, 4), DoubleToString(slBuf, 4), DoubleToString(rr, 4), maxHold, maxAge, DoubleToString(cost, 4));
   for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int z = 0; z < nz; z++) FileWrite(f, "zone", zs[z].idx, zs[z].dir, DoubleToString(zs[z].top, 3), DoubleToString(zs[z].bottom, 3), DoubleToString(zs[z].atr, 6), zs[z].touch);
   int filt[3] = {0, 1, -1};
   for(int q = 0; q < 3; q++)
     {
      AT24SP_Setup st[]; int cnt = AT24ZN_Trades(n, o, h, l, c, zs, nz, filt[q], slBuf, rr, maxHold, cost, st);
      for(int k = 0; k < cnt; k++) FileWrite(f, "trade", filt[q], st[k].idx, st[k].dir, DoubleToString(st[k].entry, 3), DoubleToString(st[k].sl, 4), DoubleToString(st[k].tp, 4), DoubleToString(st[k].risk, 5), st[k].exitIdx, st[k].result, DoubleToString(st[k].r, 8));
      AT24SP_Score sc; AT24SP_ScoreOf(st, cnt, 20261111, sc);
      FileWrite(f, "score", filt[q], sc.n, sc.wins, DoubleToString(sc.hitPct, 6), DoubleToString(sc.avgR, 8), DoubleToString(sc.sumR, 6), DoubleToString(sc.t, 8), DoubleToString(sc.pFlip, 8), sc.open);
      PrintFormat("ZNTEST filter=%d zones=%d trades=%d resolved=%d hit=%.1f%% avgR=%+.3f p=%.3f", filt[q], nz, cnt, sc.n, sc.hitPct, sc.avgR, sc.pFlip);
     }
   FileClose(f);
   Print("ZNTEST done");
  }
