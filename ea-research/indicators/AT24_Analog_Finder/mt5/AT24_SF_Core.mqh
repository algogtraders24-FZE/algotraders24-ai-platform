//+------------------------------------------------------------------+
//| AT24_SF_Core.mqh - AT24 Strategy Fit engine (pure functions)     |
//| Three plain rules, their trades, and the result per Regime AI    |
//| state. Rules and statistics: see SPEC.md. Chronological arrays.  |
//| Needs AT24_RA_Core.mqh (states, ATR14).                          |
//+------------------------------------------------------------------+
#ifndef AT24_SF_CORE_MQH
#define AT24_SF_CORE_MQH

#include "AT24_RA_Core.mqh"

#define AT24SF_NR     3        // rules: 0 trend, 1 breakout, 2 reversion
#define AT24SF_HOLD   24
#define AT24SF_FIRST  250
#define AT24SF_MINN   30
#define AT24SF_FLIPS  3000
#define AT24SF_SEED   20261118

string AT24SF_RuleName(const int r)
  {
   if(r == 0) return "TREND";
   if(r == 1) return "BREAKOUT";
   if(r == 2) return "REVERSION";
   return "-";
  }

struct AT24SF_Cell
  {
   int    n;
   double avg;      // average R
   double hit;      // share of trades with R > 0
   double p;        // luck test: share of random sign flips with mean >= real mean (1 when n = 0)
   int    cls;      // 1 FIT, 0 neutral, -1 AVOID, 2 no claim (n < 30)
   int    nStop;    // trades closed by the protective stop
  };

struct AT24SF_Res
  {
   AT24SF_Cell c[AT24SF_NR * AT24RA_K];     // index rule * 5 + state
   int         trades;
   int         stopped;                     // trades closed by the stop, all cells
  };

//--- signals of every bar: sig[i * 3 + rule] = +1 / -1 / 0
void AT24SF_Signals(const int n, const double &h[], const double &l[], const double &c[], int &sig[])
  {
   ArrayResize(sig, n * AT24SF_NR);
   double e50 = 0.0, e200 = 0.0;
   double up14 = 0.0, dn14 = 0.0;          // running sums of gains / losses over the last 14 differences
   for(int i = 0; i < n; i++)
     {
      for(int r = 0; r < AT24SF_NR; r++) sig[i * AT24SF_NR + r] = 0;
      if(i == 0) { e50 = c[0]; e200 = c[0]; }
      else
        {
         e50 = (2.0 / 51.0) * c[i] + (1.0 - 2.0 / 51.0) * e50;
         e200 = (2.0 / 201.0) * c[i] + (1.0 - 2.0 / 201.0) * e200;
         double d = c[i] - c[i - 1];
         up14 += MathMax(d, 0.0); dn14 += MathMax(-d, 0.0);
         if(i >= 15) { double d0 = c[i - 14] - c[i - 15]; up14 -= MathMax(d0, 0.0); dn14 -= MathMax(-d0, 0.0); }
        }
      if(i < AT24SF_FIRST) continue;
      //--- trend
      if(c[i] > e50 && e50 > e200) sig[i * AT24SF_NR + 0] = 1;
      else if(c[i] < e50 && e50 < e200) sig[i * AT24SF_NR + 0] = -1;
      //--- breakout of the previous 20 bars
      double hh = h[i - 20], ll = l[i - 20];
      for(int j = i - 19; j < i; j++) { if(h[j] > hh) hh = h[j]; if(l[j] < ll) ll = l[j]; }
      if(c[i] > hh) sig[i * AT24SF_NR + 1] = 1;
      else if(c[i] < ll) sig[i * AT24SF_NR + 1] = -1;
      //--- reversion on RSI(14) with simple means
      double u = up14 / 14.0, dd = dn14 / 14.0;
      double rsi = 100.0 - 100.0 / (1.0 + u / (dd + 1e-12));
      if(rsi < 30.0) sig[i * AT24SF_NR + 2] = 1;
      else if(rsi > 70.0) sig[i * AT24SF_NR + 2] = -1;
     }
  }

uint AT24SF_Next(uint &x)
  {
   x ^= (x << 13);
   x ^= (x >> 17);
   x ^= (x << 5);
   return x;
  }

