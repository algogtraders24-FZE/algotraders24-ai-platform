//+------------------------------------------------------------------+
//| Self-test: Setup Pro engine on real XAUUSD H1 bars (last 8000). |
//| Pullback and squeeze events come from the verified cores; the    |
//| new layer (levels, forward simulation, scorecard) is dumped to   |
//| MQL5\Files\SP_selftest.csv for an independent Python check.      |
//+------------------------------------------------------------------+
#include "AT24_Pullback_Core.mqh"
#include "AT24_Squeeze_Core.mqh"
#include "AT24_SP_Core.mqh"
void OnStart()
  {
   MqlRates r[];
   int n = CopyRates("XAUUSD", PERIOD_H1, 1, 8000, r);
   if(n < 3000) { Print("SPTEST FAIL bars=", n); return; }
   double o[], h[], l[], c[]; ArrayResize(o, n); ArrayResize(h, n); ArrayResize(l, n); ArrayResize(c, n);
   for(int i = 0; i < n; i++) { o[i] = r[i].open; h[i] = r[i].high; l[i] = r[i].low; c[i] = r[i].close; }
   double ef[], em[], es[], at[]; int tr[];
   ArrayResize(ef, n); ArrayResize(em, n); ArrayResize(es, n); ArrayResize(at, n); ArrayResize(tr, n);
   AT24TP_Ema(n, c, 20, ef); AT24TP_Ema(n, c, 50, em); AT24TP_Ema(n, c, 200, es); AT24TP_Atr(n, h, l, c, 14, at);
   AT24TP_Trend(n, ef, em, es, at, 200, 5, 0.10, tr);
   AT24TP_Ev pev[]; int np = AT24TP_Events(n, h, l, c, ef, em, at, tr, 20, 20, pev);
   double mid[], mom[], at2[], ratio[]; int sq[]; ArrayResize(mid, n); ArrayResize(mom, n); ArrayResize(at2, n); ArrayResize(ratio, n); ArrayResize(sq, n);
   AT24SQ_Calc(n, h, l, c, 20, 2.0, 20, 1.5, 14, mid, mom, at2, ratio, sq);
   AT24SQ_Ev qev[]; int nq = AT24SQ_Events(n, h, l, c, mid, at2, sq, 6, 20, qev);
   int pi[], pd[], qi[], qd[]; ArrayResize(pi, np); ArrayResize(pd, np); ArrayResize(qi, nq); ArrayResize(qd, nq);
   for(int k = 0; k < np; k++) { pi[k] = pev[k].idx; pd[k] = pev[k].dir; }
   for(int k = 0; k < nq; k++) { qi[k] = qev[k].idx; qd[k] = qev[k].mom; }
   double slMult = 1.5, rr = 2.0, cost = 0.25; int maxHold = 40;
   int f = FileOpen("SP_selftest.csv", FILE_WRITE | FILE_CSV | FILE_ANSI, ',');
   FileWrite(f, "meta", n, DoubleToString(slMult, 4), DoubleToString(rr, 4), maxHold, DoubleToString(cost, 4), 14);
   for(int i = 0; i < n; i++) FileWrite(f, "bar", DoubleToString(o[i], 3), DoubleToString(h[i], 3), DoubleToString(l[i], 3), DoubleToString(c[i], 3));
   for(int k = 0; k < np; k++) FileWrite(f, "ev", 0, pi[k], pd[k]);
   for(int k = 0; k < nq; k++) FileWrite(f, "ev", 1, qi[k], qd[k]);
   for(int ty = 0; ty < 2; ty++)
     {
      AT24SP_Setup st[]; int cnt = (ty == 0) ? AT24SP_Simulate(n, o, h, l, c, at, pi, pd, np, 0, slMult, rr, maxHold, cost, st) : AT24SP_Simulate(n, o, h, l, c, at, qi, qd, nq, 1, slMult, rr, maxHold, cost, st);
      for(int k = 0; k < cnt; k++)
         FileWrite(f, "setup", ty, st[k].idx, st[k].dir, DoubleToString(st[k].entry, 3), DoubleToString(st[k].sl, 4), DoubleToString(st[k].tp, 4), DoubleToString(st[k].risk, 5), st[k].exitIdx, st[k].result, DoubleToString(st[k].r, 8));
      AT24SP_Score sc; AT24SP_ScoreOf(st, cnt, 20261111, sc);
      FileWrite(f, "score", ty, sc.n, sc.wins, DoubleToString(sc.hitPct, 6), DoubleToString(sc.avgR, 8), DoubleToString(sc.sumR, 6), DoubleToString(sc.t, 8), DoubleToString(sc.pFlip, 8), sc.open);
      PrintFormat("SPTEST type=%d events=%d setups=%d resolved=%d hit=%.1f%% avgR=%+.3f t=%.2f pFlip=%.3f open=%d", ty, ty == 0 ? np : nq, cnt, sc.n, sc.hitPct, sc.avgR, sc.t, sc.pFlip, sc.open);
     }
   FileClose(f);
   Print("SPTEST done");
  }
