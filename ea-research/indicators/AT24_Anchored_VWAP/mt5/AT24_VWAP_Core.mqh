//+------------------------------------------------------------------+
//| AT24_VWAP_Core.mqh                                               |
//| Anchored VWAP (day / week / month, GMT) with volume-weighted     |
//| standard deviation, and a mean-reversion test around the day     |
//| VWAP. Pure maths, chronological arrays. Volume = tick volume.    |
//+------------------------------------------------------------------+
#ifndef AT24_VWAP_CORE_MQH
#define AT24_VWAP_CORE_MQH

//--- mode 0 day, 1 week (Monday), 2 month. Key of the anchor period for a bar (GMT).
int AT24VW_Key(const datetime t, const int offsetSec, const int mode)
  {
   datetime g = t - offsetSec;
   if(mode == 0) { MqlDateTime m; TimeToStruct(g, m); return m.year * 10000 + m.mon * 100 + m.day; }
   if(mode == 1) { long d = (long)g / 86400; return (int)(d - (d + 3) % 7); }
   MqlDateTime q; TimeToStruct(g, q); return q.year * 100 + q.mon;
  }

//--- vwap[i], sd[i] (volume-weighted std dev of the typical price), first[i] = 1 on the first bar of an anchor period
void AT24VW_Calc(const int n, const datetime &time[], const double &high[], const double &low[], const double &close[], const long &vol[],
                 const int offsetSec, const int mode, double &vwap[], double &sd[], int &first[])
  {
   int curKey = -2147483647;
   double sv = 0.0, svp = 0.0, svp2 = 0.0;
   for(int i = 0; i < n; i++)
     {
      int key = AT24VW_Key(time[i], offsetSec, mode);
      first[i] = 0;
      if(key != curKey) { curKey = key; sv = 0.0; svp = 0.0; svp2 = 0.0; first[i] = 1; }
      double tp = (high[i] + low[i] + close[i]) / 3.0;
      double v = (double)MathMax((long)1, vol[i]);
      sv += v; svp += v * tp; svp2 += v * tp * tp;
      vwap[i] = svp / sv;
      double var_ = svp2 / sv - vwap[i] * vwap[i];
      sd[i] = (var_ > 0.0) ? MathSqrt(var_) : 0.0;
     }
  }

//--- Mean-reversion test around the DAY vwap. Event = first close at or beyond +-startSd standard deviations (after minBars bars of the day).
//--- Reversion = price trades back to the vwap before the day ends; extension = a close at +-extendSd first; none = neither.
//--- out[0] events, [1] reverted, [2] extended, [3] none, [4] % of closes above the day vwap, [5] bars counted for [4]
void AT24VW_Reversion(const int n, const double &high[], const double &low[], const double &close[], const double &vwap[], const double &sd[],
                      const int &first[], const double startSd, const double extendSd, const int minBars, double &out[])
  {
   ArrayResize(out, 6);
   for(int z = 0; z < 6; z++) out[z] = 0.0;
   int dayStart = 0, above = 0, cnt = 0;
   for(int i = 0; i < n; i++)
     {
      if(first[i] == 1) dayStart = i;
      if(i - dayStart >= minBars) { cnt++; if(close[i] > vwap[i]) above++; }
     }
   out[4] = (cnt > 0) ? 100.0 * above / cnt : 0.0; out[5] = cnt;
   int i = 0;
   while(i < n)
     {
      int ds = i;                         // find the day span [ds, de]
      int de = i;
      while(de + 1 < n && first[de + 1] == 0) de++;
      i = de + 1;
      if(de - ds < minBars + 2) continue;
      int j = ds + minBars;
      while(j <= de)
        {
         if(sd[j] > 0.0)
           {
            double dev = (close[j] - vwap[j]) / sd[j];
            if(MathAbs(dev) >= startSd)
              {
               int dir = (dev > 0.0) ? 1 : -1;
               int res = 0;
               for(int k = j + 1; k <= de; k++)
                 {
                  bool rev = (dir == 1) ? (low[k] <= vwap[k]) : (high[k] >= vwap[k]);
                  bool ext = (sd[k] > 0.0) && ((dir == 1) ? ((close[k] - vwap[k]) / sd[k] >= extendSd) : ((close[k] - vwap[k]) / sd[k] <= -extendSd));
                  if(rev && ext) { res = 3; break; }
                  if(rev) { res = 1; break; }
                  if(ext) { res = 2; break; }
                 }
               if(de == n - 1 && res == 0) break;       // the last day is not finished: not measured
               out[0] += 1;
               if(res == 1) out[1] += 1; else if(res == 2) out[2] += 1; else out[3] += 1;
               //--- continue after the resolution: skip to the next day (one event per day and direction side is enough)
               break;
              }
           }
         j++;
        }
     }
  }

#endif // AT24_VWAP_CORE_MQH
