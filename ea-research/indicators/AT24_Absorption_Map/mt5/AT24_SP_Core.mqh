//+------------------------------------------------------------------+
//| AT24_SP_Core.mqh                                                 |
//| Setup Pro engine: turns detected setup events (pullback touches, |
//| squeeze releases) into complete trades with levels and walks     |
//| each one forward on the bars to get its real outcome in R after  |
//| cost. Then scores every setup type on the symbol's own history.  |
//| Closed bars only; the entry is the OPEN of the bar after the     |
//| signal bar. Pure maths, chronological arrays. Descriptive.       |
//+------------------------------------------------------------------+
#ifndef AT24_SP_CORE_MQH
#define AT24_SP_CORE_MQH

#include "AT24_TT_Core.mqh"

struct AT24SP_Setup
  {
   int    idx;        // signal bar
   int    type;       // 0 pullback, 1 squeeze release
   int    dir;        // +1 long, -1 short
   double entry;      // open of the next bar
   double sl, tp, risk;
   int    exitIdx;    // bar where the trade ended (-1 while open)
   int    result;     // 1 target, -1 stop, 0 timed out, 2 still open
   double r;          // result in R after cost (0 while open)
  };

struct AT24SP_Score
  {
   int    n;          // resolved setups
   int    wins;       // R > 0
   double hitPct;
   double avgR;
   double sumR;
   double t;
   double pFlip;      // sign-flip p of the R list (one-sided, mean > 0)
   int    open;       // setups not yet resolved
  };

//--- evIdx / evDir: signal bars and directions of one setup type, chronological. A new setup of the same type is skipped while the previous one is still running.
//--- slMult: stop distance in ATR(signal bar); rr: target as a multiple of the stop; maxHold: bars before a timed exit at the close; cost: round-turn cost in price units
int AT24SP_Simulate(const int n, const double &open[], const double &high[], const double &low[], const double &close[], const double &atr[],
                    const int &evIdx[], const int &evDir[], const int m, const int type,
                    const double slMult, const double rr, const int maxHold, const double cost, AT24SP_Setup &out[])
  {
   ArrayResize(out, 0);
   int cnt = 0, lastExit = -1;
   for(int k = 0; k < m; k++)
     {
      int i = evIdx[k], d = evDir[k];
      if(i < 1 || i + 1 > n - 1 || d == 0 || atr[i] <= 0.0) continue;
      if(i <= lastExit) continue;
      AT24SP_Setup s;
      s.idx = i; s.type = type; s.dir = d; s.entry = open[i + 1]; s.risk = slMult * atr[i];
      s.sl = s.entry - d * s.risk; s.tp = s.entry + d * rr * s.risk;
      s.exitIdx = -1; s.result = 2; s.r = 0.0;
      int last = MathMin(n - 1, i + maxHold);
      for(int j = i + 1; j <= last; j++)
        {
         bool slHit = (d > 0) ? (low[j] <= s.sl) : (high[j] >= s.sl);
         bool tpHit = (d > 0) ? (high[j] >= s.tp) : (low[j] <= s.tp);
         if(slHit) { s.result = -1; s.exitIdx = j; s.r = -1.0 - cost / s.risk; break; }       // both in one bar counts as the stop (conservative)
         if(tpHit) { s.result = 1; s.exitIdx = j; s.r = rr - cost / s.risk; break; }
         if(j == i + maxHold) { s.result = 0; s.exitIdx = j; s.r = d * (close[j] - s.entry) / s.risk - cost / s.risk; break; }
        }
      ArrayResize(out, cnt + 1); out[cnt] = s; cnt++;
      lastExit = (s.result == 2) ? n : s.exitIdx;
     }
   return cnt;
  }

void AT24SP_ScoreOf(const AT24SP_Setup &st[], const int cnt, const uint seed, AT24SP_Score &sc)
  {
   sc.n = 0; sc.wins = 0; sc.hitPct = 0.0; sc.avgR = 0.0; sc.sumR = 0.0; sc.t = 0.0; sc.pFlip = 1.0; sc.open = 0;
   double rs[]; ArrayResize(rs, cnt); int m = 0;
   for(int i = 0; i < cnt; i++)
     {
      if(st[i].result == 2) { sc.open++; continue; }
      rs[m++] = st[i].r;
      if(st[i].r > 0.0) sc.wins++;
     }
   sc.n = m;
   if(m < 2) { if(m == 1) { sc.sumR = rs[0]; sc.avgR = rs[0]; } return; }
   AT24TT_Res r; ArrayResize(rs, m);
   AT24TT_Run(rs, m, seed, r);
   sc.sumR = r.total; sc.avgR = r.mean; sc.t = r.t; sc.pFlip = r.pFlip; sc.hitPct = 100.0 * sc.wins / m;
  }

#endif // AT24_SP_CORE_MQH
