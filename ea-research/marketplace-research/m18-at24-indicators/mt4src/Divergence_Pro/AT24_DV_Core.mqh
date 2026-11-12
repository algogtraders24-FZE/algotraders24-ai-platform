//+------------------------------------------------------------------+
//| AT24_DV_Core.mqh                                                 |
//| RSI divergence between confirmed swing points, and what a trade  |
//| taken on each divergence would have returned. A swing low/high   |
//| is confirmed only after `k` bars on each side have closed, so    |
//| nothing repaints. Closed bars only. Pure maths. Descriptive.     |
//+------------------------------------------------------------------+
#ifndef AT24_DV_CORE_MQH
#define AT24_DV_CORE_MQH

#include "AT24_SP_Core.mqh"

struct AT24DV_Ev
  {
   int    idx;        // confirmation bar (last bar of the right-hand window): the signal bar
   int    dir;        // +1 bullish (price lower low, RSI higher low), -1 bearish
   int    p;          // swing bar
   int    q;          // previous swing bar of the same kind
  };

//--- Wilder RSI; values before the first full period are 50
void AT24DV_Rsi(const int n, const double &close[], const int period, double &rsi[])
  {
   double ag = 0.0, al = 0.0;
   for(int i = 0; i < n; i++)
     {
      rsi[i] = 50.0;
      if(i == 0) continue;
      double ch = close[i] - close[i - 1], g = ch > 0.0 ? ch : 0.0, l = ch < 0.0 ? -ch : 0.0;
      if(i <= period) { ag += g; al += l; if(i == period) { ag /= period; al /= period; rsi[i] = (al == 0.0) ? 100.0 : 100.0 - 100.0 / (1.0 + ag / al); } }
      else { ag = (ag * (period - 1) + g) / period; al = (al * (period - 1) + l) / period; rsi[i] = (al == 0.0) ? 100.0 : 100.0 - 100.0 / (1.0 + ag / al); }
     }
  }

//--- swing low at p: low[p] below the k bars before it and not above the k bars after it (swing high mirrored). Confirmed at bar p + k.
//--- divergence: compared with the previous swing of the same kind q, with minSep <= p - q <= maxSep bars between them and an RSI difference of at least minDiff points
int AT24DV_Events(const int n, const double &high[], const double &low[], const double &rsi[], const int k, const int minSep, const int maxSep, const double minDiff, AT24DV_Ev &ev[])
  {
   ArrayResize(ev, 0);
   int cnt = 0, lastLow = -1, lastHigh = -1;
   for(int p = k + 1; p + k <= n - 1; p++)
     {
      bool isLow = true, isHigh = true;
      for(int j = p - k; j < p; j++) { if(low[j] <= low[p]) isLow = false; if(high[j] >= high[p]) isHigh = false; }
      for(int j = p + 1; j <= p + k; j++) { if(low[j] < low[p]) isLow = false; if(high[j] > high[p]) isHigh = false; }
      if(isLow)
        {
         if(lastLow >= 0 && p - lastLow >= minSep && p - lastLow <= maxSep && low[p] < low[lastLow] && rsi[p] > rsi[lastLow] + minDiff)
           { ArrayResize(ev, cnt + 1); ev[cnt].idx = p + k; ev[cnt].dir = 1; ev[cnt].p = p; ev[cnt].q = lastLow; cnt++; }
         lastLow = p;
        }
      if(isHigh)
        {
         if(lastHigh >= 0 && p - lastHigh >= minSep && p - lastHigh <= maxSep && high[p] > high[lastHigh] && rsi[p] < rsi[lastHigh] - minDiff)
           { ArrayResize(ev, cnt + 1); ev[cnt].idx = p + k; ev[cnt].dir = -1; ev[cnt].p = p; ev[cnt].q = lastHigh; cnt++; }
         lastHigh = p;
        }
     }
   // events were produced in order of p; the two kinds can interleave in confirmation time only by equal k, so the order is already chronological
   return cnt;
  }

//--- trades: entry at the next open, stop beyond the swing extreme (buffer in ATR of the signal bar), target = rr x risk, timed exit; risk must be positive and at most maxRiskAtr x ATR
int AT24DV_Trades(const int n, const double &open[], const double &high[], const double &low[], const double &close[], const double &atr[], const AT24DV_Ev &ev[], const int ne,
                  const int dirFilter, const double slBuf, const double maxRiskAtr, const double rr, const int maxHold, const double cost, AT24SP_Setup &out[])
  {
   ArrayResize(out, 0);
   int cnt = 0, lastExit = -1;
   for(int e = 0; e < ne; e++)
     {
      int i = ev[e].idx, d = ev[e].dir;
      if(dirFilter != 0 && d != dirFilter) continue;
      if(i + 1 > n - 1 || atr[i] <= 0.0 || i <= lastExit) continue;
      AT24SP_Setup s;
      s.idx = i; s.type = (d > 0) ? 0 : 1; s.dir = d; s.entry = open[i + 1];
      s.sl = (d > 0) ? low[ev[e].p] - slBuf * atr[i] : high[ev[e].p] + slBuf * atr[i];
      s.risk = d * (s.entry - s.sl);
      if(s.risk <= 0.0 || s.risk > maxRiskAtr * atr[i]) continue;
      s.tp = s.entry + d * rr * s.risk; s.exitIdx = -1; s.result = 2; s.r = 0.0;
      int last = MathMin(n - 1, i + maxHold);
      for(int j = i + 1; j <= last; j++)
        {
         bool slHit = (d > 0) ? (low[j] <= s.sl) : (high[j] >= s.sl);
         bool tpHit = (d > 0) ? (high[j] >= s.tp) : (low[j] <= s.tp);
         if(slHit) { s.result = -1; s.exitIdx = j; s.r = -1.0 - cost / s.risk; break; }
         if(tpHit) { s.result = 1; s.exitIdx = j; s.r = rr - cost / s.risk; break; }
         if(j == i + maxHold) { s.result = 0; s.exitIdx = j; s.r = d * (close[j] - s.entry) / s.risk - cost / s.risk; break; }
        }
      ArrayResize(out, cnt + 1); out[cnt] = s; cnt++;
      lastExit = (s.result == 2) ? n : s.exitIdx;
     }
   return cnt;
  }

#endif // AT24_DV_CORE_MQH
