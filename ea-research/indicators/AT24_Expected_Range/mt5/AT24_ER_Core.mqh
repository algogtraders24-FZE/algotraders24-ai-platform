//+------------------------------------------------------------------+
//| AT24_ER_Core.mqh                                                 |
//| Expected daily range = average range of the previous N complete  |
//| server days (no look-ahead). Per day: how much of it was used,   |
//| and how often days exceeded it. Pure maths, chronological       |
//| arrays; days are server-time calendar days.                      |
//+------------------------------------------------------------------+
#ifndef AT24_ER_CORE_MQH
#define AT24_ER_CORE_MQH

struct AT24ER_Day
  {
   int    first;     // first bar index of the day
   int    last;      // last bar index of the day (in the data)
   double open;
   double high;
   double low;
   double close;
   double exp;       // expected range from the previous N complete days (0 = not enough days)
   int    hit;       // first bar where the running range reached exp (-1 = never)
  };

//--- split bars into server days and compute the expected range of each from earlier complete days only.
//--- the first day in the data and the last (possibly unfinished) day are kept; the first is flagged by exp = 0.
int AT24ER_Days(const int n, const datetime &time[], const double &open[], const double &high[], const double &low[], const double &close[],
                const int lookback, AT24ER_Day &d[])
  {
   ArrayResize(d, 0);
   int cnt = 0;
   long cur = -1;
   for(int i = 0; i < n; i++)
     {
      long dk = (long)time[i] / 86400;
      if(dk != cur)
        {
         cur = dk;
         ArrayResize(d, cnt + 1);
         d[cnt].first = i; d[cnt].last = i; d[cnt].open = open[i]; d[cnt].high = high[i]; d[cnt].low = low[i]; d[cnt].close = close[i];
         d[cnt].exp = 0.0; d[cnt].hit = -1;
         cnt++;
        }
      else
        {
         int k = cnt - 1;
         d[k].last = i; d[k].close = close[i];
         if(high[i] > d[k].high) d[k].high = high[i];
         if(low[i] < d[k].low) d[k].low = low[i];
        }
     }
   //--- day 0 may be partial (history starts mid-day): never used as a measured day nor as input
   for(int k = 1; k < cnt; k++)
     {
      if(k - 1 < lookback) continue;           // days 1..k-1 are complete; need `lookback` of them
      double s = 0.0;
      for(int j = k - lookback; j < k; j++) s += d[j].high - d[j].low;
      d[k].exp = s / lookback;
      double hi = -1e300, lo = 1e300;
      for(int i = d[k].first; i <= d[k].last; i++)
        {
         if(high[i] > hi) hi = high[i];
         if(low[i] < lo) lo = low[i];
         if(hi - lo >= d[k].exp) { d[k].hit = i; break; }
        }
     }
   return cnt;
  }

//--- statistics over COMPLETE days with an expectation (the last day in d[] is treated as unfinished and skipped).
//--- out[0] days, [1] median range/expected, [2] % days range >= 100 %, [3] % days range >= 150 %,
//--- [4] days that reached 100 %, [5] of those % that finished >= 125 %, [6] median final ratio of those,
//--- [7] % days where |close-open| >= 50 % of expected
void AT24ER_Stats(const AT24ER_Day &d[], const int cnt, double &out[])
  {
   ArrayResize(out, 8);
   for(int z = 0; z < 8; z++) out[z] = 0.0;
   double ratio[], fin[]; ArrayResize(ratio, 0); ArrayResize(fin, 0);
   int m = 0, r100 = 0, r150 = 0, hits = 0, hits125 = 0, dir = 0;
   for(int k = 0; k < cnt - 1; k++)
     {
      if(d[k].exp <= 0.0) continue;
      double rg = (d[k].high - d[k].low) / d[k].exp;
      m++;
      int a = ArraySize(ratio); ArrayResize(ratio, a + 1); ratio[a] = rg;
      if(rg >= 1.0) r100++;
      if(rg >= 1.5) r150++;
      if(MathAbs(d[k].close - d[k].open) >= 0.5 * d[k].exp) dir++;
      if(d[k].hit >= 0)
        {
         hits++;
         if(rg >= 1.25) hits125++;
         int b = ArraySize(fin); ArrayResize(fin, b + 1); fin[b] = rg;
        }
     }
   out[0] = m; out[4] = hits;
   if(m > 0)
     {
      ArraySort(ratio);
      out[1] = (m % 2 == 1) ? ratio[m / 2] : 0.5 * (ratio[m / 2 - 1] + ratio[m / 2]);
      out[2] = 100.0 * r100 / m; out[3] = 100.0 * r150 / m; out[7] = 100.0 * dir / m;
     }
   if(hits > 0)
     {
      ArraySort(fin);
      out[5] = 100.0 * hits125 / hits;
      out[6] = (hits % 2 == 1) ? fin[hits / 2] : 0.5 * (fin[hits / 2 - 1] + fin[hits / 2]);
     }
  }

#endif // AT24_ER_CORE_MQH