//--- cell statistics from a list of R values (luck test included)
void AT24SF_CellOf(const double &rv[], const int m, AT24SF_Cell &c)
  {
   c.n = m; c.avg = 0.0; c.hit = 0.0; c.p = 1.0; c.cls = 2; c.nStop = 0;
   if(m <= 0) return;
   double s = 0.0; int w = 0;
   for(int i = 0; i < m; i++) { s += rv[i]; if(rv[i] > 0.0) w++; }
   c.avg = s / m; c.hit = (double)w / m;
   if(m < AT24SF_MINN) return;
   uint x = (uint)AT24SF_SEED; int ge = 0;
   for(int f = 0; f < AT24SF_FLIPS; f++)
     {
      double fs = 0.0;
      for(int i = 0; i < m; i++) fs += ((AT24SF_Next(x) & 1) == 1) ? rv[i] : -rv[i];
      if(fs / m >= c.avg - 1e-12) ge++;
     }
   c.p = (double)ge / AT24SF_FLIPS;
   if(c.avg > 0.0 && c.p < 0.10) c.cls = 1;
   else if(c.avg < 0.0) c.cls = -1;
   else c.cls = 0;
  }

//--- trades of the last bars from index 'from': R per rule and state. stopAtr > 0: protective stop at stopAtr x ATR14 of the signal bar from the entry price,
//--- checked on the high / low of the bars entry..entry+23; a hit closes the trade at the stop price (a loss of exactly stopAtr ATR before cost); 0 = no stop
void AT24SF_Run(const int n, const double &o[], const double &h[], const double &l[], const double &atr14[], const bool &valid[], const int &st[], const int &sig[],
                const double cost, const double stopAtr, const int from, AT24SF_Res &res)
  {
   double rv[];
   int total = 0;
   //--- first pass: count trades per cell, second pass fill
   int cnt[AT24SF_NR * AT24RA_K]; ArrayInitialize(cnt, 0);
   int stp[AT24SF_NR * AT24RA_K]; ArrayInitialize(stp, 0);
   int i0 = MathMax(from, AT24SF_FIRST);
   for(int ph = 0; ph < 2; ph++)
     {
      int pos[AT24SF_NR * AT24RA_K]; ArrayInitialize(pos, 0);
      for(int r = 0; r < AT24SF_NR; r++)
        {
         int last = -1000000;
         for(int i = i0; i + AT24SF_HOLD + 1 <= n - 1; i++)
           {
            int d = sig[i * AT24SF_NR + r];
            if(d == 0 || !valid[i] || st[i] < 0 || atr14[i] <= 0.0) continue;
            if(i - last < AT24SF_HOLD) continue;
            last = i;
            int cell = r * AT24RA_K + st[i];
            if(ph == 0) { cnt[cell]++; total++; }
            else
              {
               double e0 = o[i + 1], pnl = d * (o[i + 1 + AT24SF_HOLD] - e0);
               if(stopAtr > 0.0)
                 {
                  double stopPx = e0 - d * stopAtr * atr14[i];
                  double tol = 1e-12 * MathMax(1.0, MathAbs(stopPx));     // a stop price equal to a bar extreme up to rounding counts as hit
                  for(int j = i + 1; j <= i + AT24SF_HOLD; j++)
                     if((d > 0 && l[j] <= stopPx + tol) || (d < 0 && h[j] >= stopPx - tol)) { pnl = d * (stopPx - e0); stp[cell]++; break; }
                 }
               double R = (pnl - cost) / atr14[i];
               int base = 0; for(int q = 0; q < cell; q++) base += cnt[q];
               rv[base + pos[cell]] = R; pos[cell]++;
              }
           }
        }
      if(ph == 0) ArrayResize(rv, MathMax(total, 1));
     }
   res.trades = total; res.stopped = 0;
   int base = 0;
   for(int cell = 0; cell < AT24SF_NR * AT24RA_K; cell++)
     {
      double tmp[]; ArrayResize(tmp, MathMax(cnt[cell], 1));
      for(int k = 0; k < cnt[cell]; k++) tmp[k] = rv[base + k];
      AT24SF_CellOf(tmp, cnt[cell], res.c[cell]);
      res.c[cell].nStop = stp[cell]; res.stopped += stp[cell];
      base += cnt[cell];
     }
  }

#endif
