//+------------------------------------------------------------------+
//| AT24_ZN_Core.mqh                                                 |
//| Supply / demand zones and what happened when price came back.    |
//| A zone = a short base of small bars followed by an impulse bar   |
//| that closes beyond the base. The FIRST return into the zone is   |
//| traded (limit at the near edge, stop beyond the far edge, target |
//| as a multiple of the risk) and walked forward on the bars.       |
//| Closed bars only. Pure maths, chronological arrays. Descriptive.|
//+------------------------------------------------------------------+
#ifndef AT24_ZN_CORE_MQH
#define AT24_ZN_CORE_MQH

#include "AT24_SP_Core.mqh"

struct AT24ZN_Zone
  {
   int    idx;        // impulse bar (zone known at its close)
   int    dir;        // +1 demand (impulse up), -1 supply (impulse down)
   double top, bottom;
   double atr;        // ATR(14) before the impulse bar
   int    touch;      // first bar that reached the zone (-1 = fresh, not touched)
  };

//--- zones: impulse bar range >= impK x ATR and body >= 60 % of its range; base = up to maxBase bars right before it, each smaller than baseMax x ATR;
//--- the impulse must close beyond the base; the zone height must be <= maxH x ATR
int AT24ZN_Detect(const int n, const double &open[], const double &high[], const double &low[], const double &close[], const double &atr[],
                  const double impK, const double baseMax, const int maxBase, const double maxH, AT24ZN_Zone &zs[])
  {
   ArrayResize(zs, 0);
   int cnt = 0;
   for(int j = 30; j < n; j++)
     {
      double a = atr[j - 1];
      if(a <= 0.0) continue;
      double range = high[j] - low[j], body = MathAbs(close[j] - open[j]);
      if(range < impK * a || body < 0.6 * range) continue;
      int dir = (close[j] > open[j]) ? 1 : -1;
      int cb = 0; double zh = -1e300, zl = 1e300;
      for(int k = j - 1; k >= 1 && cb < maxBase; k--)
        {
         if(high[k] - low[k] >= baseMax * a) break;
         zh = MathMax(zh, high[k]); zl = MathMin(zl, low[k]); cb++;
        }
      if(cb == 0) continue;
      if(dir > 0 && !(close[j] > zh)) continue;
      if(dir < 0 && !(close[j] < zl)) continue;
      if(zh - zl > maxH * a) continue;
      ArrayResize(zs, cnt + 1);
      zs[cnt].idx = j; zs[cnt].dir = dir; zs[cnt].top = zh; zs[cnt].bottom = zl; zs[cnt].atr = a; zs[cnt].touch = -1;
      cnt++;
     }
   return cnt;
  }

//--- first touch of each zone within maxAge bars (demand: low <= top; supply: high >= bottom); fills zs[].touch
void AT24ZN_Touches(const int n, const double &high[], const double &low[], AT24ZN_Zone &zs[], const int nz, const int maxAge)
  {
   for(int z = 0; z < nz; z++)
     {
      zs[z].touch = -1;
      int last = MathMin(n - 1, zs[z].idx + maxAge);
      for(int k = zs[z].idx + 1; k <= last; k++)
        {
         if((zs[z].dir > 0 && low[k] <= zs[z].top) || (zs[z].dir < 0 && high[k] >= zs[z].bottom)) { zs[z].touch = k; break; }
        }
     }
  }

//--- trades from touched zones, in order of the touch bar, one at a time. dirFilter: +1 demand only, -1 supply only, 0 both. cost in price units.
int AT24ZN_Trades(const int n, const double &open[], const double &high[], const double &low[], const double &close[], const AT24ZN_Zone &zs[], const int nz,
                  const int dirFilter, const double slBuf, const double rr, const int maxHold, const double cost, AT24SP_Setup &out[])
  {
   ArrayResize(out, 0);
   int order[]; int m = 0;
   for(int z = 0; z < nz; z++) if(zs[z].touch >= 0 && (dirFilter == 0 || zs[z].dir == dirFilter)) { ArrayResize(order, m + 1); order[m++] = z; }
   for(int i = 1; i < m; i++) { int a = order[i], j = i - 1; while(j >= 0 && (zs[order[j]].touch > zs[a].touch || (zs[order[j]].touch == zs[a].touch && order[j] > a))) { order[j + 1] = order[j]; j--; } order[j + 1] = a; }
   int cnt = 0, lastExit = -1;
   for(int q = 0; q < m; q++)
     {
      AT24ZN_Zone z = zs[order[q]];
      int k = z.touch, d = z.dir;
      if(k <= lastExit) continue;
      AT24SP_Setup s;
      s.idx = k; s.type = (d > 0) ? 0 : 1; s.dir = d;
      s.entry = (d > 0) ? MathMin(open[k], z.top) : MathMax(open[k], z.bottom);
      s.sl = (d > 0) ? z.bottom - slBuf * z.atr : z.top + slBuf * z.atr;
      s.risk = d * (s.entry - s.sl);                 // not positive = price gapped through the zone: no trade
      if(s.risk <= 0.0) continue;
      s.tp = s.entry + d * rr * s.risk; s.exitIdx = -1; s.result = 2; s.r = 0.0;
      int last = MathMin(n - 1, k + maxHold);
      for(int j = k; j <= last; j++)
        {
         bool slHit = (d > 0) ? (low[j] <= s.sl) : (high[j] >= s.sl);
         bool tpHit = (d > 0) ? (high[j] >= s.tp) : (low[j] <= s.tp);
         if(slHit) { s.result = -1; s.exitIdx = j; s.r = -1.0 - cost / s.risk; break; }       // both in one bar counts as the stop
         if(tpHit) { s.result = 1; s.exitIdx = j; s.r = rr - cost / s.risk; break; }
         if(j == k + maxHold) { s.result = 0; s.exitIdx = j; s.r = d * (close[j] - s.entry) / s.risk - cost / s.risk; break; }
        }
      ArrayResize(out, cnt + 1); out[cnt] = s; cnt++;
      lastExit = (s.result == 2) ? n : s.exitIdx;
     }
   return cnt;
  }

#endif // AT24_ZN_CORE_MQH
