//+------------------------------------------------------------------+
//| Self-test: RSI divergence events, trades and scorecards on real  |
//| XAUUSD H1 bars (last 8000). Dumps MQL5\Files\DV_selftest.csv for |
//| an independent Python check of the whole chain.                  |
//+------------------------------------------------------------------+
#include "AT24_Pullback_Core.mqh"
#include "AT24_DV_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 8000, r);
   if(n < 3000) { Print("DVTEST FAIL bars=", n); return; }
   double o[], h[], l[], c[], at[], rs[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n); ArrayResize(at, n); ArrayResize(rs, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   AT24TP_Atr(n, h, l, c, 14, at); AT24DV_Rsi(n, c, 14, rs);
   int k = 5, minSep = 6, maxSep = 60, maxHold = 40; double minDiff = 2.0, slBuf = 0.25, maxRisk = 4.0, rr = 2.0, cost = 0.25;
   AT24DV_Ev ev[]; int ne = AT24DV_Events(n, h, l, rs, k, minSep, maxSep, minDiff, ev);
   int f = FileOpen("DV_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, k, minSep, maxSep, DoubleToString(minDiff, 4), DoubleToString(slBuf, 4), DoubleToString(maxRisk, 4), DoubleToString(rr, 4), maxHold, DoubleToString(cost, 4));
   for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int e = 0; e < ne; e++) FileWrite(f, "ev", ev[e].idx, ev[e].dir, ev[e].p, ev[e].q);
   for(int i = 0; i < n; i += 97) FileWrite(f, "rsi", i, DoubleToString(rs[i], 6));
   int filt[3] = {0, 1, -1};
   for(int q = 0; q < 3; q++)
     {
      AT24SP_Setup st[]; int cnt = AT24DV_Trades(n, o, h, l, c, at, ev, ne, filt[q], slBuf, maxRisk, rr, maxHold, cost, st);
      for(int j = 0; j < cnt; j++) FileWrite(f, "trade", filt[q], st[j].idx, st[j].dir, DoubleToString(st[j].entry, 3), DoubleToString(st[j].sl, 4), DoubleToString(st[j].tp, 4), DoubleToString(st[j].risk, 5), st[j].exitIdx, st[j].result, DoubleToString(st[j].r, 8));
      AT24SP_Score sc; AT24SP_ScoreOf(st, cnt, 20261111, sc);
      FileWrite(f, "score", filt[q], sc.n, sc.wins, DoubleToString(sc.hitPct, 6), DoubleToString(sc.avgR, 8), DoubleToString(sc.sumR, 6), DoubleToString(sc.t, 8), DoubleToString(sc.pFlip, 8), sc.open);
      PrintFormat("DVTEST filter=%d events=%d trades=%d resolved=%d hit=%.1f%% avgR=%+.3f p=%.3f", filt[q], ne, cnt, sc.n, sc.hitPct, sc.avgR, sc.pFlip);
     }
   FileClose(f);
   Print("DVTEST done");
  }
